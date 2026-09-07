// Tests unitarios de api/_lib/usageLimits.js
//
// No tocamos Supabase real: armamos un "fake admin" que imita la cadena
// fluent del cliente supabase-js (admin.from(...).select(...).eq(...).maybeSingle())
// y guarda las filas en memoria para que upsert se vea reflejado en lecturas
// posteriores. Es suficiente para verificar la lógica de plan + cuotas.
//
// Cubrimos los casos del prompt:
//   1. Usuario free dentro del límite → ok
//   2. Usuario free al límite → bloqueo controlado (no llama a IA)
//   3. Usuario early_access tiene techo más alto
//   4. Usuario admin no se bloquea en pruebas normales
//   5. Sin fila en user_plans → tratado como free
//   6. Plan vencido → tratado como free
//   7. Tests de auth-required (auth-required.test.js) ya verifican que sin
//      sesión no se llega al check.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTION_TYPES,
  PLANS,
  checkLimit,
  enforceLimit,
  getUserPlan,
  getLimit,
  recordUsage,
} from '../api/_lib/usageLimits.js'

// ─── Fake admin ────────────────────────────────────────────────────────────
function makeFakeAdmin({ planRow = null, usage = [] } = {}) {
  // usage: [{ user_id, day, endpoint, count }]
  const usageRows = usage.map(r => ({ ...r }))
  const planRowRef = planRow ? { ...planRow } : null

  function userPlansChain() {
    const state = { selectFields: '*', filters: [] }
    const chain = {
      select(fields) { state.selectFields = fields; return chain },
      eq(_col, _val) { state.filters.push([_col, _val]); return chain },
      async maybeSingle() {
        if (!planRowRef) return { data: null, error: null }
        return { data: { ...planRowRef }, error: null }
      },
    }
    return chain
  }

  function aiUsageChain() {
    const state = { filters: [], selectFields: null, inDays: null }
    const chain = {
      select(fields) { state.selectFields = fields; return chain },
      eq(col, val) { state.filters.push([col, val]); return chain },
      in(col, vals) { state.inDays = { col, vals }; return chain },
      async maybeSingle() {
        const f = Object.fromEntries(state.filters)
        const row = usageRows.find(r =>
          r.user_id === f.user_id && r.day === f.day && r.endpoint === f.endpoint,
        )
        return { data: row ? { count: row.count } : null, error: null }
      },
      // Para .in(...).select(): devuelve el array filtrado
      then(resolve) {
        const f = Object.fromEntries(state.filters)
        const filtered = usageRows.filter(r => {
          if (state.filters.find(([c]) => c === 'user_id') && r.user_id !== f.user_id) return false
          if (state.filters.find(([c]) => c === 'endpoint') && r.endpoint !== f.endpoint) return false
          if (state.inDays && !state.inDays.vals.includes(r.day)) return false
          return true
        }).map(r => ({ day: r.day, count: r.count }))
        resolve({ data: filtered, error: null })
      },
      upsert(payload, _opts) {
        const arr = Array.isArray(payload) ? payload : [payload]
        for (const p of arr) {
          const idx = usageRows.findIndex(r =>
            r.user_id === p.user_id && r.day === p.day && r.endpoint === p.endpoint,
          )
          if (idx >= 0) usageRows[idx] = { ...usageRows[idx], ...p }
          else usageRows.push({ ...p })
        }
        return Promise.resolve({ data: null, error: null })
      },
    }
    return chain
  }

  return {
    async rpc(name, args) {
      assert.equal(name, 'focus_increment_ai_usage')
      const match = usageRows.find(r => r.user_id === args.p_user_id && r.day === args.p_day && r.endpoint === args.p_endpoint)
      if (match) match.count += 1
      else usageRows.push({ user_id: args.p_user_id, day: args.p_day, endpoint: args.p_endpoint, count: 1 })
      return { data: match?.count ?? 1, error: null }
    },
    from(table) {
      if (table === 'user_plans') return userPlansChain()
      if (table === 'ai_usage')   return aiUsageChain()
      throw new Error(`fake admin: tabla no esperada "${table}"`)
    },
    _state() { return { usageRows, planRowRef } },
  }
}

const USER = '00000000-0000-0000-0000-000000000aaa'
function todayUtcISO() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// ─── getUserPlan ────────────────────────────────────────────────────────────

test('getUserPlan devuelve free cuando no hay fila', async () => {
  const admin = makeFakeAdmin()
  const plan = await getUserPlan(admin, USER)
  assert.equal(plan, PLANS.FREE)
})

test('getUserPlan devuelve early_access cuando la fila lo dice', async () => {
  const admin = makeFakeAdmin({ planRow: { plan: 'early_access', expires_at: null } })
  const plan = await getUserPlan(admin, USER)
  assert.equal(plan, PLANS.EARLY_ACCESS)
})

test('getUserPlan trata como free cuando expires_at ya venció', async () => {
  const past = new Date(Date.now() - 86_400_000).toISOString()
  const admin = makeFakeAdmin({ planRow: { plan: 'early_access', expires_at: past } })
  const plan = await getUserPlan(admin, USER)
  assert.equal(plan, PLANS.FREE)
})

test('getUserPlan respeta admin sin vencimiento', async () => {
  const admin = makeFakeAdmin({ planRow: { plan: 'admin', expires_at: null } })
  const plan = await getUserPlan(admin, USER)
  assert.equal(plan, PLANS.ADMIN)
})

test('getUserPlan normaliza valores inválidos a free', async () => {
  const admin = makeFakeAdmin({ planRow: { plan: 'enterprise_xxx', expires_at: null } })
  const plan = await getUserPlan(admin, USER)
  assert.equal(plan, PLANS.FREE)
})

// ─── getLimit ───────────────────────────────────────────────────────────────

test('getLimit devuelve la config correcta por plan', () => {
  const free = getLimit('free', ACTION_TYPES.NOVA_MESSAGE)
  const ea   = getLimit('early_access', ACTION_TYPES.NOVA_MESSAGE)
  const adm  = getLimit('admin', ACTION_TYPES.NOVA_MESSAGE)
  assert.ok(free && ea && adm, 'config debe existir')
  assert.ok(ea.daily > free.daily, 'early_access > free')
  assert.ok(adm.daily > ea.daily,  'admin > early_access')
})

test('getLimit weekly_planning devuelve weekly y no daily', () => {
  const cfg = getLimit('free', ACTION_TYPES.WEEKLY_PLANNING)
  assert.equal(cfg.daily, undefined)
  assert.equal(cfg.weekly, 1)
})

// ─── checkLimit / enforceLimit ──────────────────────────────────────────────

test('usuario free dentro del límite recibe ok=true', async () => {
  const admin = makeFakeAdmin({
    usage: [{ user_id: USER, day: todayUtcISO(), endpoint: ACTION_TYPES.NOVA_MESSAGE, count: 5 }],
  })
  const r = await checkLimit(admin, USER, PLANS.FREE, ACTION_TYPES.NOVA_MESSAGE)
  assert.equal(r.ok, true)
  assert.equal(r.plan, PLANS.FREE)
  assert.ok(r.remaining > 0)
})

test('usuario free al límite recibe ok=false con mensaje', async () => {
  const admin = makeFakeAdmin({
    usage: [{ user_id: USER, day: todayUtcISO(), endpoint: ACTION_TYPES.NOVA_MESSAGE, count: 20 }],
  })
  const r = await checkLimit(admin, USER, PLANS.FREE, ACTION_TYPES.NOVA_MESSAGE)
  assert.equal(r.ok, false)
  assert.equal(r.plan, PLANS.FREE)
  assert.equal(r.action_type, ACTION_TYPES.NOVA_MESSAGE)
  assert.match(r.message, /plan gratis/i)
  assert.ok(r.resetAt, 'debe traer resetAt')
})

test('usuario early_access tiene techo más alto que free', async () => {
  const admin = makeFakeAdmin({
    usage: [{ user_id: USER, day: todayUtcISO(), endpoint: ACTION_TYPES.NOVA_MESSAGE, count: 25 }],
  })
  // Free se bloquea a las 20; early_access sigue ok hasta 60
  const free = await checkLimit(admin, USER, PLANS.FREE, ACTION_TYPES.NOVA_MESSAGE)
  const ea   = await checkLimit(admin, USER, PLANS.EARLY_ACCESS, ACTION_TYPES.NOVA_MESSAGE)
  assert.equal(free.ok, false)
  assert.equal(ea.ok, true)
})

test('admin no se bloquea con uso normal', async () => {
  const admin = makeFakeAdmin({
    usage: [{ user_id: USER, day: todayUtcISO(), endpoint: ACTION_TYPES.NOVA_MESSAGE, count: 500 }],
  })
  const r = await checkLimit(admin, USER, PLANS.ADMIN, ACTION_TYPES.NOVA_MESSAGE)
  assert.equal(r.ok, true)
})

test('weekly_planning bloquea por semana, no por día', async () => {
  // 1 uso ayer (UTC) → semanal debería estar al límite (1) en plan free
  const yesterday = (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  })()
  const admin = makeFakeAdmin({
    usage: [{ user_id: USER, day: yesterday, endpoint: ACTION_TYPES.WEEKLY_PLANNING, count: 1 }],
  })
  const r = await checkLimit(admin, USER, PLANS.FREE, ACTION_TYPES.WEEKLY_PLANNING)
  assert.equal(r.ok, false)
  assert.equal(r.period, 'weekly')
})

test('recordUsage incrementa el contador del día actual', async () => {
  const admin = makeFakeAdmin()
  await recordUsage(admin, USER, ACTION_TYPES.NOVA_MESSAGE)
  await recordUsage(admin, USER, ACTION_TYPES.NOVA_MESSAGE)
  const r = await checkLimit(admin, USER, PLANS.FREE, ACTION_TYPES.NOVA_MESSAGE)
  // El uso registrado ahora debería ser 2, dentro del límite de 20
  assert.equal(r.ok, true)
  assert.equal(r.remaining, 18)
})

test('enforceLimit verifica y registra uso', async () => {
  const admin = makeFakeAdmin()
  // Llamar 5 veces con free + nova_smart_action (límite 10) debe quedar ok
  for (let i = 0; i < 5; i++) {
    const r = await enforceLimit(admin, USER, PLANS.FREE, ACTION_TYPES.NOVA_SMART_ACTION)
    assert.equal(r.ok, true, `intento ${i}: ${r.message}`)
  }
  // Verificar que se contaron
  const check = await checkLimit(admin, USER, PLANS.FREE, ACTION_TYPES.NOVA_SMART_ACTION)
  assert.equal(check.remaining, 5)
})

test('enforceLimit en plan free al alcanzar el límite bloquea futuras llamadas', async () => {
  const admin = makeFakeAdmin()
  // Plan free, photo_analysis = 5 al día. Hacemos 5, luego una sexta.
  for (let i = 0; i < 5; i++) {
    const r = await enforceLimit(admin, USER, PLANS.FREE, ACTION_TYPES.PHOTO_ANALYSIS)
    assert.equal(r.ok, true, `intento ${i}`)
  }
  const r6 = await enforceLimit(admin, USER, PLANS.FREE, ACTION_TYPES.PHOTO_ANALYSIS)
  assert.equal(r6.ok, false)
  assert.equal(r6.action_type, ACTION_TYPES.PHOTO_ANALYSIS)
  assert.match(r6.message, /análisis de fotos/i)
})

test('checkLimit con admin nulo devuelve soft (no bloquea)', async () => {
  const r = await checkLimit(null, USER, PLANS.FREE, ACTION_TYPES.NOVA_MESSAGE)
  assert.equal(r.ok, true)
  assert.equal(r.soft, true)
})

test('checkLimit con action_type desconocido no bloquea (soft)', async () => {
  const admin = makeFakeAdmin()
  const r = await checkLimit(admin, USER, PLANS.FREE, 'inexistente_xxx')
  assert.equal(r.ok, true)
  assert.equal(r.soft, true)
})


test('atomic RPC retains every concurrent increment', async () => {
  const admin = makeFakeAdmin()
  const results = await Promise.all(Array.from({ length: 30 }, () => recordUsage(admin, USER, ACTION_TYPES.NOVA_MESSAGE)))
  assert.ok(results.every(r => r.ok))
  assert.equal(admin._state().usageRows[0].count, 30)
})

test('uncertain RPC failure never falls back and risks a second increment', async () => {
  const result = await recordUsage({ rpc: async () => ({ data: null, error: { code: 'ETIMEDOUT' } }),
    from() { assert.fail('must not increment again') },
  }, USER, ACTION_TYPES.NOVA_MESSAGE)
  assert.equal(result.ok, false)
})

test('old schema compare-and-swap retries a collision without losing an increment', async () => {
  let count = 4
  let collide = true
  const admin = { rpc: async () => ({ data: null, error: { code: 'PGRST202' } }), from() {
    let expected, update
    return {
      eq(key, value) { if (key === 'count') expected = value; return this },
      update(value) { update = value; return this },
      select() {
        if (!update) return this
        if (collide) { count += 1; collide = false; return Promise.resolve({ data: [], error: null }) }
        if (count !== expected) return Promise.resolve({ data: [], error: null })
        count = update.count
        return Promise.resolve({ data: [{ count }], error: null })
      },
      maybeSingle: async () => ({ data: { count }, error: null }),
    }
  } }
  const result = await recordUsage(admin, USER, ACTION_TYPES.NOVA_MESSAGE)
  assert.equal(result.ok, true)
  assert.equal(count, 6)
})

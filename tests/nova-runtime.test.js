import test from 'node:test'
import assert from 'node:assert/strict'
import { executeNovaRequest, selectNovaRoutes } from '../api/_lib/novaRuntime.js'
import { sanitizeNovaRequest } from '../api/_lib/novaSafety.js'
import { wirePlan, wireAction } from './helpers/novaFixtures.js'
const body = message => sanitizeNovaRequest({ message, clientNow: Date.parse('2026-09-08T14:00Z'), clientTimezone: 'America/Santiago' }).body
function database({ admission = 'admitted', consume = 'ok', finish = 'completed' } = {}) {
  const calls = []; let stored
  return { calls, async rpc(name, args) {
    calls.push({ name, args })
    if (name === 'focus_ai_admit') return { data: { status: admission, lease_id: 'lease-server', budget_level: 'normal', response: stored } }
    if (name === 'focus_ai_consume') return { data: { status: consume } }
    if (name === 'focus_ai_finish') { stored = args.p_response; return { data: { status: finish } } }
    throw new Error('unexpected RPC')
  } }
}
function environment(overrides = {}) {
  const keys = ['NOVA_PROVIDER', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'AI_ENABLE_PREMIUM_FALLBACK', 'AI_ENABLE_PROVIDER_FALLBACK', 'ANTHROPIC_NOVA_MODEL', 'OPENAI_NOVA_MODEL', 'AI_MAX_COST_PER_REQUEST_USD']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  keys.forEach(key => delete process.env[key]); Object.assign(process.env, { NOVA_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'offline-test', ...overrides })
  return () => keys.forEach(key => saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key])
}
const response = plan => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(plan) }], usage: { input_tokens: 1000, output_tokens: 200 } })
async function invoke({ admin = database(), provider, message = 'comprar pan', track = async () => ({ ok: true }) } = {}) {
  return executeNovaRequest({ admin, userId: 'user', requestId: 'request', body: body(message), plan: 'free',
    callProviders: { anthropic: provider || (async () => response(wirePlan([wireAction()]))), openai: provider, deepseek: provider }, track })
}
for (const status of ['unavailable', 'quota', 'rate', 'concurrency', 'conflict', 'in_progress', 'budget']) {
  test(`admission ${status} never calls a paid provider`, async () => {
    const restore = environment(); let called = 0
    try { const out = await invoke({ admin: database({ admission: status }), provider: async () => { called++ } }); assert.ok(out.httpStatus >= 400); assert.equal(called, 0) } finally { restore() }
  })
}
test('one successful plan consumes smart quota, logs lease and persists replay before return', async () => {
  const restore = environment(); const admin = database(); const logs = []
  try {
    const out = await invoke({ admin, track: async event => { logs.push(event); return { ok: true } } })
    assert.equal(out.httpStatus, 200); assert.equal(out.body.actions[0].task.label, 'Comprar pan')
    assert.deepEqual(admin.calls.map(call => call.name), ['focus_ai_admit','focus_ai_consume','focus_ai_finish'])
    assert.equal(logs[0].metadata.admission_lease_id, 'lease-server'); assert.equal(logs[0].metadata.request_id, 'request')
    assert.equal(admin.calls.at(-1).args.p_response.body.actions[0].actionId, 'request:0')
    assert.ok(admin.calls.at(-1).args.p_actual_usd < admin.calls[0].args.p_reserve_usd)
  } finally { restore() }
})
test('unknown usage in two failed attempts retains both monetary reservations and logs every attempt', async () => {
  const restore = environment(); const admin = database(); const logs = []; let calls = 0
  try {
    const out = await invoke({ admin, provider: async () => { calls++; throw new Error('private provider body') }, track: async e => { logs.push(e); return { ok: true } } })
    assert.equal(out.httpStatus, 503); assert.equal(calls, 2); assert.equal(logs.length, 2)
    assert.equal(admin.calls.at(-1).args.p_actual_usd, admin.calls[0].args.p_reserve_usd)
    assert.doesNotMatch(JSON.stringify(logs), /private provider body/)
  } finally { restore() }
})
test('authentication failures never cause retries or cross-provider escalation', async () => {
  const restore = environment({ AI_ENABLE_PROVIDER_FALLBACK: 'true', OPENAI_API_KEY: 'offline-test' }); let calls = 0
  try { await invoke({ provider: async () => { calls++; throw Object.assign(new Error('secret'), { status: 401 }) } }); assert.equal(calls, 1) } finally { restore() }
})
test('invalid semantic plan does not spend another attempt to invent authorization', async () => {
  const restore = environment(); let calls = 0; const logs = []
  try {
    const out = await invoke({ message: 'estoy cansado', provider: async () => { calls++; return response(wirePlan([wireAction({ title: 'Estoy cansado', sourceText: 'estoy cansado' })])) }, track: async event => { logs.push(event); return { ok: true } } })
    assert.equal(calls, 1); assert.equal(out.body.actions.length, 0); assert.equal(out.body.validation.ok, false); assert.equal(logs[0].success, false)
  } finally { restore() }
})
test('database failure to persist replay returns no actions', async () => {
  const restore = environment()
  try { const out = await invoke({ admin: database({ finish: 'unavailable' }) }); assert.equal(out.httpStatus, 503); assert.equal(out.body.actions.length, 0) } finally { restore() }
})
test('missing attempt ledger confirmation keeps conservative reservation and returns no actions', async () => {
  const restore = environment(); const admin = database()
  try { const out = await invoke({ admin, track: async () => ({ ok: false }) }); assert.equal(out.httpStatus, 503); assert.equal(admin.calls.at(-1).args.p_actual_usd, admin.calls[0].args.p_reserve_usd) } finally { restore() }
})
test('premium model forced through env cannot bypass premium gate', () => {
  const restore = environment({ ANTHROPIC_NOVA_MODEL: 'claude-sonnet-4-6' })
  try { assert.throws(selectNovaRoutes, /premium_disabled/) } finally { restore() }
})
test('missing provider key and unknown model pricing never call provider', async () => {
  for (const config of [{ ANTHROPIC_API_KEY: '' }, { AI_ENABLE_PREMIUM_FALLBACK: 'true', ANTHROPIC_NOVA_MODEL: 'made-up-model' }]) {
    const restore = environment(config); let called = false
    try { const out = await invoke({ provider: async () => { called = true } }); assert.equal(out.httpStatus, 503); assert.equal(called, false) } finally { restore() }
  }
})
test('atomic smart quota denial strips both executable actions and proposals', async () => {
  const restore = environment()
  try { const out = await invoke({ admin: database({ consume: 'quota' }) }); assert.equal(out.body.smart_actions_blocked, true); assert.deepEqual(out.body.actions, []); assert.deepEqual(out.body.proposed_actions, []) } finally { restore() }
})

test('only durably finalized terminal failures let explicit retry use a new UUID', async () => {
  const restore = environment()
  try {
    const provider = async () => { throw Object.assign(new Error('offline'), { status: 401 }) }
    const finished = await invoke({ provider })
    assert.equal(finished.body.request_completed, true); assert.equal(finished.body.request_retryable, true)
    const uncertain = await invoke({ provider, admin: database({ finish: 'unavailable' }) })
    assert.equal(uncertain.body.request_completed, undefined)
    const notAdmitted = await invoke({ provider, admin: database({ admission: 'unavailable' }) })
    assert.equal(notAdmitted.body.request_completed, undefined)
  } finally { restore() }
})

test('a costly optional premium fallback cannot block an affordable primary', async () => {
  const restore = environment({ AI_ENABLE_PREMIUM_FALLBACK: 'true', AI_MAX_COST_PER_REQUEST_USD: '0.04' })
  const models = []
  try {
    const out = await invoke({ provider: async ({ model }) => { models.push(model); return response(wirePlan([wireAction()])) } })
    assert.equal(out.httpStatus, 200); assert.equal(models.length, 1); assert.match(models[0], /haiku/)
  } finally { restore() }
})
test('90 percent budget level skips retries and downgrades forced premium before paying', async () => {
  const restore = environment({ AI_ENABLE_PREMIUM_FALLBACK: 'true', ANTHROPIC_NOVA_MODEL: 'claude-sonnet-4-6' })
  const models = []; const admin = database(); const original = admin.rpc.bind(admin)
  admin.rpc = async (name, args) => { const result = await original(name,args); if (name === 'focus_ai_admit') result.data.budget_level = 'economy'; return result }
  try {
    const out = await invoke({ admin, provider: async ({ model }) => { models.push(model); return response(wirePlan([wireAction()])) } })
    assert.equal(out.httpStatus, 200); assert.match(models[0], /haiku/)
    assert.equal(admin.calls.filter(c => c.name === 'focus_ai_consume' && c.args.p_action_type === 'nova_premium_message').length, 0)
  } finally { restore() }
})
test('terminal replay returns the persisted body without a new provider or quota call', async () => {
  const restore = environment(); let paid = 0
  const cached = { httpStatus: 503, body: { requestId: 'request', request_completed: true, request_retryable: true, actions: [] } }
  const admin = { async rpc(name) { assert.equal(name, 'focus_ai_admit'); return { data: { status: 'replay', response: cached } } } }
  try { const out = await invoke({ admin, provider: async () => { paid++ } }); assert.deepEqual(out,cached); assert.equal(paid,0) } finally { restore() }
})
test('malformed usage retains a complete reservation rather than treating missing tokens as free', async () => {
  const restore = environment(); const admin = database(); const logs = []
  try {
    const out = await invoke({ admin, provider: async () => ({ ...response(wirePlan()), usage: { input_tokens: 'unknown', output_tokens: 200 } }),
      track: async event => { logs.push(event); return { ok: true } } })
    assert.equal(out.httpStatus, 200); assert.equal(logs[0].usage.source, 'unavailable'); assert.ok(logs[0].cost_override_usd > 0)
  } finally { restore() }
})

test('operations kill switch prevents both admission and provider calls', async () => {
  const restore = environment(); const saved = process.env.AI_PAID_CALLS_ENABLED
  const admin = database(); let calls = 0
  try {
    for (const flag of ['false', 'not-a-valid-boolean']) {
      process.env.AI_PAID_CALLS_ENABLED = flag
      const out = await invoke({admin,provider:async()=>{calls++}})
      assert.equal(out.httpStatus,503)
    }
    assert.equal(admin.calls.length,0); assert.equal(calls,0)
  } finally { if(saved===undefined)delete process.env.AI_PAID_CALLS_ENABLED;else process.env.AI_PAID_CALLS_ENABLED=saved;restore() }
})

test('explicit zero and invalid monetary budgets never fall back to a spendable default', async () => {
  const restore = environment(); const keys=['AI_DAILY_BUDGET_USD','AI_MONTHLY_BUDGET_USD','AI_USER_DAILY_BUDGET_USD','AI_USER_MONTHLY_BUDGET_USD']
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let paid=0
  try {
    for(const key of keys) {
      for(const value of ['0','-1','not-a-number']) {
        process.env[key]=value
        const admin=database();const out=await invoke({admin,provider:async()=>{paid++}})
        assert.ok(out.httpStatus>=400);assert.equal(admin.calls.length,0)
      }
      delete process.env[key]
    }
    assert.equal(paid,0)
  } finally { for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];restore() }
})

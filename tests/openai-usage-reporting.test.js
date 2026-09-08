// Historical usage reporting and read-only budget helper regressions.
// Active OpenAI routing is tested in nova-router and nova-runtime.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateAICost,
  normalizeModelName,
} from '../api/_lib/aiPricing.js'
import {
  checkGlobalBudget,
  __resetBudgetCache,
} from '../api/_lib/usageLimits.js'

// ─── Pricing OpenAI (antes caía a tarifa Sonnet, sobreestimando) ─────────────

test('normalizeModelName reconoce la familia gpt-5.x', () => {
  assert.equal(normalizeModelName('gpt-5.4-nano'), 'gpt-5.4-nano')
  assert.equal(normalizeModelName('gpt-5.4-mini-2026-03-17'), 'gpt-5.4-mini')
  assert.equal(normalizeModelName('gpt-5.5'), 'gpt-5.5')
  assert.equal(normalizeModelName('gpt-5.4'), 'gpt-5.4')
})

test('calculateAICost usa precios configurados para gpt-5.x (no fallback)', () => {
  const nano = calculateAICost({ model: 'gpt-5.4-nano', input_tokens: 1_000_000, output_tokens: 0 })
  assert.equal(nano.cost_usd, 0.20)
  assert.equal(nano.pricing_source, 'configured')
  assert.equal(nano.pricing_model, 'gpt-5.4-nano')

  const mini = calculateAICost({ model: 'gpt-5.4-mini', input_tokens: 1_000_000, output_tokens: 1_000_000 })
  assert.equal(mini.cost_usd, 5.25) // 0.75 + 4.50
  assert.equal(mini.pricing_source, 'configured')

  const hard = calculateAICost({ model: 'gpt-5.5', input_tokens: 0, output_tokens: 1_000_000 })
  assert.equal(hard.cost_usd, 30.00)
  assert.equal(hard.pricing_source, 'configured')
})

// ─── Corta-circuito de presupuesto ──────────────────────────────────────────

function fakeAdmin(rows) {
  const q = {
    select() { return this },
    gte() { return this },
    lte() { return this },
    order() { return this },
    range(from, to) { return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null }) },
  }
  return { from() { return q } }
}

test('presupuesto: sin env configurado → no corta (soft)', async () => {
  delete process.env.AI_DAILY_BUDGET_USD
  delete process.env.AI_MONTHLY_BUDGET_USD
  __resetBudgetCache()
  const r = await checkGlobalBudget(fakeAdmin([]))
  assert.equal(r.ok, true)
  assert.equal(r.soft, true)
  assert.equal(r.reason, 'no_budget')
})

test('presupuesto: gasto bajo el tope diario → ok', async () => {
  process.env.AI_DAILY_BUDGET_USD = '1.00'
  __resetBudgetCache()
  const now = new Date().toISOString()
  const r = await checkGlobalBudget(fakeAdmin([
    { estimated_cost_usd: 0.3, created_at: now },
    { estimated_cost_usd: 0.2, created_at: now },
  ]))
  assert.equal(r.ok, true)
  assert.equal(r.dailySpent, 0.5)
  delete process.env.AI_DAILY_BUDGET_USD
})

test('presupuesto: gasto sobre el tope diario → corta (ok:false)', async () => {
  process.env.AI_DAILY_BUDGET_USD = '1.00'
  __resetBudgetCache()
  const now = new Date().toISOString()
  const r = await checkGlobalBudget(fakeAdmin([
    { estimated_cost_usd: 0.8, created_at: now },
    { estimated_cost_usd: 0.7, created_at: now },
  ]))
  assert.equal(r.ok, false)
  assert.equal(r.period, 'daily')
  assert.equal(r.budget, 1.00)
  assert.ok(r.spent >= 1.0)
  assert.ok(typeof r.message === 'string' && r.message.length > 0)
  delete process.env.AI_DAILY_BUDGET_USD
})

test('presupuesto: error de DB bloquea nuevas llamadas pagadas', async () => {
  process.env.AI_DAILY_BUDGET_USD = '1.00'
  __resetBudgetCache()
  const admin = { from() { throw new Error('database unavailable') } }
  const r = await checkGlobalBudget(admin)
  assert.equal(r.ok, false)
  assert.equal(r.unavailable, true)
  delete process.env.AI_DAILY_BUDGET_USD
})

test('presupuesto: lee más de 1000 cargos antes de decidir', async () => {
  process.env.AI_DAILY_BUDGET_USD = '1.00'
  __resetBudgetCache()
  const rows = Array.from({ length: 1501 }, () => ({ estimated_cost_usd: 0.0008, created_at: new Date().toISOString() }))
  const result = await checkGlobalBudget(fakeAdmin(rows))
  assert.equal(result.ok, false)
  assert.equal(result.spent, 1.2008)
  delete process.env.AI_DAILY_BUDGET_USD
})

test('presupuesto: un fallo en páginas siguientes no usa un subtotal incompleto', async () => {
  process.env.AI_DAILY_BUDGET_USD = '10'
  __resetBudgetCache()
  const rows = Array.from({ length: 1000 }, () => ({ estimated_cost_usd: 0.001, created_at: new Date().toISOString() }))
  const admin = { from() { return { select() { return this }, gte() { return this }, lte() { return this },
    order() { return this }, range(from) { return Promise.resolve(from === 0
      ? { data: rows, count: 1001, error: null } : { data: null, error: { code: 'XX001' } }) } } } }
  const result = await checkGlobalBudget(admin)
  assert.equal(result.ok, false)
  assert.equal(result.unavailable, true)
  delete process.env.AI_DAILY_BUDGET_USD
})

test('presupuesto: agrega en SQL cuando la migración está disponible', async () => {
  process.env.AI_DAILY_BUDGET_USD = '1'
  __resetBudgetCache()
  const result = await checkGlobalBudget({ rpc: async (name) => {
    assert.equal(name, 'focus_ai_budget_totals')
    return { data: [{ daily_spent: '1.5', monthly_spent: '25.00' }], error: null }
  }, from() { assert.fail('must use aggregate') } })
  assert.equal(result.ok, false)
  assert.equal(result.spent, 1.5)
  delete process.env.AI_DAILY_BUDGET_USD
})

test('presupuesto: nuevas solicitudes observan cargos posteriores a un resultado aprobado', async () => {
  process.env.AI_DAILY_BUDGET_USD = '1'
  __resetBudgetCache()
  assert.equal((await checkGlobalBudget(fakeAdmin([]))).ok, true)
  const rows = [{ estimated_cost_usd: 2, created_at: new Date().toISOString() }]
  assert.equal((await checkGlobalBudget(fakeAdmin(rows))).ok, false)
  delete process.env.AI_DAILY_BUDGET_USD
})


test('presupuesto: respeta un límite PostgREST personalizado menor a 1000', async () => {
  process.env.AI_DAILY_BUDGET_USD = '1'
  __resetBudgetCache()
  const rows = Array.from({ length: 1501 }, () => ({ estimated_cost_usd: 0.0008, created_at: new Date().toISOString() }))
  let pages = 0
  const admin = { from() { return { select() { return this }, gte() { return this }, lte() { return this },
    order() { return this }, range(from) { pages++; return Promise.resolve({ data: rows.slice(from, from + 500), count: rows.length, error: null }) },
  } } }
  const result = await checkGlobalBudget(admin)
  assert.equal(result.ok, false)
  assert.equal(result.spent, 1.2008)
  assert.equal(pages, 4)
  delete process.env.AI_DAILY_BUDGET_USD
})

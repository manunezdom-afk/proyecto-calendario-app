// Tests del router de modelos OpenAI por complejidad, el corta-circuito de
// presupuesto global, y el pricing de los modelos gpt-5.x (Fase 0 del plan de
// lanzamiento). Todo determinista — no llama a ninguna API.
//
// Runner: node --test (mismo que el resto de tests/).

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  __selectOpenAIModel as selectOpenAIModel,
  __detectVeryComplexInput as detectVeryComplex,
  __escalateOpenAITier as escalateOpenAITier,
} from '../api/focus-assistant.js'
import {
  calculateAICost,
  normalizeModelName,
} from '../api/_lib/aiPricing.js'
import {
  checkGlobalBudget,
  __resetBudgetCache,
} from '../api/_lib/usageLimits.js'

// ─── Router: selección de tier ──────────────────────────────────────────────

test('router: mensaje simple → nano (barato, effort low, tope 800)', () => {
  const r = selectOpenAIModel('gym a las 5', [])
  assert.equal(r.tier, 'nano')
  assert.equal(r.model, 'gpt-5.4-nano')
  assert.equal(r.effort, 'low')
  assert.equal(r.maxOutputTokens, 800)
})

test('router: conversacional/emocional → mini', () => {
  const r = selectOpenAIModel('estoy colapsado, ayúdame a ordenar el día', [])
  assert.equal(r.tier, 'mini')
  assert.equal(r.model, 'gpt-5.4-mini')
})

test('router: respuesta a clarificación → mini', () => {
  const history = [{ role: 'assistant', content: '¿A qué hora?' }]
  const r = selectOpenAIModel('a las 6', history)
  assert.equal(r.tier, 'mini')
})

test('router: ≥3 marcas de hora + premium habilitado → hard (gpt-5.5)', () => {
  process.env.AI_ENABLE_PREMIUM_FALLBACK = 'true'
  try {
    const r = selectOpenAIModel('mañana clase a las 10, trabajo a las 3 y cena a las 9', [])
    assert.equal(r.tier, 'hard')
    assert.equal(r.model, 'gpt-5.5')
    assert.equal(r.maxOutputTokens, 1280)
  } finally {
    delete process.env.AI_ENABLE_PREMIUM_FALLBACK
  }
})

test('router: premium APAGADO por defecto → lo muy complejo va a mini, nunca gpt-5.5', () => {
  delete process.env.AI_ENABLE_PREMIUM_FALLBACK
  const r = selectOpenAIModel('mañana clase a las 10, trabajo a las 3 y cena a las 9', [])
  assert.equal(r.tier, 'mini')
  assert.equal(r.model, 'gpt-5.4-mini')
})

test('escalada: nano→mini siempre; mini→hard solo con premium habilitado', () => {
  delete process.env.AI_ENABLE_PREMIUM_FALLBACK
  assert.equal(escalateOpenAITier({ tier: 'nano' }).tier, 'mini')
  assert.equal(escalateOpenAITier({ tier: 'mini' }), null) // apagado → cae a Claude
  process.env.AI_ENABLE_PREMIUM_FALLBACK = 'true'
  try {
    assert.equal(escalateOpenAITier({ tier: 'mini' }).tier, 'hard')
  } finally {
    delete process.env.AI_ENABLE_PREMIUM_FALLBACK
  }
})

test('router: 2 eventos (no muy complejo) → mini, no hard', () => {
  const r = selectOpenAIModel('reunión con Juan a las 9 y gym a las 7', [])
  assert.equal(r.tier, 'mini')
})

test('router: OPENAI_NOVA_MODEL fuerza modelo único (tier forced)', () => {
  process.env.OPENAI_NOVA_MODEL = 'gpt-5.5'
  try {
    const r = selectOpenAIModel('gym a las 5', [])
    assert.equal(r.tier, 'forced')
    assert.equal(r.model, 'gpt-5.5')
  } finally {
    delete process.env.OPENAI_NOVA_MODEL
  }
})

test('detectVeryComplexInput: texto muy largo dispara hard', () => {
  assert.equal(detectVeryComplex('x'.repeat(210)), true)
  assert.equal(detectVeryComplex('gym a las 5'), false)
})

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
    gte() { return Promise.resolve({ data: rows, error: null }) },
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

test('presupuesto: error de DB → no corta (soft, malla dura del proveedor protege)', async () => {
  process.env.AI_DAILY_BUDGET_USD = '1.00'
  __resetBudgetCache()
  const admin = { from() { return { select() { return this }, gte() { return Promise.resolve({ data: null, error: { message: 'boom' } }) } } } }
  const r = await checkGlobalBudget(admin)
  assert.equal(r.ok, true)
  assert.equal(r.soft, true)
  delete process.env.AI_DAILY_BUDGET_USD
})

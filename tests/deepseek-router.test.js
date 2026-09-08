// Tests del path DeepSeek (proveedor principal de Nova, 2026-07-13):
// router flash/pro, pricing cache-aware, normalización del payload JSON-mode
// y extracción defensiva. Todo determinista — no llama a ninguna API.
//
// Runner: node --test (mismo que el resto de tests/).

import assert from 'node:assert/strict'
import test from 'node:test'
import { wirePlan, wireAction } from './helpers/novaFixtures.js'

import { __selectDeepSeekModel as selectDeepSeekModel } from './helpers/legacyNovaRouting.js'
import {
  estimateDeepSeekCostUSD,
  normalizeDeepSeekPayload,
  extractDeepSeekText,
  buildDeepSeekJsonAppendix,
  callDeepSeekNova,
} from '../api/_lib/deepseekNova.js'
import { calculateAICost, normalizeModelName } from '../api/_lib/aiPricing.js'

// ─── Router: selección de tier ──────────────────────────────────────────────

test('deepseek router: mensaje simple → flash (cheap)', () => {
  const r = selectDeepSeekModel('gym a las 5', [])
  assert.equal(r.tier, 'cheap')
  assert.equal(r.model, 'deepseek-v4-flash')
  assert.equal(r.maxOutputTokens, 800)
})

test('deepseek router: mensaje normal (sin señales complejas) → flash igual', () => {
  const r = selectDeepSeekModel('mañana a las 8 reunión con Juan Pablo', [])
  assert.equal(r.tier, 'cheap')
  assert.equal(r.model, 'deepseek-v4-flash')
})

test('deepseek router: complejo/emocional → pro', () => {
  const r = selectDeepSeekModel('estoy colapsado, ayúdame a ordenar el día', [])
  assert.equal(r.tier, 'pro')
  assert.equal(r.model, 'deepseek-v4-pro')
})

test('deepseek router: multi-evento pesado → pro (nunca GPT)', () => {
  const r = selectDeepSeekModel('mañana clase a las 10, trabajo a las 3 y cena a las 9', [])
  assert.equal(r.tier, 'pro')
  assert.equal(r.model, 'deepseek-v4-pro')
})

test('deepseek router: respuesta a clarificación → pro', () => {
  const history = [{ role: 'assistant', content: '¿A qué hora?' }]
  const r = selectDeepSeekModel('a las 6', history)
  assert.equal(r.tier, 'pro')
})

test('deepseek router: DEEPSEEK_NOVA_MODEL fuerza modelo único (forced)', () => {
  process.env.DEEPSEEK_NOVA_MODEL = 'deepseek-v4-pro'
  try {
    const r = selectDeepSeekModel('gym a las 5', [])
    assert.equal(r.tier, 'forced')
    assert.equal(r.model, 'deepseek-v4-pro')
  } finally {
    delete process.env.DEEPSEEK_NOVA_MODEL
  }
})

test('deepseek router: AI_MAX_OUTPUT_TOKENS acota la salida de todos los tiers', () => {
  process.env.AI_MAX_OUTPUT_TOKENS = '600'
  try {
    assert.equal(selectDeepSeekModel('gym a las 5', []).maxOutputTokens, 600)
    assert.equal(selectDeepSeekModel('estoy colapsado, ayúdame', []).maxOutputTokens, 600)
  } finally {
    delete process.env.AI_MAX_OUTPUT_TOKENS
  }
})

// ─── Pricing ─────────────────────────────────────────────────────────────────

test('normalizeModelName reconoce la familia deepseek-v4', () => {
  assert.equal(normalizeModelName('deepseek-v4-flash'), 'deepseek-v4-flash')
  assert.equal(normalizeModelName('deepseek-v4-pro'), 'deepseek-v4-pro')
  assert.equal(normalizeModelName('deepseek-v4-flash-2026-07-01'), 'deepseek-v4-flash')
  // legacy deprecado → null (fallback conservador, no gratis)
  assert.equal(normalizeModelName('deepseek-chat'), null)
})

test('calculateAICost usa precios configurados para deepseek (no fallback)', () => {
  const flash = calculateAICost({ model: 'deepseek-v4-flash', input_tokens: 1_000_000, output_tokens: 1_000_000 })
  assert.equal(flash.cost_usd, 1.76) // 0.44 + 1.32
  assert.equal(flash.pricing_source, 'configured')

  const pro = calculateAICost({ model: 'deepseek-v4-pro', input_tokens: 1_000_000, output_tokens: 0 })
  assert.equal(pro.cost_usd, 1.32)
  assert.equal(pro.pricing_source, 'configured')
})

test('estimateDeepSeekCostUSD: cache hit reduces billed input at verified current rates', () => {
  // 7000 input todos miss + 700 output
  const allMiss = estimateDeepSeekCostUSD('deepseek-v4-flash', {
    prompt_tokens: 7000, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 7000, completion_tokens: 700,
  })
  // 7000×0.14/1M + 700×0.28/1M = 0.00098 + 0.000196
  assert.equal(allMiss, 0.004004)

  // 5000 hit + 2000 miss + 700 output — el prompt cacheado casi no cuesta
  const mostlyHit = estimateDeepSeekCostUSD('deepseek-v4-flash', {
    prompt_tokens: 7000, prompt_cache_hit_tokens: 5000, prompt_cache_miss_tokens: 2000, completion_tokens: 700,
  })
  assert.ok(mostlyHit < allMiss / 2, `esperaba ${mostlyHit} < ${allMiss / 2}`)

  // sin desglose hit/miss → asume todo miss (conservador)
  const noBreakdown = estimateDeepSeekCostUSD('deepseek-v4-flash', {
    prompt_tokens: 7000, completion_tokens: 700,
  })
  assert.equal(noBreakdown, allMiss)

  // modelo desconocido → null (el caller cae al pricing genérico)
  assert.equal(estimateDeepSeekCostUSD('otro-modelo', { prompt_tokens: 100 }), null)
})

// ─── Normalización del payload (JSON mode sin schema estricto) ───────────────

test('DeepSeek preserves a complete valid wire plan without inventing fields', () => {
  const plan = wirePlan([wireAction()])
  assert.deepEqual(normalizeDeepSeekPayload(plan), plan)
})
test('DeepSeek rejects missing fields, invalid arrays and null actions without partial execution', () => {
  for (const input of [null, {}, { actions: 'nope' }, { actions: [{ type: 'create_event', title: 'X', durationMinutes: '45' }] }, wirePlan([wireAction(), null])]) {
    assert.throws(() => normalizeDeepSeekPayload(input), /invalid_schema/)
  }
})
test('DeepSeek extraction preserves raw text for strict JSON parsing and rejects truncated output', () => {
  const wrap = content => ({ choices: [{ message: { content } }] })
  assert.equal(extractDeepSeekText(wrap('{"a":1}')), '{"a":1}')
  assert.throws(() => JSON.parse(extractDeepSeekText(wrap('```json\n{"a":1}\n```'))))
  assert.throws(() => extractDeepSeekText(wrap('')), /empty_output/)
  assert.throws(() => extractDeepSeekText({}), /empty_output/)
  assert.throws(() => extractDeepSeekText({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), /incomplete_output/)
})

test('callDeepSeekNova manda thinking DISABLED por defecto (bug prod 2026-07-24: content vacío)', async (t) => {
  // Los V4 traen thinking enabled por defecto; el razonamiento consume
  // max_tokens y deja content vacío → Nova degradaba al parser local en el
  // 100% de los mensajes. Este test fija el contrato del request.
  const originalFetch = globalThis.fetch
  let sentBody = null
  globalThis.fetch = async (_url, opts) => {
    sentBody = JSON.parse(opts.body)
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }
  }
  t.after(() => { globalThis.fetch = originalFetch })

  await callDeepSeekNova({ message: 'hola', systemPrompt: 'json', apiKey: 'test', history: [] })
  assert.deepEqual(sentBody.thinking, { type: 'disabled' })
  assert.equal(sentBody.response_format.type, 'json_object')
  assert.ok(sentBody.max_tokens > 0)

  process.env.DEEPSEEK_THINKING = 'enabled'
  try {
    await callDeepSeekNova({ message: 'hola', systemPrompt: 'json', apiKey: 'test', history: [] })
    assert.deepEqual(sentBody.thinking, { type: 'enabled' })
  } finally {
    delete process.env.DEEPSEEK_THINKING
  }
})

test('buildDeepSeekJsonAppendix cumple los requisitos de JSON mode (palabra json + ejemplo)', () => {
  const appendix = buildDeepSeekJsonAppendix('2026-07-13')
  assert.ok(/json/i.test(appendix))
  assert.ok(appendix.includes('"actions"'))
  assert.ok(appendix.includes('additionalProperties')) // schema exacto compartido
  assert.ok(appendix.includes('userConfirmationText'))
})

// Tests unitarios de api/_lib/aiPricing.js + aiUsageTracking.js
//
// Cubren:
//   * cálculo de costo Haiku vs Sonnet
//   * normalización de model id con sufijo de fecha
//   * fallback de modelo desconocido
//   * extracción de usage de respuestas Anthropic
//   * trackAIUsageEvent inserta fila correcta y no rompe sin admin

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateAICost,
  getModelPricing,
  normalizeModelName,
  PRICING_REVIEW_UNTIL,
  __test__ as pricingInternals,
} from '../api/_lib/aiPricing.js'

import {
  extractAnthropicUsage,
  trackAIUsageEvent,
} from '../api/_lib/aiUsageTracking.js'

// ─── normalizeModelName ─────────────────────────────────────────────────────

test('normalizeModelName quita el sufijo de fecha', () => {
  assert.equal(normalizeModelName('claude-haiku-4-5-20251001'), 'claude-haiku-4-5')
  assert.equal(normalizeModelName('claude-sonnet-4-6-20251022'), 'claude-sonnet-4-6')
  assert.equal(normalizeModelName('claude-opus-4-7-20251015'), 'claude-opus-4-7')
})

test('normalizeModelName con id ya normalizado pasa', () => {
  assert.equal(normalizeModelName('claude-haiku-4-5'), 'claude-haiku-4-5')
})

test('normalizeModelName devuelve null para no-Anthropic', () => {
  assert.equal(normalizeModelName('gpt-4o'), null)
  assert.equal(normalizeModelName(''), null)
  assert.equal(normalizeModelName(null), null)
  assert.equal(normalizeModelName(undefined), null)
})

// ─── calculateAICost ────────────────────────────────────────────────────────

test('Haiku 4.5: costo se calcula con $1 input / $5 output por M', () => {
  // 1M input + 1M output → $1 + $5 = $6
  const r = calculateAICost({
    model: 'claude-haiku-4-5-20251001',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
  })
  assert.equal(r.cost_usd, 6)
  assert.equal(r.pricing_source, 'configured')
  assert.equal(r.pricing_model, 'claude-haiku-4-5')
})

test('Haiku 4.5: 500 input + 1000 output = $0.0055', () => {
  const r = calculateAICost({
    model: 'claude-haiku-4-5-20251001',
    input_tokens: 500,
    output_tokens: 1000,
  })
  // 500 * 1 / 1M + 1000 * 5 / 1M = 0.0005 + 0.005 = 0.0055
  assert.equal(r.cost_usd, 0.0055)
})

test('Sonnet 4.6: $3 input / $15 output por M', () => {
  const r = calculateAICost({
    model: 'claude-sonnet-4-6',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
  })
  assert.equal(r.cost_usd, 18)
  assert.equal(r.pricing_source, 'configured')
})

test('Modelo desconocido conserva estimación legacy, pero no habilita admisión', () => {
  const r = calculateAICost({
    model: 'claude-haiku-9-9-future',
    input_tokens: 1_000_000,
    output_tokens: 0,
  })
  assert.equal(r.pricing_source, 'fallback')
  // Fallback es Sonnet pricing → 1M input * $3 = $3
  assert.equal(r.cost_usd, 3)
  assert.equal(getModelPricing('claude-haiku-9-9-future', { requireCurrent: true }), null)
})

test('cost_usd con 0 tokens devuelve 0', () => {
  const r = calculateAICost({
    model: 'claude-haiku-4-5',
    input_tokens: 0,
    output_tokens: 0,
  })
  assert.equal(r.cost_usd, 0)
  assert.equal(r.pricing_source, 'zero')
})

test('cost_usd ignora valores negativos o NaN', () => {
  const r = calculateAICost({
    model: 'claude-haiku-4-5',
    input_tokens: -5,
    output_tokens: NaN,
  })
  assert.equal(r.cost_usd, 0)
})

test('cost_usd se redondea a 6 decimales', () => {
  const r = calculateAICost({
    model: 'claude-haiku-4-5',
    input_tokens: 1,
    output_tokens: 1,
  })
  // 1*1/1M + 1*5/1M = 0.000001 + 0.000005 = 0.000006
  assert.equal(r.cost_usd, 0.000006)
})

test('getModelPricing devuelve null para desconocidos sin fallback', () => {
  assert.equal(getModelPricing('gpt-4o'), null)
  assert.equal(getModelPricing(''), null)
})

test('PRICING_PER_MILLION cubre los modelos esperados', () => {
  const expected = ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7']
  for (const m of expected) {
    assert.ok(pricingInternals.PRICING_PER_MILLION[m], `falta pricing para ${m}`)
  }
})

// Tarifas y categorías actuales. Fechas fijadas: estas pruebas no dependen de
// la hora de ejecución ni reactivan modelos cuando venza la revisión manual.
const verifiedDate = '2026-09-08T12:00:00.000Z'

test('IDs nuevos no se confunden con familias o variantes sin precio', () => {
  assert.equal(normalizeModelName('GPT-5.6-LUNA'), 'gpt-5.6-luna')
  assert.equal(normalizeModelName('claude-sonnet-5'), 'claude-sonnet-5')
  assert.equal(normalizeModelName('gemini-3.8-flash'), 'gemini-3.8-flash')
  for (const unknown of ['gpt-5.6', 'gpt-5.6-luna-free', 'gpt-5.4-pro',
    'deepseek-v4-flash-vision-exp', 'claude-sonnet-5-future', 'gemini-3.8-flash-preview']) {
    assert.equal(getModelPricing(unknown), null, unknown)
  }
})

test('admisión falla cerrada si venció revisión, fecha inválida o modelo retirado', () => {
  assert.ok(getModelPricing('gpt-5.6-luna', { at: verifiedDate, requireCurrent: true }))
  assert.equal(getModelPricing('gpt-5.6-luna', { at: PRICING_REVIEW_UNTIL, requireCurrent: true }), null)
  assert.equal(getModelPricing('gpt-5.6-luna', { at: 'fecha inválida', requireCurrent: true }), null)
  assert.equal(getModelPricing('claude-haiku-3-5', { at: verifiedDate, requireCurrent: true }), null)
  assert.equal(getModelPricing('gpt-5.6-luna', { at: PRICING_REVIEW_UNTIL }).stale, true)
})

test('OpenAI cache reads/writes no se cobran dos veces como input ordinario', () => {
  const result = calculateAICost({ model: 'gpt-5.6-luna', at: verifiedDate,
    input_tokens: 15_000, cached_input_tokens: 12_000, cache_creation_input_tokens: 3_000,
    output_tokens: 1_000 })
  // 12k * .02 + 3k * .25 + 1k * 1.2, por millón.
  assert.equal(result.cost_usd, 0.00219)
  assert.equal(result.usage_inconsistent, false)
})

test('Anthropic input ya excluye caché y desglose TTL no duplica creación total', () => {
  const result = calculateAICost({ model: 'claude-haiku-4-5-20251001', at: verifiedDate,
    input_tokens: 1_000, cache_read_input_tokens: 10_000,
    cache_creation_input_tokens: 3_000,
    cache_creation_5m_input_tokens: 2_000, cache_creation_1h_input_tokens: 1_000,
    output_tokens: 500 })
  // .001 input + .001 read + .0025 write5m + .002 write1h + .0025 output.
  assert.equal(result.cost_usd, 0.009)
  assert.equal(result.usage_inconsistent, false)
})

test('creación Anthropic con TTL ausente se estima con la tarifa mayor', () => {
  const result = calculateAICost({ model: 'claude-haiku-4-5', at: verifiedDate,
    input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000 })
  assert.equal(result.cost_usd, 0.002)
  assert.equal(result.pricing_source, 'configured')
})

test('caché incoherente no genera descuento falso ni coste negativo', () => {
  const result = calculateAICost({ model: 'gpt-5.6-luna', at: verifiedDate,
    input_tokens: 1_000, cached_input_tokens: 1_001 })
  assert.equal(result.usage_inconsistent, true)
  assert.ok(result.cost_usd_unrounded >= 1_000 * 0.20 / 1_000_000)
})

test('OpenAI aplica tramo largo solamente después de 272000 tokens', () => {
  const normal = getModelPricing('gpt-5.6-terra', { at: verifiedDate, inputTokens: 272_000 })
  const long = getModelPricing('gpt-5.6-terra', { at: verifiedDate, inputTokens: 272_001 })
  assert.equal(normal.input, 2)
  assert.equal(long.input, 4)
  assert.equal(long.cachedInput, 0.4)
  assert.equal(long.cacheWrite, 5)
  assert.equal(long.output, 18)
})

test('DeepSeek usa límites UTC exactos y reserva a pico incluso durante valle', () => {
  const actual = at => getModelPricing('deepseek-v4-flash', { at, conservative: false })
  assert.equal(actual('2026-09-08T00:59:59Z').input, 0.22)
  assert.equal(actual('2026-09-08T01:00:00Z').input, 0.44)
  assert.equal(actual('2026-09-08T04:00:00Z').input, 0.22)
  assert.equal(actual('2026-09-08T06:00:00Z').input, 0.44)
  assert.equal(actual('2026-09-08T10:00:00Z').input, 0.22)
  assert.equal(actual('2026-09-12T02:00:00Z').input, 0.22)
  assert.equal(getModelPricing('deepseek-v4-flash', { at: verifiedDate }).input, 0.44)
  assert.equal(actual('2026-08-16T15:59:59Z'), null)
})

test('DeepSeek cache-aware sigue tarifa documentada y no duplica el prompt', () => {
  const result = calculateAICost({ model: 'deepseek-v4-pro', at: verifiedDate,
    input_tokens: 1_000_000, cached_input_tokens: 800_000, output_tokens: 10_000 })
  assert.equal(result.cost_usd, 0.3388)
})

test('Gemini cambia precio al cutoff y la reserva evita depender de promoción', () => {
  const actual = at => getModelPricing('gemini-3.8-flash', { at, conservative: false })
  assert.equal(actual('2026-12-31T23:59:59.999Z').input, 0.75)
  assert.equal(actual('2027-01-01T00:00:00.000Z').input, 1.5)
  assert.equal(actual('2027-01-01T00:00:00.000Z').output, 7.5)
  assert.equal(actual('2027-01-01T00:00:00.000Z').cacheStoragePerMillionHour, 1)
  assert.equal(getModelPricing('gemini-3.8-flash', { at: verifiedDate }).input, 1.5)
  assert.equal(getModelPricing('gemini-3.8-flash', {
    at: '2027-01-01T00:00:00Z', requireCurrent: true }), null)
})

test('Sonnet 5 conserva precio estándar y Opus 4.7 corrige tarifa antigua', () => {
  assert.equal(getModelPricing('claude-sonnet-5', { at: verifiedDate }).output, 10)
  assert.equal(getModelPricing('claude-opus-4-7', { at: verifiedDate }).input, 5)
})

test('acumulación de presupuesto dispone de precisión sin redondeo por llamada', () => {
  const result = calculateAICost({ model: 'gpt-5.6-luna', at: verifiedDate, input_tokens: 1 })
  assert.ok(Math.abs(result.cost_usd_unrounded - 0.0000002) < 1e-20)
  assert.ok(Number.isFinite(calculateAICost({ model: 'gpt-5.6-luna',
    at: verifiedDate, input_tokens: Infinity, output_tokens: NaN }).cost_usd))
})

// ─── extractAnthropicUsage ──────────────────────────────────────────────────

test('extractAnthropicUsage parsea response del SDK', () => {
  const r = extractAnthropicUsage({
    usage: { input_tokens: 123, output_tokens: 45 },
  })
  assert.equal(r.input_tokens, 123)
  assert.equal(r.output_tokens, 45)
  assert.equal(r.source, 'anthropic_usage')
})

test('extractAnthropicUsage captura tokens de cache cuando vienen', () => {
  const r = extractAnthropicUsage({
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 0,
    },
  })
  assert.equal(r.cache_read_input_tokens, 200)
  assert.equal(r.cache_creation_input_tokens, undefined) // 0 → no se incluye
})

test('extractAnthropicUsage sin usage devuelve unavailable', () => {
  assert.equal(extractAnthropicUsage(null).source, 'unavailable')
  assert.equal(extractAnthropicUsage({}).source, 'unavailable')
  assert.equal(extractAnthropicUsage({ usage: null }).source, 'unavailable')
})

test('extractAnthropicUsage con 0/0 devuelve unavailable', () => {
  const r = extractAnthropicUsage({ usage: { input_tokens: 0, output_tokens: 0 } })
  assert.equal(r.source, 'unavailable')
})

// ─── trackAIUsageEvent ──────────────────────────────────────────────────────

function makeFakeAdmin() {
  const inserts = []
  return {
    inserts,
    from(table) {
      assert.equal(table, 'ai_usage_events', `tabla inesperada: ${table}`)
      return {
        insert(row) {
          inserts.push(row)
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  }
}

test('trackAIUsageEvent inserta fila con tokens y costo', async () => {
  const admin = makeFakeAdmin()
  await trackAIUsageEvent({
    admin,
    userId: 'aaa-bbb',
    action_type: 'nova_message',
    endpoint: 'focus-assistant',
    model: 'claude-haiku-4-5-20251001',
    anthropicResponse: { usage: { input_tokens: 1000, output_tokens: 500 } },
    success: true,
    duration_ms: 1234,
    metadata: { plan: 'free' },
  })
  assert.equal(admin.inserts.length, 1)
  const row = admin.inserts[0]
  assert.equal(row.user_id, 'aaa-bbb')
  assert.equal(row.action_type, 'nova_message')
  assert.equal(row.model_used, 'claude-haiku-4-5') // normalizado
  assert.equal(row.input_tokens, 1000)
  assert.equal(row.output_tokens, 500)
  // 1000 * 1 / 1M + 500 * 5 / 1M = 0.001 + 0.0025 = 0.0035
  assert.equal(row.estimated_cost_usd, 0.0035)
  assert.equal(row.metadata.endpoint, 'focus-assistant')
  assert.equal(row.metadata.plan, 'free')
  assert.equal(row.metadata.success, true)
  assert.equal(row.metadata.duration_ms, 1234)
  assert.equal(row.metadata.usage_source, 'anthropic_usage')
})

test('trackAIUsageEvent con admin null no rompe', async () => {
  await trackAIUsageEvent({
    admin: null,
    userId: 'x',
    action_type: 'nova_message',
    endpoint: 'focus-assistant',
    model: 'claude-haiku-4-5',
  })
  // No assertion necesaria — solo verificar que no lanza
})

test('trackAIUsageEvent descarta metadata no permitida', async () => {
  const admin = makeFakeAdmin()
  await trackAIUsageEvent({
    admin,
    userId: 'aaa',
    action_type: 'nova_message',
    endpoint: 'focus-assistant',
    model: 'claude-haiku-4-5',
    anthropicResponse: { usage: { input_tokens: 10, output_tokens: 5 } },
    metadata: {
      plan: 'free',
      // Estos campos NO deberían entrar:
      user_email: 'foo@bar.com',
      message_text: 'mensaje secreto',
      api_key: 'sk-leak',
    },
  })
  const meta = admin.inserts[0].metadata
  assert.equal(meta.plan, 'free')
  assert.equal(meta.user_email, undefined)
  assert.equal(meta.message_text, undefined)
  assert.equal(meta.api_key, undefined)
})

test('trackAIUsageEvent con error de red registra success:false sin tokens', async () => {
  const admin = makeFakeAdmin()
  await trackAIUsageEvent({
    admin,
    userId: 'aaa',
    action_type: 'photo_analysis',
    endpoint: 'analyze-photo',
    model: 'claude-haiku-4-5',
    usage: { input_tokens: 0, output_tokens: 0, source: 'unavailable' },
    success: false,
    error_type: 'AbortError',
    duration_ms: 45000,
  })
  const row = admin.inserts[0]
  assert.equal(row.input_tokens, 0)
  assert.equal(row.output_tokens, 0)
  assert.equal(row.estimated_cost_usd, 0)
  assert.equal(row.metadata.success, false)
  assert.equal(row.metadata.error_type, 'AbortError')
  assert.equal(row.metadata.usage_source, 'unavailable')
})

test('trackAIUsageEvent acepta string corto en error_type pero recorta largos', async () => {
  const admin = makeFakeAdmin()
  await trackAIUsageEvent({
    admin,
    userId: 'aaa',
    action_type: 'nova_message',
    endpoint: 'focus-assistant',
    model: 'claude-haiku-4-5',
    usage: { input_tokens: 1, output_tokens: 1, source: 'anthropic_usage' },
    success: false,
    error_type: 'X'.repeat(500),
  })
  const meta = admin.inserts[0].metadata
  // Cap de 120 chars
  assert.ok(meta.error_type.length <= 120, `error_type largo: ${meta.error_type.length}`)
})

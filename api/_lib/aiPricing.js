// Tarifas de API directa, USD/1M tokens, verificadas el 2026-09-08.
// Evidencia y condiciones: docs/focus-2/AI_MODEL_RESEARCH.md.
// No habilitar modelos a partir de normalizeModelName: es solo contabilidad.
// Admisión: getModelPricing(model, { conservative: true, requireCurrent: true }).

export const PRICING_VERIFIED_AT = '2026-09-08T00:00:00.000Z'
// Revisión interna obligatoria; no es una fecha de vencimiento del proveedor.
export const PRICING_REVIEW_UNTIL = '2026-12-01T00:00:00.000Z'
const GEMINI_PRICE_CHANGE_AT = '2027-01-01T00:00:00.000Z'
const DEEPSEEK_PRICE_CHANGE_AT = '2026-08-16T16:00:00.000Z'
const CLAUDE_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing'
const DEEPSEEK_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing/'
const GEMINI_SOURCE = 'https://ai.google.dev/gemini-api/docs/pricing'

function rates(provider, input, cachedInput, output, source, extra = {}) {
  return Object.freeze({ provider, input, cachedInput, output, source, ...extra })
}
function claude(input, output, extra = {}) {
  return rates('anthropic', input, input * 0.1, output, CLAUDE_SOURCE, {
    cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, ...extra,
  })
}
function openai(model, input, cachedInput, output, extra = {}) {
  return rates('openai', input, cachedInput, output,
    `https://developers.openai.com/api/docs/models/${model}`, extra)
}

const PRICING_PER_MILLION = Object.freeze({
  'gpt-5.6-luna': openai('gpt-5.6-luna', 0.20, 0.02, 1.20, { cacheWrite: 0.25, longContextThreshold: 272_000 }),
  'gpt-5.6-terra': openai('gpt-5.6-terra', 2.00, 0.20, 12.00, { cacheWrite: 2.50, longContextThreshold: 272_000 }),
  'claude-haiku-4-5': claude(1.00, 5.00),
  'claude-sonnet-5': claude(2.00, 10.00),
  'deepseek-v4-flash': rates('deepseek', 0.44, 0.014, 1.32, DEEPSEEK_SOURCE, { effectiveFrom: DEEPSEEK_PRICE_CHANGE_AT }),
  'deepseek-v4-pro': rates('deepseek', 1.32, 0.044, 3.96, DEEPSEEK_SOURCE, { effectiveFrom: DEEPSEEK_PRICE_CHANGE_AT }),
  'gemini-3.5-flash-lite': rates('google', 0.30, 0.03, 2.50, GEMINI_SOURCE, { cacheStoragePerMillionHour: 1.00 }),
  'gemini-3.8-flash': rates('google', 0.75, 0.075, 3.75, GEMINI_SOURCE, {
    cacheStoragePerMillionHour: 0.50,
    nextPriceAt: GEMINI_PRICE_CHANGE_AT,
    nextPrice: Object.freeze({ input: 1.50, cachedInput: 0.15, output: 7.50, cacheStoragePerMillionHour: 1.00 }),
  }),
  // Modelos ya presentes en el repo: conservar contabilidad y rollback.
  // Haiku 3.5 está retirado de la API directa y no sirve para admisión nueva.
  'claude-haiku-3-5': claude(0.80, 4.00, { retired: true }),
  'claude-sonnet-4-5': claude(3.00, 15.00),
  'claude-sonnet-4-6': claude(3.00, 15.00),
  'claude-opus-4-7': claude(5.00, 25.00),
  'gpt-5.4-nano': openai('gpt-5.4-nano', 0.20, 0.02, 1.25),
  'gpt-5.4-mini': openai('gpt-5.4-mini', 0.75, 0.075, 4.50),
  'gpt-5.4': openai('gpt-5.4', 2.50, 0.25, 15.00, { longContextThreshold: 272_000 }),
  'gpt-5.5': openai('gpt-5.5', 5.00, 0.50, 30.00, { longContextThreshold: 272_000 }),
})

// Compatibilidad para reportes sin tarifa: NO es un máximo garantizado y
// nunca se usa para admitir/reservar llamadas. getModelPricing retorna null.
const FALLBACK_PRICING = Object.freeze({ input: 3.00, cachedInput: 3.00, output: 15.00 })

/** Normaliza únicamente un modelo registrado o un sufijo de snapshot fechado.
 * No confunde luna con gpt-5.6 ni acepta variantes como flash-vision-exp.
 * Reconocer la familia tarifaria de un snapshot no certifica su disponibilidad.
 */
export function normalizeModelName(modelId) {
  if (typeof modelId !== 'string' || !modelId.trim()) return null
  const name = modelId.trim().toLowerCase()
  if (Object.hasOwn(PRICING_PER_MILLION, name)) return name
  const base = name.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, '')
  return base !== name && Object.hasOwn(PRICING_PER_MILLION, base) ? base : null
}

function parsedDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}
function tokens(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}
function isDeepSeekPeak(date) {
  const day = date.getUTCDay()
  const hour = date.getUTCHours()
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
}

/**
 * at: fecha de la llamada (UTC); conservative reserva al máximo documentado.
 * requireCurrent bloquea tarifas no revisadas/retiradas, nunca usa fallback.
 * inputTokens permite aplicar el tramo >272K de OpenAI. Focus limita mucho más.
 */
export function getModelPricing(modelId, {
  at = new Date(), conservative = true, requireCurrent = false, inputTokens = 0,
} = {}) {
  const model = normalizeModelName(modelId)
  const base = model && PRICING_PER_MILLION[model]
  const date = parsedDate(at)
  if (!base || !date) return null
  const timestamp = date.getTime()
  const stale = timestamp < Date.parse(PRICING_VERIFIED_AT) || timestamp >= Date.parse(PRICING_REVIEW_UNTIL)
  const beforeEffective = base.effectiveFrom && timestamp < Date.parse(base.effectiveFrom)
  if (beforeEffective || (requireCurrent && (stale || base.retired))) return null
  let selected = { ...base }
  let period = 'standard'
  if (base.provider === 'deepseek') {
    period = conservative || isDeepSeekPeak(date) ? 'peak' : 'off_peak'
    if (period === 'off_peak') {
      selected.input /= 2
      selected.cachedInput /= 2
      selected.output /= 2
    }
  }
  if (base.nextPriceAt) {
    // No presupuestar la promoción al reservar: la llamada puede cruzar cutoff.
    if (conservative || timestamp >= Date.parse(base.nextPriceAt)) {
      selected = { ...selected, ...base.nextPrice }
      period = timestamp >= Date.parse(base.nextPriceAt) ? 'standard_2027' : 'future_rate_reserve'
    } else {
      period = 'introductory_2026'
    }
  }
  const longContext = !!base.longContextThreshold && tokens(inputTokens) > base.longContextThreshold
  if (longContext) {
    selected.input *= 2
    selected.cachedInput *= 2
    if (selected.cacheWrite != null) selected.cacheWrite *= 2
    selected.output *= 1.5
  }
  return Object.freeze({ ...selected, model, verifiedAt: PRICING_VERIFIED_AT,
    reviewUntil: PRICING_REVIEW_UNTIL, stale, period, longContext })
}

/**
 * Costo estimado compatible con los callers anteriores.
 * - Anthropic input_tokens EXCLUYE lecturas/escrituras: se suman aparte.
 * - OpenAI/DeepSeek/Google input_tokens INCLUYE caché: se resta antes de sumar.
 * input_tokens_include_cache permite normalizar explícitamente otros formatos.
 * cache_creation_input_tokens es total de escrituras; el desglose 5m/1h no se
 * vuelve a sumar. TTL desconocido usa la tarifa mayor documentada.
 * output_tokens debe incluir razonamiento facturable, sin sumarlo dos veces.
 * No incluye almacenamiento de caché Gemini ni herramientas alojadas.
 */
export function calculateAICost({
  model, input_tokens = 0, output_tokens = 0,
  cached_input_tokens, cache_read_input_tokens = 0,
  cache_creation_input_tokens = 0,
  cache_creation_5m_input_tokens = 0, cache_creation_1h_input_tokens = 0,
  input_tokens_include_cache, at = new Date(), conservative = true,
}) {
  const input = tokens(input_tokens)
  const output = tokens(output_tokens)
  const cacheRead = tokens(cached_input_tokens ?? cache_read_input_tokens)
  const write5m = tokens(cache_creation_5m_input_tokens)
  const write1h = tokens(cache_creation_1h_input_tokens)
  const cacheWrite = Math.max(tokens(cache_creation_input_tokens), write5m + write1h)
  const configured = getModelPricing(model, { at, conservative, inputTokens: input })
  const pricing = configured || FALLBACK_PRICING
  const includesCache = input_tokens_include_cache ?? (configured?.provider !== 'anthropic')
  // Desgloses inconsistentes no pueden borrar input no contado: cobrar la
  // mayor cantidad reportada y marcarlo para revisión sin inventar un descuento.
  const inconsistent = includesCache && cacheRead + cacheWrite > input
  const normalInput = includesCache && !inconsistent ? input - cacheRead - cacheWrite : input
  const unknownWrite = Math.max(0, cacheWrite - write5m - write1h)
  const unknownWriteRate = Math.max(pricing.cacheWrite || pricing.input,
    pricing.cacheWrite5m || pricing.input, pricing.cacheWrite1h || pricing.input)
  const total = (
    normalInput * pricing.input + cacheRead * pricing.cachedInput +
    write5m * (pricing.cacheWrite5m ?? unknownWriteRate) +
    write1h * (pricing.cacheWrite1h ?? unknownWriteRate) +
    unknownWrite * unknownWriteRate + output * pricing.output
  ) / 1_000_000
  const normalized = normalizeModelName(model)
  return {
    cost_usd: Number(total.toFixed(6)),
    cost_usd_unrounded: total,
    pricing_source: total === 0 ? 'zero' : configured ? 'configured' : 'fallback',
    pricing_model: normalized || 'unknown',
    pricing_verified_at: configured?.verifiedAt || null,
    pricing_stale: configured?.stale ?? true,
    pricing_period: configured?.period || 'unknown',
    usage_inconsistent: inconsistent,
  }
}

export const __test__ = Object.freeze({ PRICING_PER_MILLION, FALLBACK_PRICING, isDeepSeekPeak })

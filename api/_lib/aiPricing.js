// Precios de modelos Anthropic centralizados.
//
// Última revisión manual: 2026-05-07.
// Fuente oficial: https://www.anthropic.com/pricing
//
// IMPORTANTE: Anthropic puede cambiar precios en cualquier momento. Revisar
// este archivo cuando:
//   * Se anuncie un cambio de pricing.
//   * Se introduzca un modelo nuevo en focus-assistant/analyze-photo.
//   * Cambie el routing Haiku ↔ Sonnet del proyecto.
//
// Por qué un solo archivo y no una tabla en DB:
//   * Cambios de precio son raros (cuando ocurren) y deben quedar en git
//     para auditoría histórica.
//   * Editar precios en producción sin review es peligroso (un cero de más
//     y los cálculos quedan rotos para siempre).
//   * Si en el futuro queremos UI de admin para editarlo, migrarlo a tabla
//     con lectura cacheada es directo: la API de getModelPricing() encapsula.
//
// Notación: precio por MILLÓN de tokens, en USD.

const PRICING_PER_MILLION = Object.freeze({
  // Haiku 4.5 — modelo principal de Focus (focus-assistant + analyze-photo)
  'claude-haiku-4-5':  { input: 1.00, output: 5.00 },
  // Haiku 3.5 (legacy, por si rollback) — más barato pero peor JSON
  'claude-haiku-3-5':  { input: 0.80, output: 4.00 },
  // Sonnet 4.5 — para escalar acciones complejas (no usado todavía)
  'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  // Sonnet 4.6 — variante más reciente
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  // Opus 4.7 — top tier (improbable en Focus por costo)
  'claude-opus-4-7':   { input: 15.00, output: 75.00 },

  // OpenAI (Responses API) — Nova chat con router por tiers. Precios en USD
  // por 1M tokens, tomados de developers.openai.com/api/docs/pricing el
  // 2026-07-01. RE-VERIFICAR si OpenAI cambia precios o se agrega un tier.
  'gpt-5.4-nano': { input: 0.20, output: 1.25 },   // tier simple (default barato)
  'gpt-5.4-mini': { input: 0.75, output: 4.50 },   // tier complejo
  'gpt-5.4':      { input: 2.50, output: 15.00 },  // por si se usa el full
  'gpt-5.5':      { input: 5.00, output: 30.00 },  // tier "difícil" (caro, uso escaso)
})

// Fallback conservador: si llega un modelo desconocido, asumimos un precio
// "razonablemente alto" (Sonnet) para que el costo no quede subestimado.
// Esto previene un escenario donde un modelo nuevo y caro llega sin pricing
// y los reportes lo muestran como gratis.
const FALLBACK_PRICING = Object.freeze({ input: 3.00, output: 15.00 })

/**
 * Normaliza el id de modelo de Anthropic, quitando el sufijo de fecha.
 *
 *   'claude-haiku-4-5-20251001' → 'claude-haiku-4-5'
 *   'claude-sonnet-4-6-20251022' → 'claude-sonnet-4-6'
 *   'gpt-4o' → null (no es Anthropic)
 *   '' / null / undefined → null
 *
 * Devolvemos null cuando no podemos parsear; el caller decide si usar
 * fallback o registrar el evento como 'unknown'.
 */
export function normalizeModelName(modelId) {
  if (!modelId || typeof modelId !== 'string') return null
  const lower = modelId.toLowerCase().trim()
  // OpenAI (Nova chat): 'gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5',
  // tolerando el sufijo de snapshot que OpenAI puede añadir
  // ('gpt-5.4-mini-2026-03-17' → 'gpt-5.4-mini'). Solo reconocemos la familia
  // gpt-5.x que SÍ tiene precio configurado; cualquier otro gpt (ej. gpt-4o)
  // devuelve null → el caller usa fallback conservador, igual que antes.
  if (lower.startsWith('gpt-')) {
    const g = lower.match(/^(gpt-5\.\d+(?:-(?:nano|mini))?)/)
    return g ? g[1] : null
  }
  if (!lower.startsWith('claude-')) return null
  // Familia: claude-(haiku|sonnet|opus)-(major)-(minor)
  const m = lower.match(/^(claude-(?:haiku|sonnet|opus)-\d+-\d+)/)
  return m ? m[1] : null
}

/**
 * Devuelve la config de pricing del modelo o null si no está reconocido.
 * Útil para checks ("este modelo está soportado?") sin caer al fallback.
 */
export function getModelPricing(modelId) {
  const normalized = normalizeModelName(modelId)
  if (!normalized) return null
  return PRICING_PER_MILLION[normalized] || null
}

/**
 * Calcula el costo USD estimado de una llamada al modelo.
 *
 * Args:
 *   model: id de modelo (puede traer sufijo de fecha)
 *   input_tokens, output_tokens: del usage de Anthropic
 *
 * Devuelve:
 *   { cost_usd, pricing_source, pricing_model }
 *     pricing_source: 'configured' | 'fallback' | 'zero'
 *     pricing_model: nombre normalizado o 'unknown'
 *
 * El costo se redondea a 6 decimales (la columna `estimated_cost_usd` es
 * NUMERIC(12,6)).
 */
export function calculateAICost({ model, input_tokens = 0, output_tokens = 0 }) {
  const inTokens  = Math.max(0, Math.floor(Number(input_tokens)  || 0))
  const outTokens = Math.max(0, Math.floor(Number(output_tokens) || 0))

  if (inTokens === 0 && outTokens === 0) {
    return {
      cost_usd: 0,
      pricing_source: 'zero',
      pricing_model: normalizeModelName(model) || 'unknown',
    }
  }

  const normalized = normalizeModelName(model)
  const configured = normalized ? PRICING_PER_MILLION[normalized] : null
  const pricing = configured || FALLBACK_PRICING

  const inputCost  = (inTokens  * pricing.input)  / 1_000_000
  const outputCost = (outTokens * pricing.output) / 1_000_000
  const total = inputCost + outputCost

  return {
    cost_usd: Number(total.toFixed(6)),
    pricing_source: configured ? 'configured' : 'fallback',
    pricing_model: normalized || 'unknown',
  }
}

// Para tests
export const __test__ = Object.freeze({ PRICING_PER_MILLION, FALLBACK_PRICING })

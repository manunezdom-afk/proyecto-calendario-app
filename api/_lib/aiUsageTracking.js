// Helper centralizado para registrar cada llamada a IA en `ai_usage_events`.
//
// Diferencia con `usageLimits.js`:
//   * usageLimits.js → contador de cuotas (1 fila por user/día/action en
//     `ai_usage`), enforcement de límites del plan.
//   * aiUsageTracking.js → 1 fila por LLAMADA real al modelo en
//     `ai_usage_events`, con tokens y costo. Para reportes y futuros caps
//     basados en gasto.
//
// Ambos coexisten: el handler chequea cuota con usageLimits.js, y si llama
// al modelo, registra el evento granular acá.
//
// PRIVACIDAD: la metadata NO incluye prompts, respuestas, mensajes, emails,
// títulos de eventos, ni ningún dato del usuario. Solo flags neutrales:
//   * endpoint, plan, success, error_type, duration_ms, request_id
//   * usage_source ('anthropic_usage' | 'estimated' | 'unavailable')
//   * pricing_source, pricing_model
//   * cache_read_tokens, cache_creation_tokens (si Anthropic los reporta)
//
// Lo que NO se guarda — confirmar antes de agregar campos nuevos:
//   * mensajes/prompts/respuestas
//   * títulos o descripciones de tareas/eventos
//   * emails u otros PII
//   * tokens de auth, API keys
//   * IPs (van a logs de Vercel pero no a la tabla)

import { calculateAICost, normalizeModelName } from './aiPricing.js'

/**
 * Extrae tokens del response de Anthropic (SDK o fetch directo).
 *
 * Formato del SDK @anthropic-ai/sdk:
 *   response.usage = {
 *     input_tokens: 123,
 *     output_tokens: 45,
 *     cache_creation_input_tokens: 0,
 *     cache_read_input_tokens: 0,
 *   }
 *
 * Formato del fetch directo a /v1/messages: idéntico (es la API REST).
 *
 * Devuelve { input_tokens, output_tokens, source, ...cache_*? }.
 *   source: 'anthropic_usage' si vino directo del modelo,
 *           'unavailable' si no había usage o estaba en 0.
 */
export function extractAnthropicUsage(response) {
  const u = response?.usage
  if (!u || typeof u !== 'object') {
    return { input_tokens: 0, output_tokens: 0, source: 'unavailable' }
  }

  const input  = Math.max(0, Math.floor(Number(u.input_tokens  ?? 0))) || 0
  const output = Math.max(0, Math.floor(Number(u.output_tokens ?? 0))) || 0
  const cacheCreate = Math.max(0, Math.floor(Number(u.cache_creation_input_tokens || 0)))
  const cacheRead   = Math.max(0, Math.floor(Number(u.cache_read_input_tokens     || 0)))
  if (![input, output, cacheCreate, cacheRead].every(Number.isSafeInteger)) return { input_tokens: 0, output_tokens: 0, source: 'unavailable' }

  // Si Anthropic devolvió 0/0 explícito (por ejemplo, error parcial), lo
  // tratamos como 'unavailable' para no insertar evento con costo cero
  // confuso. El handler decide si registrar igual con success=false.
  if (input === 0 && output === 0 && cacheCreate === 0 && cacheRead === 0) {
    return { input_tokens: 0, output_tokens: 0, source: 'unavailable' }
  }

  const out = {
    input_tokens: input,
    output_tokens: output,
    source: 'anthropic_usage',
  }

  if (cacheCreate > 0) out.cache_creation_input_tokens = cacheCreate
  if (cacheRead   > 0) out.cache_read_input_tokens     = cacheRead
  if (u.cache_creation?.ephemeral_5m_input_tokens) out.cache_creation_5m_input_tokens = Math.max(0, Number(u.cache_creation.ephemeral_5m_input_tokens) || 0)
  if (u.cache_creation?.ephemeral_1h_input_tokens) out.cache_creation_1h_input_tokens = Math.max(0, Number(u.cache_creation.ephemeral_1h_input_tokens) || 0)

  return out
}

/**
 * Sanitiza la metadata para asegurarse de que NO entre nada sensible.
 * Solo acepta keys conocidas y valores escalares pequeños.
 *
 * Cualquier campo no listado aquí se descarta silenciosamente — si lo
 * necesitamos en el futuro, hay que agregarlo explícitamente acá.
 */
const ALLOWED_METADATA_KEYS = new Set([
  'endpoint',
  'plan',
  'success',
  'error_type',
  'duration_ms',
  'request_id',
  'admission_lease_id',
  'budget_level',
  'input_token_limit',
  'output_token_limit',
  'cost_basis',
  'escalation_reason',
  'complexity',
  'clarification',
  'validation_ok',
  'schema_valid',
  'request_elapsed_ms',
  'usage_source',
  'pricing_source',
  'pricing_model',
  'cache_read_tokens',
  'cache_creation_tokens',
  'had_actions',
  'action_count',
  'action_types',
  'limit_status',
  'retry_attempt',
  // Router de OpenAI: tier elegido ('nano'|'mini'|'hard'|'forced') y proveedor
  // ('openai'|'anthropic'). Permiten cortar costo por tier/proveedor en los
  // reportes de `ai_usage_events`. Neutrales (no identifican al usuario).
  'tier',
  'provider',
  // Voice AI / Whisper: duración del audio transcrito en segundos. No
  // identifica al usuario; solo permite reportes de costo por minuto.
  'audio_seconds',
])

function sanitizeMetadata(input) {
  if (!input || typeof input !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue
    if (value === null || value === undefined) continue
    // Cap de tamaño: strings cortos, numbers normales, booleans.
    if (typeof value === 'string') {
      out[key] = value.slice(0, 120)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value
    } else if (typeof value === 'boolean') {
      out[key] = value
    }
  }
  return out
}

/**
 * Inserta una fila por intento. Await obligatorio antes de terminar un handler
 * serverless; devuelve confirmación para conservar la reserva si falla.
 */
export async function trackAIUsageEvent({
  admin,
  userId,
  action_type,
  endpoint,
  model,
  anthropicResponse = null,
  usage = null,
  metadata = {},
  success = true,
  error_type = null,
  duration_ms = null,
  // Override del costo en USD para modelos que NO cobran por tokens
  // (Whisper cobra por minuto). Si se pasa, salta calculateAICost().
  cost_override_usd = null,
}) {
  try {
    if (!admin || !userId || !action_type) return { ok: false }

    const extracted = usage || extractAnthropicUsage(anthropicResponse)
    const cost = (cost_override_usd != null && Number.isFinite(Number(cost_override_usd)))
      ? {
          cost_usd: Number(Number(cost_override_usd).toFixed(6)),
          pricing_source: 'configured',
          pricing_model: normalizeModelName(model) || model || 'unknown',
        }
      : calculateAICost({
          model,
          ...extracted,
          input_tokens: extracted.input_tokens,
          output_tokens: extracted.output_tokens,
        })

    const meta = sanitizeMetadata({
      endpoint,
      usage_source: extracted.source,
      pricing_source: cost.pricing_source,
      pricing_model: cost.pricing_model,
      success,
      error_type: error_type || null,
      duration_ms: duration_ms != null ? Math.max(0, Math.floor(duration_ms)) : null,
      cache_read_tokens: extracted.cache_read_input_tokens,
      cache_creation_tokens: extracted.cache_creation_input_tokens,
      ...metadata,
    })

    const row = {
      user_id: userId,
      action_type,
      model_used: normalizeModelName(model) || model || 'unknown',
      input_tokens: extracted.input_tokens,
      output_tokens: extracted.output_tokens,
      estimated_cost_usd: cost.cost_usd,
      metadata: meta,
    }

    let query = admin.from('ai_usage_events').insert(row)
    if (typeof query?.abortSignal === 'function') query = query.abortSignal(AbortSignal.timeout(3000))
    const { error } = await query
    if (error) {
      // Loggear sin volcar la fila completa. Solo el código del error de
      // Supabase, suficiente para diagnosticar (RLS, FK, constraint).
      if (!/does not exist|relation .* does not exist/i.test(error.message || '')) {
        console.warn('[ai_usage_events] insert failed', /^[A-Z0-9_]{1,20}$/.test(error.code || '') ? error.code : 'database_error')
      }
    }
    return { ok: !error, costUSD: cost.cost_usd }
  } catch (err) {
    // No queremos que un bug de tracking rompa la respuesta al usuario.
    console.warn('[ai_usage_events] tracker error:', err?.name || 'Error')
    return { ok: false }
  }
}

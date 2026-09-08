// Benchmark sintético solamente. Importar este módulo no lee archivos, busca
// credenciales ni inicia red. No habilita Google en la API o consentimiento iOS.
// Documentación consultada: 2026-09-08.
// https://ai.google.dev/gemini-api/docs/get-started (REST y steps sin estado)
// https://ai.google.dev/gemini-api/docs/structured-output (response_format)
// https://ai.google.dev/api/interactions-api (generation_config y usage)
// https://ai.google.dev/gemini-api/docs/thinking (salida + pensamiento facturable)
import { calculateAICost, getModelPricing } from '../api/_lib/aiPricing.js'

export const GOOGLE_BENCHMARK_MODELS = Object.freeze([
  'gemini-3.5-flash-lite', 'gemini-3.8-flash',
])
export const GOOGLE_BENCHMARK_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
export const GOOGLE_BENCHMARK_KEY_NAME = 'GEMINI_API_KEY'
export const GOOGLE_BENCHMARK_LIMITATIONS = Object.freeze({
  liveValidated: false,
  combinedThinkingOutputCapVerified: false,
  note: 'max_output_tokens limita respuesta; el techo combinado con pensamiento requiere corroboración antes de una batería pagada con presupuesto estricto.',
})

function fail(code) {
  const error = new Error(code)
  error.code = code
  return error
}
function count(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Payload puro, sin key. messages son fixtures sintéticos role/content.
 * Para conversaciones Gemini reales habría que conservar también todos los
 * thought/function steps originales; este adaptador no implementa ese flujo.
 */
export function buildGoogleBenchmarkRequest({
  model = 'gemini-3.5-flash-lite', system, messages, schema,
  maxOutputTokens = 1024, thinkingLevel, at = new Date(),
}) {
  if (!GOOGLE_BENCHMARK_MODELS.includes(model)) throw fail('google_model_not_allowed')
  if (!getModelPricing(model, { at, requireCurrent: true })) throw fail('google_pricing_requires_review')
  if (typeof system !== 'string' || !system.trim()) throw fail('google_system_required')
  if (!schema || schema.type !== 'object' || !schema.properties || Array.isArray(schema.properties)) {
    throw fail('google_schema_required')
  }
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 2048) {
    throw fail('google_output_cap_invalid')
  }
  const level = thinkingLevel ?? (model === 'gemini-3.5-flash-lite' ? 'minimal' : 'low')
  const supportedLevels = model === 'gemini-3.8-flash' ? ['low', 'medium', 'high'] : ['minimal', 'low', 'medium', 'high']
  if (!supportedLevels.includes(level)) throw fail('google_thinking_level_invalid')
  if (!Array.isArray(messages) || !messages.length || messages.at(-1)?.role !== 'user') {
    throw fail('google_messages_invalid')
  }
  const input = messages.map(message => {
    if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string' || !message.content.trim()) {
      throw fail('google_messages_invalid')
    }
    return {
      type: message.role === 'user' ? 'user_input' : 'model_output',
      content: [{ type: 'text', text: message.content }],
    }
  })
  const body = {
    model, store: false, stream: false, system_instruction: system, input,
    generation_config: {
      max_output_tokens: maxOutputTokens, thinking_level: level, thinking_summaries: 'none',
    },
    response_format: { type: 'text', mime_type: 'application/json', schema: structuredClone(schema) },
  }
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 100_000) throw fail('google_input_cap_exceeded')
  return body
}

/** Extrae contadores separados de Interactions. Uso ausente/parcial no es cero.
 * No suma total_tokens: ya incluye prompt, respuesta y pensamiento.
 */
export function extractGoogleBenchmarkResponse(raw, { model, at = new Date() } = {}) {
  const expectedModel = model ?? raw?.model
  if (!GOOGLE_BENCHMARK_MODELS.includes(expectedModel)) throw fail('google_model_not_allowed')
  const status = raw?.status ?? 'unknown'
  const modelMismatch = !!raw?.model && raw.model !== expectedModel
  const text = Array.isArray(raw?.steps) ? raw.steps
    .filter(step => step?.type === 'model_output')
    .flatMap(step => Array.isArray(step.content) ? step.content : [])
    .filter(content => content?.type === 'text' && typeof content.text === 'string')
    .map(content => content.text).join('') : ''
  const u = raw?.usage
  const input = count(u?.total_input_tokens)
  const visibleOutput = count(u?.total_output_tokens)
  const thinking = count(u?.total_thought_tokens)
  const cached = u?.total_cached_tokens == null ? 0 : count(u.total_cached_tokens)
  const toolTokens = u?.total_tool_use_tokens == null ? 0 : count(u.total_tool_use_tokens)
  // Sin herramientas ni agentes alojados: contadores inesperados requieren
  // revisión, no una estimación que aparente ser cargo medido.
  const usageKnown = !modelMismatch && [input, visibleOutput, thinking, cached].every(n => n != null)
    && toolTokens === 0 && cached <= input
  const usage = usageKnown ? {
    input_tokens: input, output_tokens: visibleOutput + thinking,
    cached_input_tokens: cached, thinking_tokens: thinking,
    visible_output_tokens: visibleOutput, source: 'google_interactions_usage',
  } : null
  const billing = usage ? calculateAICost({ model: expectedModel, ...usage, at, conservative: false }) : null
  return {
    text, stopReason: status,
    completed: status === 'completed' && !modelMismatch && !!text.trim(),
    errorCode: modelMismatch ? 'google_model_mismatch' : status !== 'completed' ? 'google_incomplete' : !text.trim() ? 'google_empty_output' : null,
    usage, usageUnknown: !usageKnown, billing,
    cacheUsageMissing: u?.total_cached_tokens == null,
  }
}

/** Un intento explícito. El runner conserva presupuesto/reserva y --live.
 * No retries, redirecciones, lectura .env, herramientas ni estado remoto.
 * allowLive no convierte maxOutputTokens en un techo total de gasto confirmado;
 * el runner debe resolver GOOGLE_BENCHMARK_LIMITATIONS antes de habilitarlo.
 */
export async function callGoogleBenchmark(options, {
  allowLive = false, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 25_000,
} = {}) {
  if (!allowLive) throw fail('google_live_not_authorized')
  const key = apiKey ?? process.env.GEMINI_API_KEY
  if (typeof key !== 'string' || !key.trim()) throw fail('google_key_missing')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw fail('google_timeout_invalid')
  const body = buildGoogleBenchmarkRequest(options)
  const response = await fetchImpl(GOOGLE_BENCHMARK_URL, {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  })
  let raw
  try { raw = await response.json() } catch {
    return { httpStatus: response.status, completed: false, errorCode: 'google_invalid_response',
      text: '', usage: null, usageUnknown: true, billing: null }
  }
  const result = extractGoogleBenchmarkResponse(raw, { model: body.model, at: options.at })
  return { ...result, httpStatus: response.status, completed: response.ok && result.completed,
    errorCode: response.ok ? result.errorCode : `google_http_${response.status}` }
}

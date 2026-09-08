import { novaOutputTokenLimit, boundNovaInput } from './novaSafety.js'
import { NOVA_PLAN_SCHEMA, isNovaWirePlan } from './novaContract.js'
import { calculateAICost, getModelPricing } from './aiPricing.js'
const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_MAX_OUTPUT_TOKENS = 1200
const DEFAULT_TIMEOUT_MS = 18000
export const DEEPSEEK_PRICING = Object.freeze(Object.fromEntries(['deepseek-v4-flash', 'deepseek-v4-pro'].map(model => [model, getModelPricing(model)])))
export function estimateDeepSeekCostUSD(model, usage) {
  if (!getModelPricing(model) || !usage) return null
  return calculateAICost({ model, input_tokens: usage.prompt_tokens,
    cached_input_tokens: usage.prompt_cache_hit_tokens, output_tokens: usage.completion_tokens }).cost_usd
}
export function buildDeepSeekJsonAppendix() {
  return '\nDevuelve JSON exactamente conforme a este schema, sin Markdown:\n' + JSON.stringify(NOVA_PLAN_SCHEMA.schema)
}
export function normalizeDeepSeekPayload(parsed) {
  if (!isNovaWirePlan(parsed)) throw new Error('invalid_schema')
  return parsed
}
export function extractDeepSeekText(data) {
  const choice = data?.choices?.[0]
  if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error('incomplete_output')
  if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new Error('empty_output')
  return choice.message.content
}

export async function callDeepSeekNova({
  message,
  systemPrompt,
  model,
  apiKey,
  reqId,
  signal,
  history,
  maxOutputTokens,
}) {
  const historyMessages = boundNovaInput({ systemPrompt, message, history })

  const body = {
    model: model || process.env.DEEPSEEK_NOVA_MODEL || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: message },
    ],
    // JSON mode — el prompt ya contiene "JSON" + ejemplo (requisitos DeepSeek).
    response_format: { type: 'json_object' },
    // CRÍTICO (bug 2026-07-24): los V4 traen thinking ENABLED por defecto y
    // el razonamiento consume max_tokens → `content` llega VACÍO y Nova caía
    // al parser local en el 100% de los mensajes. Para extracción JSON el
    // thinking no aporta; se apaga. DEEPSEEK_THINKING=enabled lo re-activa.
    thinking: { type: process.env.DEEPSEEK_THINKING === 'enabled' ? 'enabled' : 'disabled' },
    // max_tokens evita el JSON truncado a mitad (recomendación oficial) y es
    // el tope duro de costo de salida por request.
    max_tokens: novaOutputTokenLimit(maxOutputTokens || process.env.AI_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
    // Extracción estructurada, no creatividad: temperatura baja = JSON más
    // estable entre reintentos.
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE) || 0.2,
    stream: false,
  }

  const controller = signal ? null : new AbortController()
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    : null

  try {
    const response = await fetch(DEEPSEEK_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Request-Id': reqId || '',
      },
      body: JSON.stringify(body),
      signal: signal || controller?.signal,
    })

    if (!response.ok) {
      const err = new Error(`DeepSeek HTTP ${response.status}`)
      err.status = response.status
      throw err
    }

    return await response.json()
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

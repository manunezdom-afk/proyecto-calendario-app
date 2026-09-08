import { novaOutputTokenLimit, boundNovaInput } from './novaSafety.js'
import { NOVA_PLAN_SCHEMA, validateNovaPlan } from './novaContract.js'
export { buildNovaSystemPrompt as buildOpenAISystemPrompt } from './novaPrompt.js'
export const NOVA_OPENAI_SCHEMA = NOVA_PLAN_SCHEMA
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_MODEL = 'gpt-5.6-luna'
const DEFAULT_MAX_OUTPUT_TOKENS = 1200
const DEFAULT_TIMEOUT_MS = 18000

export async function callOpenAINova({
  message,
  systemPrompt,
  model,
  apiKey,
  reqId,
  signal,
  history,
  reasoningEffort,
  maxOutputTokens,
}) {
  // Mapear history del backend ({role: 'user'|'assistant', content}) al
  // formato Responses API (mismo role + content). Mantenemos orden cronológico.
  const historyMessages = Array.isArray(history)
    ? history
        .filter(h => h && typeof h.content === 'string' && h.content.trim().length > 0)
        .slice(-12)  // últimos 12 turnos máximo
        .map(h => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content,
        }))
    : []

  const boundedHistory = boundNovaInput({ systemPrompt, message, history: historyMessages, schema: NOVA_OPENAI_SCHEMA.schema })
  const body = {
    model: model || process.env.OPENAI_NOVA_MODEL || DEFAULT_MODEL,
    store: false,
    // Tope de salida — Responses API usa `max_output_tokens` (NO `max_tokens`).
    // Acota costo y latencia; los tokens de reasoning cuentan acá adentro.
    max_output_tokens: novaOutputTokenLimit(maxOutputTokens || process.env.OPENAI_NOVA_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
    input: [
      { role: 'system', content: systemPrompt },
      ...boundedHistory,
      { role: 'user', content: message },
    ],
    text: {
      format: {
        type: 'json_schema',
        ...NOVA_OPENAI_SCHEMA,
      },
    },
    // Reasoning effort — gpt-5* y o-series soportan este parámetro.
    // 'medium' es buen balance latencia/calidad. Override por env.
    reasoning: {
      effort: reasoningEffort || process.env.OPENAI_REASONING_EFFORT || 'medium',
    },
  }

  const controller = signal ? null : new AbortController()
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    : null

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
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
      const err = new Error(`OpenAI HTTP ${response.status}`)
      err.status = response.status
      throw err
    }

    const data = await response.json()
    return data
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/**
 * Extrae el texto JSON del payload de Responses API. Soporta ambos shapes
 * que OpenAI ha usado: `output_text` (atajo) y `output[].content[].text`.
 * Si no encuentra texto, lanza.
 */
export function extractResponsesText(data) {
  if (data?.status && data.status !== 'completed') throw Object.assign(new Error('incomplete_output'), { code: 'incomplete_output' })
  if (typeof data?.output_text === 'string' && data.output_text.length > 0) {
    return data.output_text
  }
  const output = Array.isArray(data?.output) ? data.output : []
  for (const item of output) {
    if (!item) continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const c of content) {
      if (c?.type === 'refusal') throw Object.assign(new Error('provider_refusal'), { code: 'provider_refusal' })
      if (typeof c?.text === 'string' && c.text.length > 0) return c.text
      if (typeof c?.text?.value === 'string' && c.text.value.length > 0) return c.text.value
    }
  }
  throw new Error('OpenAI Responses: no output text found')
}


export function convertOpenAIToBackendResponse(options) {
  return validateNovaPlan({ ...options, payload: options.payload ?? options.openaiPayload })
}

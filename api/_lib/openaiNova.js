import { novaOutputTokenLimit, boundNovaInput } from './novaSafety.js'
import { NOVA_PLAN_SCHEMA, validateNovaPlan } from './novaContract.js'
import { createHash } from 'node:crypto'
import { NOVA_RUNTIME_MODELS, NOVA_MODEL_TIERS } from './novaRouter.js'
import { splitNovaSystemPrompt } from './novaPrompt.js'
export { buildNovaSystemPrompt as buildOpenAISystemPrompt } from './novaPrompt.js'
export const NOVA_OPENAI_SCHEMA = NOVA_PLAN_SCHEMA
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_MODEL = 'gpt-5.6-luna'
const DEFAULT_MAX_OUTPUT_TOKENS = 1600

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
  maxInputTokens = 12000,
  timeoutMs,
}) {
  const selectedModel = model || DEFAULT_MODEL
  if (!NOVA_RUNTIME_MODELS.includes(selectedModel)) throw Object.assign(new Error('unsupported_model'), { code: 'unsupported_model' })
  const config = Object.values(NOVA_MODEL_TIERS).find(tier => tier.model === selectedModel)
  const effort = reasoningEffort || config.reasoningEffort
  if (!['none', 'low', 'medium'].includes(effort)) throw Object.assign(new Error('unsupported_reasoning'), { code: 'unsupported_reasoning' })
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

  const boundedHistory = boundNovaInput({ systemPrompt, message, history: historyMessages, schema: NOVA_OPENAI_SCHEMA.schema,
    maxInputTokens: Math.min(config.input, maxInputTokens) })
  const { instructions, context } = splitNovaSystemPrompt(systemPrompt)
  const cacheKey = createHash('sha256').update(instructions + JSON.stringify(NOVA_OPENAI_SCHEMA.schema)).digest('hex').slice(0, 20)
  const body = {
    model: selectedModel,
    store: false,
    service_tier: 'default',
    truncation: 'disabled',
    prompt_cache_key: `focus-nova-${cacheKey}`,
    prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    // Tope de salida — Responses API usa `max_output_tokens` (NO `max_tokens`).
    // Acota costo y latencia; los tokens de reasoning cuentan acá adentro.
    max_output_tokens: novaOutputTokenLimit(maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS, config.outputCeiling),
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: instructions, prompt_cache_breakpoint: { mode: 'explicit' } }] },
      ...(context ? [{ role: 'user', content: context }] : []),
      ...boundedHistory,
      { role: 'user', content: message },
    ],
    text: {
      format: {
        type: 'json_schema',
        ...NOVA_OPENAI_SCHEMA,
      },
    },
    reasoning: { effort },
  }
  const boundedSignal = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(config.timeoutMs,
    Number.isFinite(timeoutMs) ? timeoutMs : config.timeoutMs))))
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Request-Id': reqId || '',
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, boundedSignal]) : boundedSignal,
    })

    if (!response.ok) {
      const err = new Error(`OpenAI HTTP ${response.status}`)
      err.status = response.status
      throw err
    }

    return readBoundedResponse(response)
}

async function readBoundedResponse(response) {
  const maxBytes = 256000
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []; let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) { await reader.cancel(); throw Object.assign(new Error('output_too_large'), { code: 'output_too_large' }) }
        chunks.push(value)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } finally { reader.releaseLock() }
  }
  // Lightweight offline fetch fixtures do not implement ReadableStream.
  const data = await response.json()
  if (Buffer.byteLength(JSON.stringify(data)) > maxBytes) throw Object.assign(new Error('output_too_large'), { code: 'output_too_large' })
  return data
}

/**
 * Extrae el texto JSON del payload de Responses API. Soporta ambos shapes
 * que OpenAI ha usado: `output_text` (atajo) y `output[].content[].text`.
 * Si no encuentra texto, lanza.
 */
export function extractResponsesText(data) {
  if (data?.status && data.status !== 'completed') throw Object.assign(new Error('incomplete_output'), { code: 'incomplete_output' })
  if (data?.output?.some(item => item?.content?.some(content => content?.type === 'refusal'))) throw Object.assign(new Error('provider_refusal'), { code: 'provider_refusal' })
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
  throw Object.assign(new Error('empty_output'), { code: 'empty_output' })
}


export function convertOpenAIToBackendResponse(options) {
  return validateNovaPlan({ ...options, payload: options.payload ?? options.openaiPayload })
}

import { NOVA_PLAN_SCHEMA } from './novaContract.js'
import { novaOutputTokenLimit, boundNovaInput } from './novaSafety.js'

// Direct REST performs exactly one attempt. No SDK-hidden retry budget.
export async function callAnthropicNova({ message, systemPrompt, model = 'claude-haiku-4-5-20251001',
  apiKey, reqId, history = [], signal, maxOutputTokens = 1200 }) {
  const messages = [...boundNovaInput({ message, systemPrompt, history, schema: NOVA_PLAN_SCHEMA.schema }), { role: 'user', content: message }]
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey,
      'anthropic-version': '2023-06-01', 'x-request-id': reqId || '' },
    signal: signal || AbortSignal.timeout(18000),
    body: JSON.stringify({ model, max_tokens: novaOutputTokenLimit(maxOutputTokens, 1200),
      system: systemPrompt, messages, output_config: { format: { type: 'json_schema', schema: NOVA_PLAN_SCHEMA.schema } } }),
  })
  if (!response.ok) throw Object.assign(new Error(`provider_http_${response.status}`), { status: response.status })
  return response.json()
}
export function extractAnthropicText(data) {
  if (data?.stop_reason === 'refusal') throw Object.assign(new Error('provider_refusal'), { code: 'provider_refusal' })
  if (data?.stop_reason && data.stop_reason !== 'end_turn') throw Object.assign(new Error('incomplete_output'), { code: 'incomplete_output' })
  const text = data?.content?.filter(block => block.type === 'text').map(block => block.text).join('')
  if (!text) throw Object.assign(new Error('empty_output'), { code: 'empty_output' })
  return text
}

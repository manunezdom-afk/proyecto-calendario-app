import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGoogleBenchmarkRequest, extractGoogleBenchmarkResponse, callGoogleBenchmark,
  GOOGLE_BENCHMARK_URL, GOOGLE_BENCHMARK_LIMITATIONS,
} from './ai-benchmark-google.mjs'

const at = '2026-09-08T12:00:00.000Z'
const schema = { type: 'object', additionalProperties: false,
  properties: { mode: { type: 'string', enum: ['chat'] }, text: { type: 'string' } }, required: ['mode', 'text'] }
const options = { at, model: 'gemini-3.5-flash-lite', system: 'Responde en español.',
  messages: [{ role: 'user', content: 'Hola' }], schema }
const response = { model: 'gemini-3.5-flash-lite', status: 'completed', steps: [
  { type: 'thought', signature: 'synthetic-signature', content: [{ type: 'text', text: 'No mostrar' }] },
  { type: 'model_output', content: [{ type: 'text', text: '{"mode":"chat","text":"Hola"}' }] },
], usage: { total_input_tokens: 1000, total_cached_tokens: 800,
  total_output_tokens: 100, total_thought_tokens: 200, total_tokens: 1300, total_tool_use_tokens: 0 } }

test('fixture conversacional conserva roles y contrato JSON sin almacenar estado', () => {
  const body = buildGoogleBenchmarkRequest({ ...options, messages: [
    { role: 'user', content: 'Mañana llama a Ana.' },
    { role: 'assistant', content: '¿A qué hora?' },
    { role: 'user', content: 'A las diez.' },
  ] })
  assert.equal(body.store, false)
  assert.equal(body.stream, false)
  assert.equal(body.previous_interaction_id, undefined)
  assert.equal(body.tools, undefined)
  assert.deepEqual(body.input.map(x => x.type), ['user_input', 'model_output', 'user_input'])
  assert.deepEqual(body.response_format.schema, schema)
  assert.equal(body.response_format.mime_type, 'application/json')
  assert.equal(body.generation_config.max_output_tokens, 1024)
  assert.equal(body.generation_config.thinking_level, 'minimal')
  body.response_format.schema.properties.text.type = 'number'
  assert.equal(schema.properties.text.type, 'string')
})

test('Flash 3.8 usa low; minimal, modelo no previsto y límites inválidos fallan antes de red', () => {
  assert.equal(buildGoogleBenchmarkRequest({ ...options, model: 'gemini-3.8-flash' }).generation_config.thinking_level, 'low')
  for (const extra of [{ model: 'gemini-3.8-flash', thinkingLevel: 'minimal' },
    { model: 'gemini-3.8-flash-preview' }, { maxOutputTokens: Infinity },
    { maxOutputTokens: 2049 }, { messages: [{ role: 'system', content: 'bad role' }] },
    { at: '2026-12-01T00:00:00Z' }]) {
    assert.throws(() => buildGoogleBenchmarkRequest({ ...options, ...extra }))
  }
  assert.equal(GOOGLE_BENCHMARK_LIMITATIONS.combinedThinkingOutputCapVerified, false)
})

test('coste suma pensamiento una vez y resta caché del input total', () => {
  const result = extractGoogleBenchmarkResponse(response, { model: options.model, at })
  assert.equal(result.text, '{"mode":"chat","text":"Hola"}')
  assert.equal(result.completed, true)
  assert.equal(result.usage.output_tokens, 300)
  // 200*.30 + 800*.03 + 300*2.50, /1M = .000834.
  assert.equal(result.billing.cost_usd, 0.000834)
  assert.equal(result.usage.thinking_tokens, 200)
})

test('respuestas incompletas conservan gasto pero nunca se consideran éxito', () => {
  const result = extractGoogleBenchmarkResponse({ ...response, status: 'incomplete' }, { at })
  assert.equal(result.completed, false)
  assert.equal(result.errorCode, 'google_incomplete')
  assert.equal(result.billing.cost_usd, 0.000834)
})

test('usage ausente, parcial o incoherente nunca se convierte en llamada gratis', () => {
  for (const usage of [undefined, { total_input_tokens: 1000, total_output_tokens: 100 },
    { ...response.usage, total_thought_tokens: -1 },
    { ...response.usage, total_cached_tokens: 1001 },
    { ...response.usage, total_tool_use_tokens: 100 }]) {
    const result = extractGoogleBenchmarkResponse({ ...response, usage }, { at })
    assert.equal(result.usageUnknown, true)
    assert.equal(result.billing, null)
  }
})

test('no realiza red sin habilitación explícita', async () => {
  let calls = 0
  await assert.rejects(callGoogleBenchmark(options, { apiKey: 'synthetic-key',
    fetchImpl: async () => { calls++; throw new Error('must not call') } }), /google_live_not_authorized/)
  assert.equal(calls, 0)
})

test('un solo intento simulado usa key en header, host fijo y abort; no reintenta 429', async () => {
  let calls = 0
  const result = await callGoogleBenchmark(options, { allowLive: true, apiKey: 'synthetic-key',
    fetchImpl: async (url, init) => {
      calls++
      assert.equal(url, GOOGLE_BENCHMARK_URL)
      assert.equal(new URL(url).search, '')
      assert.equal(init.headers['x-goog-api-key'], 'synthetic-key')
      assert.equal(init.redirect, 'error')
      assert.ok(init.signal instanceof AbortSignal)
      assert.equal(JSON.parse(init.body).store, false)
      return { status: 429, ok: false, json: async () => ({ error: { message: 'backend private message' } }) }
    } })
  assert.equal(calls, 1)
  assert.equal(result.errorCode, 'google_http_429')
  assert.equal(result.billing, null)
  assert.ok(!JSON.stringify(result).includes('backend private message'))
})

test('timeout simulado no provoca segundo intento', async () => {
  let calls = 0
  await assert.rejects(callGoogleBenchmark(options, { allowLive: true, apiKey: 'synthetic-key',
    fetchImpl: async () => { calls++; throw new DOMException('Timed out', 'TimeoutError') } }),
  error => error.name === 'TimeoutError')
  assert.equal(calls, 1)
})

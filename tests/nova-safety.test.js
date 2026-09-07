import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeNovaRequest, novaRequestId, providerFallbackEnabled, runNovaAttempt, novaOutputTokenLimit } from '../api/_lib/novaSafety.js'
import { convertOpenAIToBackendResponse, callOpenAINova } from '../api/_lib/openaiNova.js'

const action = (changes = {}) => ({
  type: 'create_task', title: 'Comprar pan', confidence: 'high', sourceText: 'comprar pan',
  dateISO: '2026-09-10', ...changes,
})
const convert = (actions, text = 'comprar pan antes del jueves') => convertOpenAIToBackendResponse({
  openaiPayload: { actions, userConfirmationText: 'Listo, lo guardé.' }, userMessage: text,
})

test('Nova request rejects malformed input and bounds every model context collection', () => {
  assert.equal(sanitizeNovaRequest({ message: {} }).error, 'no_message')
  assert.equal(sanitizeNovaRequest({ message: 'x'.repeat(4001) }).error, 'message_too_long')
  const request = sanitizeNovaRequest({ message: 'hola',
    history: Array.from({ length: 100 }, () => ({ role: 'user', content: 'x'.repeat(10000) })),
    events: Array.from({ length: 200 }, () => ({ title: 'x'.repeat(10000) })),
    userMemories: Array(100).fill('x'.repeat(10000)),
    contacts: [{ name: 'private', email: 'private@example.invalid' }],
  }).body
  assert.equal(request.history.length, 12)
  assert.equal(request.history[0].content.length, 1000)
  assert.equal(request.events.length, 80)
  assert.equal(request.events[0].title.length, 120)
  assert.equal(request.userMemories.length, 20)
  assert.equal(request.userMemories[0].length, 200)
  assert.ok(JSON.stringify(request).length < 40000)
})

test('request IDs reject arbitrary text; cross-provider fallback defaults off', () => {
  assert.equal(novaRequestId('abc-123'), 'abc-123')
  assert.match(novaRequestId('private email@example.invalid'), /^[a-f\d-]{36}$/)
  const old = process.env.AI_ENABLE_PROVIDER_FALLBACK
  delete process.env.AI_ENABLE_PROVIDER_FALLBACK
  assert.equal(providerFallbackEnabled(), false)
  if (old !== undefined) process.env.AI_ENABLE_PROVIDER_FALLBACK = old
})

test('paid malformed responses retain usage and failure evidence exactly once', async () => {
  const data = { usage: { input_tokens: 1200, output_tokens: 800 }, output_text: '{' }
  const records = []
  await assert.rejects(runNovaAttempt({ call: async () => data,
    transform: result => JSON.parse(result.output_text), record: async entry => records.push(entry),
  }), SyntaxError)
  assert.equal(records.length, 1)
  assert.equal(records[0].data.usage.output_tokens, 800)
  assert.ok(records[0].error)
})

test('HTTP failure is accounted once without pretending to know token consumption', async () => {
  const records = []
  await assert.rejects(runNovaAttempt({ call: async () => { throw new Error('offline') },
    transform: () => assert.fail('must not transform'), record: async entry => records.push(entry),
  }))
  assert.equal(records.length, 1)
  assert.equal(records[0].data, undefined)
})

test('tasks preserve date-only deadlines and invalid calendar dates are not normalized', () => {
  assert.equal(convert([action()]).actions[0].task.date, '2026-09-10')
  assert.equal(convert([action({ dateISO: '2026-02-30' })]).actions.length, 0)
})

test('unknown provider action and low-confidence deletion cannot execute', () => {
  assert.equal(convert([action({ type: 'erase_everything' })]).actions.length, 0)
  const result = convertOpenAIToBackendResponse({ openaiPayload: { actions: [action({
    type: 'delete_event', targetEventId: 'abc', confidence: 'low',
  })] }, events: [{ id: 'abc' }], userMessage: 'borra pan' })
  assert.equal(result.actions.length, 0)
  assert.equal(result.mode, 'clarification')
})

test('rejected content never leaks into diagnostics or claims completion', () => {
  const result = convert([action({ title: 'Consulta privada', sourceText: 'dato médico privado' })], 'otra intención')
  assert.equal(result.actions.length, 0)
  assert.doesNotMatch(JSON.stringify(result._dropped), /privad|médico/)
  assert.doesNotMatch(result.reply, /guardé/)
  assert.equal(result.shouldAskUser, true)
})

test('Responses requests opt out of storage and provider errors redact bodies', async () => {
  const previousFetch = globalThis.fetch
  let body
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body)
    return { ok: false, status: 400, text: async () => 'secret-provider-body' }
  }
  try {
    await assert.rejects(callOpenAINova({ message: 'hola', systemPrompt: 'system', apiKey: 'fake-key' }), error => {
      assert.doesNotMatch(error.message, /secret-provider-body/)
      return true
    })
    assert.equal(body.store, false)
  } finally { globalThis.fetch = previousFetch }
})

test('one structurally invalid action blocks the entire batch', () => {
  const result = convert([action(), action({ type: 'unknown' })])
  assert.equal(result.actions.length, 0)
  assert.equal(result.shouldAskUser, true)
  assert.doesNotMatch(result.reply, /guardé/)
})

test('an independent question survives alongside verified actions', () => {
  const result = convertOpenAIToBackendResponse({
    openaiPayload: { actions: [action(), { type: 'clarify', title: '¿A qué hora es el gimnasio?' }],
      needsClarification: true, clarificationQuestion: '¿A qué hora es el gimnasio?' },
    userMessage: 'comprar pan y luego gimnasio',
  })
  assert.equal(result.actions.length, 1)
  assert.equal(result.shouldAskUser, false)
  assert.equal(result.follow_up_question, '¿A qué hora es el gimnasio?')
})


test('output token budget remains bounded under invalid environment configuration', () => {
  assert.equal(novaOutputTokenLimit('99999999'), 2048)
  assert.equal(novaOutputTokenLimit('600'), 600)
  assert.equal(novaOutputTokenLimit('1'), 256)
  assert.equal(novaOutputTokenLimit('Infinity', 900), 900)
  assert.equal(novaOutputTokenLimit('-1', 900), 900)
})

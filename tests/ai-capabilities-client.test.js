import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithAICompatibility, ASSISTANT_UPDATING_MESSAGE } from '../src/lib/aiCapabilities.js'

const CHAT = 'https://focus.example/api/focus-assistant'
const MATCH = { runtime: 'focus-openai-v1', chat_provider: 'openai' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const post = signal => ({ method: 'POST', signal, headers: { Authorization: 'Bearer synthetic-only', 'X-Request-Id': 'synthetic-request' },
  body: JSON.stringify({ message: 'Mensaje privado', events: [{ title: 'Privado' }] }) })

for (const [name, capability] of [
  ['404 HTML', () => new Response('<html>Not found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } })],
  ['200 HTML', () => new Response('<html>Previous deployment</html>', { headers: { 'Content-Type': 'text/html' } })],
  ['old runtime', () => json({ runtime: 'previous', chat_provider: 'anthropic' })],
  ['wrong provider', () => json({ ...MATCH, chat_provider: 'deepseek' })],
  ['missing provider', () => json({ runtime: MATCH.runtime })],
  ['missing runtime', () => json({ chat_provider: MATCH.chat_provider })],
  ['invalid JSON', () => new Response('invalid', { headers: { 'Content-Type': 'application/json' } })],
  ['network failure', () => { throw new TypeError('Synthetic unavailable') }],
]) {
  test(`chat preflight fails closed for ${name} without POST or private content`, async () => {
    const calls = []
    await assert.rejects(fetchWithAICompatibility(CHAT, post(), async (url, options) => {
      calls.push({ url, options })
      return capability()
    }), error => error.code === 'assistant_updating' && error.message === ASSISTANT_UPDATING_MESSAGE)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://focus.example/api/ai-capabilities')
    assert.equal(calls[0].options.method, 'GET')
    assert.equal(calls[0].options.body, undefined)
    assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' })
    assert.equal(calls[0].options.credentials, 'omit')
    assert.equal(calls[0].options.redirect, 'error')
    assert.equal(calls[0].options.cache, 'no-store')
  })
}

test('matching runtime sends unchanged chat using the same timeout signal', async () => {
  const calls = [], controller = new AbortController(), options = post(controller.signal)
  const result = await fetchWithAICompatibility(CHAT, options, async (url, input) => {
    calls.push({ url, options: input })
    return input.method === 'GET' ? json(MATCH) : json({ reply: 'Podemos continuar.' })
  })
  assert.equal(result.status, 200)
  assert.deepEqual(calls.map(call => call.options.method), ['GET', 'POST'])
  assert.equal(calls[0].options.signal, controller.signal)
  assert.equal(calls[1].options, options)
  assert.equal(calls[1].url, CHAT)
})

test('a successful preflight is never cached across sends or deployment rollback', async () => {
  const calls = [], options = post()
  let compatible = true
  const fetchImpl = async (url, input) => {
    calls.push(input.method)
    return input.method === 'GET' ? json(compatible ? MATCH : { runtime: 'previous', chat_provider: 'anthropic' }) : json({ reply: 'Hola' })
  }
  await fetchWithAICompatibility(CHAT, options, fetchImpl)
  compatible = false
  await assert.rejects(fetchWithAICompatibility(CHAT, options, fetchImpl), { code: 'assistant_updating' })
  assert.deepEqual(calls, ['GET', 'POST', 'GET'])
})

test('cancellation during compatibility check prevents the paid POST', async () => {
  const calls = [], controller = new AbortController()
  await assert.rejects(fetchWithAICompatibility(CHAT, post(controller.signal), async (url, options) => {
    calls.push(options.method)
    controller.abort()
    return json(MATCH)
  }), { name: 'AbortError' })
  assert.deepEqual(calls, ['GET'])
})

for (const [name, url, body] of [
  ['read-only today context', CHAT, { mode: 'today-context' }],
  ['separately consented photo analysis', 'https://focus.example/api/analyze-photo', { image: 'synthetic-only' }],
]) {
  test(`${name} does not require the chat capability`, async () => {
    const calls = [], options = { method: 'POST', body: JSON.stringify(body) }
    await fetchWithAICompatibility(url, options, async (target, input) => { calls.push({ target, input }); return json({}) })
    assert.deepEqual(calls, [{ target: url, input: options }])
  })
}

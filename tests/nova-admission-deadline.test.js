import test from 'node:test'
import assert from 'node:assert/strict'
import { admissionRPC } from '../api/_lib/novaAdmission.js'
import { executeNovaRequest } from '../api/_lib/novaRuntime.js'
import { sanitizeNovaRequest } from '../api/_lib/novaSafety.js'
import { wirePlan, wireAction } from './helpers/novaFixtures.js'

test('only begin authorization receives five seconds; settlement and finish retain bounded three-second deadlines', async () => {
  const original = AbortSignal.timeout, deadlines = []
  AbortSignal.timeout = ms => { deadlines.push(ms); return original(ms) }
  try {
    for (const name of ['focus_ai_begin_attempt', 'focus_ai_admit', 'focus_ai_settle_attempt', 'focus_ai_consume', 'focus_ai_finish']) {
      let calls = 0
      const result = await admissionRPC({ rpc: () => { calls++; return { abortSignal: signal => {
        assert.ok(signal instanceof AbortSignal); return { data: { status: 'ok' } }
      } } } }, name, {})
      assert.equal(result.status, 'ok'); assert.equal(calls, 1)
    }
    assert.deepEqual(deadlines, [5000, 3000, 3000, 3000, 3000])
  } finally { AbortSignal.timeout = original }
})

test('a confirmed begin ACK after three seconds permits exactly one mocked provider call without retry', async () => {
  const savedKey = process.env.OPENAI_API_KEY, oldInfo = console.info
  process.env.OPENAI_API_KEY = 'offline-only'; console.info = () => {}
  const calls = []; let paid = 0
  const admin = { rpc(name, args) {
    calls.push({ name, args })
    if (name === 'focus_ai_begin_attempt') return { abortSignal: signal => new Promise((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve({ data: { status: 'started' } }) }, 3150)
      signal.addEventListener('abort', onAbort, { once: true })
    }) }
    const status = { focus_ai_admit: 'admitted', focus_ai_settle_attempt: 'settled', focus_ai_consume: 'ok', focus_ai_finish: 'completed' }[name]
    assert.ok(status); return Promise.resolve({ data: { status, lease_id: 'synthetic-lease', budget_level: 'normal' } })
  } }
  try {
    const result = await executeNovaRequest({ admin, userId: 'synthetic-owner', requestId: 'synthetic-request', plan: 'free',
      body: sanitizeNovaRequest({ message: 'comprar pan', clientNow: Date.parse('2026-09-08T15:00Z'), clientTimezone: 'America/Santiago' }).body,
      track: async () => ({ ok: true }), callProviders: { openai: async ({ signal }) => {
        assert.equal(signal.aborted, false); paid++
        return { output_text: JSON.stringify(wirePlan([wireAction()])), usage: {
          input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        } }
      } } })
    assert.equal(result.httpStatus, 200); assert.equal(paid, 1)
    assert.deepEqual(calls.map(call => call.name), ['focus_ai_admit', 'focus_ai_begin_attempt', 'focus_ai_settle_attempt', 'focus_ai_consume', 'focus_ai_finish'])
  } finally { console.info = oldInfo; savedKey === undefined ? delete process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY = savedKey }
})

test('an uncertain begin ACK never becomes authority, is not retried and cannot be recovered from an attempt read', async () => {
  const key = process.env.OPENAI_API_KEY, warn = console.warn, info = console.info
  process.env.OPENAI_API_KEY = 'offline-only'; console.warn = () => {}; console.info = () => {}
  const names = []
  const admin = { from: () => assert.fail('No read can recover authority to pay'), rpc: async (name, args) => {
    names.push(name)
    if (name === 'focus_ai_admit') return { data: { status: 'admitted', lease_id: 'synthetic-lease' } }
    if (name === 'focus_ai_begin_attempt') throw new DOMException('private ACK timeout', 'TimeoutError')
    assert.equal(name, 'focus_ai_finish'); assert.equal(args.p_outcome, 'failed')
    return { data: { status: 'completed' } }
  } }
  try {
    const result = await executeNovaRequest({ admin, userId: 'synthetic-owner', requestId: 'synthetic-request', plan: 'free',
      body: sanitizeNovaRequest({ message: 'comprar pan', clientNow: Date.parse('2026-09-08T15:00Z'), clientTimezone: 'America/Santiago' }).body,
      track: async () => assert.fail('No provider call occurred'), callProviders: { openai: async () => assert.fail('Unknown begin ACK does not authorize a provider') } })
    assert.equal(result.httpStatus, 503); assert.deepEqual(result.body.actions, [])
    assert.equal(result.body.request_completed, true)
    assert.deepEqual(names, ['focus_ai_admit', 'focus_ai_begin_attempt', 'focus_ai_finish'])
  } finally { console.warn = warn; console.info = info; key === undefined ? delete process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY = key }
})

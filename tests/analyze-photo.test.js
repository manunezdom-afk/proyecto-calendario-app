import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createPhotoHandler, executePhotoRequest, preparePhotoInput, validatePhotoPreview,
  PHOTO_LIMITS, PHOTO_PREVIEW_SCHEMA } from '../api/analyze-photo.js'
import { calculateAICost } from '../api/_lib/aiPricing.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const now = Date.parse('2026-09-08T14:00:00Z')
const image = () => ({ base64: PNG, mediaType: 'image/png' })
const body = () => ({ images: [image()], clientNow: now, clientTimezone: 'America/Santiago' })
const event = overrides => ({ title: 'Clase de fotografía', date: '2026-09-09', time: '10:00', endTime: '11:00', ...overrides })
const providerData = (events = [event()], overrides = {}) => ({ model: 'claude-haiku-4-5-20251001',
  stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ events }) }],
  usage: { input_tokens: 1800, output_tokens: 110 }, ...overrides })
const providerResponse = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })

function database({ status = 'admitted', finish = 'completed', replay, leaseId = 'server-lease-only', control = { status: 'ok', paid_enabled: true } } = {}) {
  const calls = []
  return { calls, async rpc(name, args) {
    calls.push({ name, args })
    if (name === 'focus_ai_admit') return { data: { status, lease_id: leaseId, response: replay } }
    if (name === 'focus_ai_finish') return { data: { status: finish } }
    if (name === 'focus_ai_get_control') return { data: control }
    throw new Error('No independent quota counters or mutations may run')
  } }
}
async function invoke({ admin = database(), input = preparePhotoInput(body()), data = providerData(),
  fetchImpl = async () => providerResponse(data), track = async () => ({ ok: true }), apiKey = 'offline-only' } = {}) {
  return executePhotoRequest({ admin, userId: 'photo-user', requestId: 'photo-request-1', plan: 'free', input, apiKey, fetchImpl, track })
}
function responseRecorder() {
  return { headers: {}, statusCode: 0, body: null,
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this }, end() { return this } }
}
const request = (overrides = {}) => ({ method: 'POST', headers: { host: 'usefocus.me', origin: 'https://usefocus.me',
  'sec-fetch-site': 'same-origin', 'x-request-id': 'photo-request-1' }, socket: { remoteAddress: '192.0.2.3' }, body: body(), ...overrides })

test('global paid-AI switch stops photo before any admission RPC or HTTP call', async () => {
  const old = process.env.AI_PAID_CALLS_ENABLED
  try {
    for (const flag of ['false', 'invalid']) {
      process.env.AI_PAID_CALLS_ENABLED = flag
      const admin = database()
      const result = await invoke({ admin, fetchImpl: async () => assert.fail('disabled must not fetch') })
      assert.equal(result.httpStatus, 503); assert.equal(admin.calls.length, 0)
    }
  } finally { if (old === undefined) delete process.env.AI_PAID_CALLS_ENABLED; else process.env.AI_PAID_CALLS_ENABLED = old }
})

test('switch disabled during photo admission closes an unused lease at zero without calling provider', async () => {
  const old = process.env.AI_PAID_CALLS_ENABLED
  process.env.AI_PAID_CALLS_ENABLED = 'true'
  const admin = database(); const rpc = admin.rpc
  admin.rpc = async (name, args) => {
    const result = await rpc(name, args)
    if (name === 'focus_ai_admit') process.env.AI_PAID_CALLS_ENABLED = 'false'
    return result
  }
  try {
    const result = await invoke({ admin, fetchImpl: async () => assert.fail('disabled must not fetch'),
      track: async () => assert.fail('no provider attempt to track') })
    assert.equal(result.httpStatus, 503); assert.equal(result.body.request_completed, true)
    assert.deepEqual(admin.calls.map(call => call.name), ['focus_ai_admit', 'focus_ai_finish'])
    assert.equal(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_actual_usd, 0)
  } finally { if (old === undefined) delete process.env.AI_PAID_CALLS_ENABLED; else process.env.AI_PAID_CALLS_ENABLED = old }
})

for (const status of ['unavailable', 'quota', 'rate', 'budget', 'concurrency', 'in_progress', 'conflict']) {
  test(`photo admission ${status} cannot make a paid call`, async () => {
    const admin = database({ status }); let called = 0
    const result = await invoke({ admin, fetchImpl: async () => { called++; throw new Error('must not call') } })
    assert.ok(result.httpStatus >= 400); assert.deepEqual(result.body.events, []); assert.equal(called, 0)
    assert.deepEqual(admin.calls.map(call => call.name), ['focus_ai_admit'])
  })
}

test('database switch closed or unavailable after photo admission prevents paid work', async () => {
  for (const control of [{ status: 'ok', paid_enabled: false }, { status: 'unavailable' }, null]) {
    const admin = database({ control })
    const result = await invoke({ admin, fetchImpl: async () => assert.fail('closed control must not fetch'),
      track: async () => assert.fail('no paid attempt to track') })
    assert.equal(result.httpStatus, 503)
    assert.equal(result.body.request_completed, true)
    assert.deepEqual(admin.calls.map(call => call.name), ['focus_ai_admit', 'focus_ai_get_control', 'focus_ai_finish'])
    assert.equal(admin.calls.at(-1).args.p_actual_usd, 0)
  }
})

test('photo replay returns exactly the stored result without paying or counting again', async () => {
  const replay = { httpStatus: 200, body: { events: [event()], execution_pending: true, requestId: 'photo-request-1' } }
  const admin = database({ status: 'replay', replay })
  assert.deepEqual(await invoke({ admin, fetchImpl: async () => assert.fail('replay must not fetch') }), replay)
  assert.equal(admin.calls.length, 1)
})

test('successful photo reserves, tracks its server lease and finalizes preview before returning', async () => {
  const admin = database(); const logs = []; const order = []; let paid = 0
  const originalRPC = admin.rpc
  admin.rpc = async (name, args) => { order.push(name); return originalRPC(name, args) }
  const result = await invoke({ admin, fetchImpl: async (url, options) => {
    paid++; order.push('provider')
    assert.equal(url, 'https://api.anthropic.com/v1/messages')
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal)
    const payload = JSON.parse(options.body)
    assert.equal(payload.model, 'claude-haiku-4-5-20251001')
    assert.equal(payload.max_tokens, 2048); assert.equal(payload.tools, undefined); assert.equal(payload.thinking, undefined)
    assert.equal(payload.messages.length, 1); assert.equal(payload.messages[0].content[0].source.data, PNG)
    assert.deepEqual(payload.output_config.format, { type: 'json_schema', schema: PHOTO_PREVIEW_SCHEMA })
    assert.match(payload.system, /lunes: 2026-09-07/)
    return providerResponse(providerData())
  }, track: async log => { order.push('track'); logs.push(log); return { ok: true } } })
  assert.equal(result.httpStatus, 200); assert.equal(paid, 1); assert.deepEqual(result.body.events, [event()])
  assert.equal(result.body.execution_pending, true); assert.match(result.body.message, /Todavía no se ha guardado/)
  assert.deepEqual(order, ['focus_ai_admit', 'focus_ai_get_control', 'provider', 'track', 'focus_ai_finish'])
  assert.equal(admin.calls[0].args.p_action_type, 'photo_analysis')
  assert.ok(admin.calls[0].args.p_reserve_usd > 0 && admin.calls[0].args.p_reserve_usd <= 0.05)
  const finish = admin.calls.find(call => call.name === 'focus_ai_finish').args
  assert.equal(finish.p_outcome, 'success'); assert.deepEqual(finish.p_response, result)
  assert.equal(finish.p_lease_id, 'server-lease-only')
  assert.ok(finish.p_actual_usd < admin.calls[0].args.p_reserve_usd)
  assert.equal(logs[0].metadata.admission_lease_id, 'server-lease-only')
  assert.equal(logs[0].metadata.request_id, 'photo-request-1')
  assert.equal(logs[0].metadata.action_count, 1)
  const ledgerFields = logs.map(({ admin: _admin, ...fields }) => fields)
  assert.doesNotMatch(JSON.stringify(ledgerFields), new RegExp(PNG.slice(0, 30)))
  assert.doesNotMatch(JSON.stringify(ledgerFields), /Clase de fotografía|offline-only/)
  assert.equal(admin.calls[0].args.p_fingerprint.length, 64)
})

test('four images retain the documented maximum token reservation without hidden retries', async () => {
  const admin = database(); let paid = 0
  const input = preparePhotoInput({ ...body(), images: Array.from({ length: 4 }, image) })
  const result = await invoke({ admin, input, fetchImpl: async () => { paid++; return providerResponse(providerData()) } })
  assert.equal(result.httpStatus, 200); assert.equal(paid, 1)
  const reserve = admin.calls[0].args.p_reserve_usd
  assert.ok(reserve >= (4 * 1568 + 1000) * 2 / 1_000_000 + 2048 * 5 / 1_000_000)
  assert.ok(reserve <= 0.05)
})

test('all failed provider responses are charged conservatively and never echo backend details', async () => {
  for (const status of [400, 401, 429, 500]) {
    const admin = database(); const logs = []; let paid = 0
    const result = await invoke({ admin, fetchImpl: async () => { paid++; return new Response('secret provider details', { status }) },
      track: async log => { logs.push(log); return { ok: true } } })
    assert.equal(result.httpStatus, 503); assert.equal(paid, 1); assert.deepEqual(result.body.events, [])
    assert.equal(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_actual_usd, admin.calls[0].args.p_reserve_usd)
    assert.equal(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_outcome, 'failed'); assert.equal(logs[0].success, false)
    assert.doesNotMatch(JSON.stringify([result, logs]), /secret provider details/)
  }
})

test('network timeout releases no unknown spend and writes a replayable failure', async () => {
  const admin = database(); const logs = []
  const result = await invoke({ admin, fetchImpl: async () => { throw new DOMException('private', 'TimeoutError') },
    track: async log => { logs.push(log); return { ok: true } } })
  assert.equal(result.httpStatus, 503); assert.equal(logs[0].error_type, 'timeout')
  assert.equal(result.body.request_completed, true); assert.equal(result.body.request_retryable, true)
  assert.equal(result.body.requestId, 'photo-request-1')
  assert.equal(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_actual_usd, admin.calls[0].args.p_reserve_usd)
  assert.deepEqual(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_response, result)
})

test('missing, partial and invalid usage cannot register a zero or discounted cost', async () => {
  for (const usage of [undefined, {}, { input_tokens: 1 }, { output_tokens: 100 },
    { input_tokens: -1, output_tokens: 10 }, { input_tokens: '100', output_tokens: 10 },
    { input_tokens: 0, output_tokens: 0 }, { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: -1 }]) {
    const admin = database()
    const result = await invoke({ admin, data: providerData([event()], { usage }) })
    assert.equal(result.httpStatus, 200)
    assert.equal(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_actual_usd, admin.calls[0].args.p_reserve_usd)
  }
})

test('cache read and creation usage are included at registry rates', async () => {
  const admin = database(); const usage = { input_tokens: 1000, output_tokens: 200,
    cache_read_input_tokens: 500, cache_creation_input_tokens: 300 }
  await invoke({ admin, data: providerData([event()], { usage }) })
  assert.equal(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_actual_usd, calculateAICost({ model: 'claude-haiku-4-5-20251001', ...usage }).cost_usd)
})

test('ledger failure or throw keeps full reservation and withholds preview', async () => {
  for (const track of [async () => ({ ok: false }), async () => { throw new Error('database secret') }]) {
    const admin = database(); const result = await invoke({ admin, track })
    assert.equal(result.httpStatus, 503); assert.deepEqual(result.body.events, [])
    assert.equal(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_actual_usd, admin.calls[0].args.p_reserve_usd)
  }
})

test('failed finish withholds preview and missing lease never calls provider', async () => {
  const unclosed = await invoke({ admin: database({ finish: 'unavailable' }), fetchImpl: async () => { throw new Error('provider failed') } })
  assert.equal(unclosed.httpStatus, 503)
  assert.equal(unclosed.body.request_completed, undefined); assert.equal(unclosed.body.request_retryable, undefined)
  assert.equal((await invoke({ admin: database({ leaseId: null }), fetchImpl: async () => assert.fail('missing lease') })).httpStatus, 503)
})

test('definitive failed replay preserves permission for one explicit new-ID retry', async () => {
  const original = await invoke({ fetchImpl: async () => { throw new Error('network') } })
  const replay = await invoke({ admin: database({ status: 'replay', replay: original }), fetchImpl: async () => assert.fail('no automatic retry') })
  assert.deepEqual(replay, original)
  assert.equal(replay.body.request_completed, true); assert.equal(replay.body.request_retryable, true)
  const denied = await invoke({ admin: database({ status: 'budget' }), fetchImpl: async () => assert.fail('no admission') })
  assert.equal(denied.body.request_completed, undefined); assert.equal(denied.body.request_retryable, undefined)
})

test('no key, zero, invalid or insufficient per-request cap prevents admission and provider calls', async () => {
  const admin = database()
  assert.equal((await invoke({ admin, apiKey: '' })).httpStatus, 503); assert.equal(admin.calls.length, 0)
  const old = process.env.AI_MAX_COST_PER_REQUEST_USD
  try {
    for (const cap of ['0.001', '0', '-1', 'invalid']) {
      process.env.AI_MAX_COST_PER_REQUEST_USD = cap
      assert.equal((await invoke({ admin, fetchImpl: async () => assert.fail('cap') })).httpStatus, 503)
      assert.equal(admin.calls.length, 0)
    }
  } finally { if (old === undefined) delete process.env.AI_MAX_COST_PER_REQUEST_USD; else process.env.AI_MAX_COST_PER_REQUEST_USD = old }
})

test('truncated, refused, invalid JSON and extra action fields never return partial events', async () => {
  for (const data of [providerData([event()], { stop_reason: 'max_tokens' }), providerData([event()], { stop_reason: 'refusal' }),
    providerData([event()], { content: [{ type: 'text', text: '{"events":[' }] }),
    providerData([event()], { content: [{ type: 'text', text: JSON.stringify({ events: [event()], reply: 'Guardé tus eventos.' }) }] }),
    providerData([event({ type: 'delete_event' })]), providerData([event(), event({ date: '2026-02-30' })])]) {
    const admin = database(); const result = await invoke({ admin, data })
    assert.equal(result.httpStatus, 503); assert.deepEqual(result.body.events, [])
    assert.ok(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_actual_usd > 0); assert.equal(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_outcome, 'failed')
  }
})

test('oversized upstream body is cancelled and keeps conservative cost', async () => {
  const admin = database()
  const result = await invoke({ admin, fetchImpl: async () => new Response('x'.repeat(PHOTO_LIMITS.responseBytes + 1)) })
  assert.equal(result.httpStatus, 503)
  assert.equal(admin.calls.find(call => call.name === 'focus_ai_finish').args.p_actual_usd, admin.calls[0].args.p_reserve_usd)
})

test('empty photo is a valid completed analysis with no pending actions', async () => {
  const result = await invoke({ data: providerData([]) })
  assert.equal(result.httpStatus, 200); assert.deepEqual(result.body.events, []); assert.equal(result.body.execution_pending, false)
})

test('photo validator preserves unknown date/time, deduplicates exact rows and accepts midnight crossing', () => {
  const untimed = event({ date: null, time: null, endTime: null })
  const overnight = event({ time: '23:30', endTime: '00:30' })
  assert.deepEqual(validatePhotoPreview({ events: [untimed, untimed, overnight] }), [untimed, overnight])
})

test('photo validator rejects civil errors, DST gaps/folds, missing fields and excessive extraction', () => {
  for (const invalid of [event({ date: '2026-02-29' }), event({ time: '24:00' }), event({ time: '9:30' }),
    event({ time: null }), event({ endTime: '10:00' }), event({ title: '' }), event({ title: 'a'.repeat(161) }),
    event({ title: 'a\nb' }), { title: 'Missing fields' }, event({ date: '2027-03-14', time: '02:30', endTime: null }),
    event({ date: '2027-11-07', time: '01:30', endTime: null })]) {
    assert.throws(() => validatePhotoPreview({ events: [invalid] }, 'America/New_York'), /invalid_photo_preview/)
  }
  assert.throws(() => validatePhotoPreview({ events: Array.from({ length: 41 }, () => event()) }), /invalid_photo_preview/)
})

test('request fingerprint is image-bound and retries remain stable when date context changes', () => {
  const first = preparePhotoInput(body())
  assert.equal(first.fingerprint, preparePhotoInput(body()).fingerprint)
  const changed = Buffer.from(PNG, 'base64'); changed[changed.length - 1] ^= 1
  assert.notEqual(first.fingerprint, preparePhotoInput({ ...body(), images: [{ mediaType: 'image/png', base64: changed.toString('base64') }] }).fingerprint)
  assert.equal(first.fingerprint, preparePhotoInput({ ...body(), clientTimezone: 'UTC', clientNow: now + 60_000 }).fingerprint)
  assert.equal(preparePhotoInput({ images: [image()] }, now).fingerprint,
    preparePhotoInput({ images: [image()] }, now + 86_400_000).fingerprint)
  assert.match(first.fingerprint, /^photo-v2:[0-9a-f]{64}$/)
  assert.equal(createHash('sha256').update(first.fingerprint).digest('hex').length, 64)
})

test('real JPEG and WebP fixtures preserve existing upload formats', () => {
  const fixtures = [
    ['image/jpg', '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCIAUgIf//Z'],
    ['image/webp', 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AADsAD+8JtD/2Dv5wH5wH9MH/5+ZfLfvjMAAAA='],
  ]
  for (const [mediaType, base64] of fixtures) {
    const input = preparePhotoInput({ images: [{ mediaType, base64 }] })
    assert.equal(input.imageBlocks[0].source.data, base64)
    assert.equal(input.imageBlocks[0].source.media_type, mediaType === 'image/jpg' ? 'image/jpeg' : mediaType)
  }
})

test('photo input refuses malformed base64, spoofed types, URLs, dimensions and total size', () => {
  const oversized = Buffer.from(PNG, 'base64'); oversized.writeUInt32BE(8001, 16)
  const padded = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(1_100_000)])
  for (const candidate of [null, {}, { images: [] }, { images: Array.from({ length: 5 }, image) },
    { images: [{ base64: PNG, mediaType: 'image/svg+xml' }] }, { images: [{ base64: PNG, mediaType: 'image/jpeg' }] },
    { images: [{ base64: 'aaaa', mediaType: 'image/png' }] }, { images: [{ url: 'https://private.invalid/image' }] },
    { images: [{ base64: `data:image/png;base64,${PNG}`, mediaType: 'image/png' }] },
    { images: [{ base64: oversized.toString('base64'), mediaType: 'image/png' }] },
    { images: Array.from({ length: 3 }, () => ({ base64: padded.toString('base64'), mediaType: 'image/png' })) },
    { ...body(), clientTimezone: 'Secret/Invalid' }, { ...body(), clientNow: Infinity }]) {
    assert.throws(() => preparePhotoInput(candidate))
  }
})

test('handler rejects unauthenticated and invalid uploads before quota, model or ledger', async () => {
  let executed = 0
  const handler = createPhotoHandler({ authenticate: async req => req.headers.authorization ? 'user' : null,
    limited: () => false, getPlan: async () => assert.fail('no quota read for invalid image'),
    execute: async () => { executed++; assert.fail('no paid execution') } })
  const anonymous = responseRecorder(); await handler(request(), anonymous)
  assert.equal(anonymous.statusCode, 401)
  const invalid = responseRecorder(); await handler(request({ headers: { ...request().headers, authorization: 'Bearer offline' },
    body: { images: [{ base64: 'abcd', mediaType: 'image/png' }] } }), invalid)
  assert.equal(invalid.statusCode, 400); assert.equal(executed, 0)
})

test('handler preserves request ID for retry and never returns a cacheable photo preview', async () => {
  let received
  const handler = createPhotoHandler({ authenticate: async () => 'user', getAdmin: () => ({}),
    getPlan: async () => 'free', limited: () => false, execute: async args => {
      received = args; return { httpStatus: 200, body: { events: [event()], requestId: args.requestId } }
    } })
  const res = responseRecorder(); await handler(request(), res)
  assert.equal(res.statusCode, 200); assert.equal(received.requestId, 'photo-request-1')
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.match(res.headers['Access-Control-Allow-Headers'], /X-Request-Id/)
  assert.equal(received.input.imageBlocks.length, 1)
})

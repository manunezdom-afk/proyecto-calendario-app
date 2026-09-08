import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { admissionRPC, recoverNovaReplay } from '../api/_lib/novaAdmission.js'
import { executeNovaRequest } from '../api/_lib/novaRuntime.js'
import { sanitizeNovaRequest } from '../api/_lib/novaSafety.js'

const identity = { userId: 'synthetic-owner', requestId: 'synthetic-request', message: 'comprar pan', actionType: 'nova_message' }
const fingerprint = createHash('sha256').update(identity.message).digest('hex')
const storedResponse = { httpStatus: 200, body: { requestId: identity.requestId, reply: 'Revisa el cambio preparado.',
  actions: [{ type: 'add_task', actionId: 'synthetic-request:0', task: { label: 'Comprar pan' } }], proposed_actions: [] } }
const row = overrides => ({ user_id: identity.userId, request_id: identity.requestId, fingerprint,
  action_type: identity.actionType, state: 'completed', response_expires_at: new Date(Date.now() + 60_000).toISOString(),
  response: storedResponse, ...overrides })
function database(data = row(), { readError, rpcResult = { error: { message: 'private SQL connection detail' } }, read } = {}) {
  const calls = [], query = {}
  for (const name of ['select', 'eq', 'in', 'gt', 'limit', 'maybeSingle']) query[name] = (...args) => { calls.push({ name, args }); return query }
  query.abortSignal = signal => { calls.push({ name: 'abortSignal', signal }); return read ? read(signal) : Promise.resolve({ data, error: readError }) }
  return { calls, rpc: async (...args) => { calls.push({ name: 'rpc', args }); return rpcResult },
    from: table => { calls.push({ name: 'from', table }); return query } }
}
async function withLogs(work) {
  const old = console.warn, logs = []
  console.warn = (...args) => logs.push(args)
  try { await work(logs) } finally { console.warn = old }
}
async function runtime(admin) {
  const keys = ['OPENAI_API_KEY', 'AI_PAID_CALLS_ENABLED', 'AI_DAILY_BUDGET_USD', 'AI_MONTHLY_BUDGET_USD',
    'AI_USER_DAILY_BUDGET_USD', 'AI_USER_MONTHLY_BUDGET_USD', 'AI_MAX_COST_PER_REQUEST_USD', 'AI_BUDGET_ALERT_PERCENTAGES']
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  keys.forEach(key => delete process.env[key]); process.env.OPENAI_API_KEY = 'offline-fixture'
  try {
    return await executeNovaRequest({ admin, userId: identity.userId, requestId: identity.requestId, plan: 'free',
      body: sanitizeNovaRequest({ message: identity.message, clientNow: Date.parse('2026-09-08T15:00Z'), clientTimezone: 'America/Santiago' }).body,
      callProviders: { openai: async () => { assert.fail('Replay recovery cannot call a paid provider') } },
      track: async () => { assert.fail('Replay recovery cannot record another paid attempt') } })
  } finally { keys.forEach(key => old[key] === undefined ? delete process.env[key] : process.env[key] = old[key]) }
}

test('an uncertain admission recovers the exact durable response with one read and no further mutations', async () => withLogs(async logs => {
  const admin = database()
  assert.deepEqual(await runtime(admin), storedResponse)
  assert.equal(admin.calls.filter(call => call.name === 'rpc').length, 1)
  assert.equal(admin.calls.find(call => call.name === 'rpc').args[0], 'focus_ai_admit')
  assert.equal(admin.calls.filter(call => call.name === 'from').length, 1)
  assert.equal(admin.calls.find(call => call.name === 'from').table, 'focus_ai_requests')
  assert.deepEqual(admin.calls.filter(call => call.name === 'eq').map(call => call.args), [
    ['user_id', identity.userId], ['request_id', identity.requestId], ['fingerprint', fingerprint], ['action_type', identity.actionType],
  ])
  assert.deepEqual(admin.calls.find(call => call.name === 'in').args, ['state', ['completed', 'failed']])
  assert.equal(admin.calls.find(call => call.name === 'gt').args[0], 'response_expires_at')
  assert.deepEqual(admin.calls.find(call => call.name === 'limit').args, [1])
  assert.deepEqual(logs.map(entry => JSON.parse(entry[1]).outcome), ['database_error', 'recovered'])
}))

test('an actual aborted admission is diagnosed as timeout before a read-only recovery', async () => withLogs(async logs => {
  const admin = database()
  admin.rpc = () => { throw new DOMException('private connection timeout message', 'TimeoutError') }
  assert.deepEqual(await runtime(admin), storedResponse)
  assert.equal(JSON.parse(logs[0][1]).outcome, 'timeout')
  assert.equal(JSON.parse(logs[1][1]).outcome, 'recovered')
}))

test('terminal failures preserve their original flags and HTTP response on recovery', async () => withLogs(async () => {
  const response = { httpStatus: 503, body: { requestId: identity.requestId, error: 'assistant_unavailable',
    request_completed: true, request_retryable: true, actions: [], proposed_actions: [] } }
  assert.deepEqual(await runtime(database(row({ state: 'failed', response }))), response)
}))

test('pending, missing, expired and mismatched private rows never become a replay or a provider attempt', async () => withLogs(async () => {
  for (const data of [null, row({ state: 'in_progress' }), row({ response: null }), row({ response_expires_at: null }),
    row({ response_expires_at: new Date(Date.now() - 1).toISOString() }), row({ user_id: 'other-owner' }),
    row({ request_id: 'other-request' }), row({ fingerprint: 'other-intent' }), row({ action_type: 'photo_analysis' }),
    row({ response: { ...storedResponse, body: { ...storedResponse.body, requestId: 'other-request' } } }),
    row({ response: { httpStatus: 200, body: { requestId: identity.requestId, actions: 'malformed', proposed_actions: [] } } }),
  ]) {
    const admin = database(data), out = await runtime(admin)
    assert.equal(out.httpStatus, 503); assert.deepEqual(out.body.actions, [])
    assert.equal(out.body.request_completed, undefined)
    assert.equal(admin.calls.filter(call => call.name === 'rpc').length, 1)
    assert.equal(admin.calls.filter(call => call.name === 'from').length, 1)
  }
}))

test('denied admission and explicit policy failure never consult cached actions', async () => withLogs(async () => {
  for (const denial of [{ status: 'quota' }, { status: 'rate' }, { status: 'conflict' }, { status: 'in_progress' },
    { status: 'unavailable', reason: 'paid_ai_disabled' }, { status: 'unavailable', reason: 'invalid_model_policy' }]) {
    const admin = database(row(), { rpcResult: { data: denial } })
    assert.ok((await runtime(admin)).httpStatus >= 400)
    assert.equal(admin.calls.filter(call => call.name === 'from').length, 0)
  }
}))

test('a failed recovery read is bounded to one attempt and retains the original unconfirmed error', async () => withLogs(async logs => {
  const admin = database(null, { readError: { message: 'private read connection detail' } })
  const out = await runtime(admin)
  assert.equal(out.httpStatus, 503); assert.equal(out.body.request_completed, undefined)
  assert.equal(admin.calls.filter(call => call.name === 'from').length, 1)
  assert.equal(admin.calls.filter(call => call.name === 'abortSignal').length, 1)
  assert.equal(JSON.parse(logs.at(-1)[1]).outcome, 'database_error')
}))

test('recovery read aborts within its fixed 1500ms deadline without retrying admission', async () => withLogs(async logs => {
  const admin = database(null, { read: signal => new Promise((resolve, reject) => {
    // Keep the test event loop alive; the production HTTP request does that.
    const keepAlive = setTimeout(() => assert.fail('Recovery deadline was not enforced'), 3000)
    signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason) }, { once: true })
  }) })
  const started = Date.now(), out = await runtime(admin)
  assert.equal(out.httpStatus, 503); assert.ok(Date.now() - started < 2800)
  assert.equal(admin.calls.filter(call => call.name === 'rpc').length, 1)
  assert.equal(JSON.parse(logs.at(-1)[1]).outcome, 'timeout')
}))

test('operational diagnostics reveal no prompt, user ID, fingerprint, token or arbitrary error details', async () => withLogs(async logs => {
  const secret = 'private-message-person@example.invalid-bearer-token'
  await admissionRPC({ rpc: async () => ({ error: { message: secret, details: secret, code: secret } }) }, secret, { request_id: secret })
  await recoverNovaReplay({ admin: database(null, { readError: { message: secret } }), ...identity })
  const serialized = JSON.stringify(logs)
  for (const value of [secret, identity.userId, identity.requestId, identity.message, fingerprint]) assert.ok(!serialized.includes(value))
  for (const entry of logs) {
    assert.equal(entry[0], '[nova_admission]')
    assert.deepEqual(Object.keys(JSON.parse(entry[1])).sort(), ['duration_ms', 'operation', 'outcome'])
  }
}))

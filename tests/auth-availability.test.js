import test from 'node:test'
import assert from 'node:assert/strict'
import { getUserFromAuthDetailed, getUserFromAuth, getUserIdFromAuth } from '../api/_supabaseAdmin.js'
import focusAssistant from '../api/focus-assistant.js'

const token = 'syntheticHeader.syntheticPayload.syntheticSignature'
const req = authorization => ({ method: 'POST', headers: { authorization,
  origin: 'https://www.usefocus.me', host: 'www.usefocus.me', 'sec-fetch-site': 'same-origin' },
  socket: { remoteAddress: '198.51.100.119' }, query: {}, body: { message: 'private synthetic message' } })
const adminWith = implementation => ({ auth: { getUser: implementation } })
async function logsDuring(work) {
  const original = { info: console.info, warn: console.warn, error: console.error }, logs = []
  for (const level of Object.keys(original)) console[level] = (...args) => logs.push({ level, args })
  try { await work(logs) } finally { Object.assign(console, original) }
}
function response() {
  return { headers: {}, status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }, setHeader(key, value) { this.headers[key] = value }, end() {} }
}

test('missing and malformed bearer never call authentication or trust decoded JWT claims', async () => logsDuring(async () => {
  let called = 0
  const admin = adminWith(async () => { called++; return { data: { user: { id: 'forged-owner' } } } })
  for (const value of [undefined, [], {}, 'Basic abc', 'Bearer ', 'Bearer no-jwt', 'Bearer a.b.', `Bearer ${'a'.repeat(8193)}.b.c`]) {
    assert.deepEqual(await getUserFromAuthDetailed(req(value), { admin }), { status: 'invalid' })
  }
  assert.equal(called, 0)
  const forged = `e30.${Buffer.from(JSON.stringify({ sub: 'forged-owner', role: 'service_role', exp: 9999999999 })).toString('base64url')}.signature`
  assert.deepEqual(await getUserFromAuthDetailed(req(`Bearer ${forged}`), {
    admin: adminWith(async actual => { called++; assert.equal(actual, forged); return { error: { status: 401 } } }),
  }), { status: 'invalid' })
  assert.equal(called, 1)
}))

test('only one successful server verification returns the server user, preserving legacy shape', async () => logsDuring(async () => {
  let called = 0
  const user = { id: 'verified-owner', email: 'synthetic@example.invalid' }
  const result = await getUserFromAuthDetailed(req(`Bearer ${token}`), {
    admin: adminWith(async actual => { called++; assert.equal(actual, token); return { data: { user: { ...user, privateMetadata: 'excluded' } } } }),
  })
  assert.deepEqual(result, { status: 'authenticated', user }); assert.equal(called, 1)
}))

test('invalid and expired credentials remain 401-class failures; availability is never authentication', async () => logsDuring(async () => {
  for (const error of [{ status: 401 }, { status: 403 }, { status: 400, code: 'bad_jwt' },
    { status: 400, code: 'jwt_expired' }, { name: 'AuthSessionMissingError' }]) {
    let called = 0
    const result = await getUserFromAuthDetailed(req(`Bearer ${token}`), { admin: adminWith(async () => { called++; return { error } }) })
    assert.deepEqual(result, { status: 'invalid' }); assert.equal(called, 1)
  }
  for (const error of [{ status: 429 }, { status: 500 }, { status: 503 }, { status: 504 },
    { name: 'AuthRetryableFetchError', status: 0 }, new DOMException('private cause', 'AbortError'),
    new DOMException('private cause', 'TimeoutError'), new TypeError('private transport cause'), { status: 400 }]) {
    let called = 0
    const result = await getUserFromAuthDetailed(req(`Bearer ${token}`), { admin: adminWith(async () => { called++; throw error }) })
    assert.deepEqual(result, { status: 'unavailable' }); assert.equal(called, 1)
  }
  assert.deepEqual(await getUserFromAuthDetailed(req(`Bearer ${token}`), { admin: null }), { status: 'unavailable' })
  assert.deepEqual(await getUserFromAuthDetailed(req(`Bearer ${token}`), { admin: adminWith(async () => ({ data: { user: {} } })) }), { status: 'unavailable' })
}))

test('auth diagnostics use only closed categories, status and duration without error bodies or identity', async () => logsDuring(async logs => {
  const secret = 'private-token-owner@example.invalid-SQL-detail'
  const result = await getUserFromAuthDetailed(req(`Bearer ${token}`), {
    admin: adminWith(async () => ({ error: { name: secret, code: secret, status: 503, message: secret, details: secret } })),
  })
  assert.deepEqual(result, { status: 'unavailable' })
  assert.doesNotMatch(JSON.stringify(logs), /private-token|owner@example|syntheticHeader|private synthetic message/)
  for (const { args } of logs) {
    assert.equal(args[0], '[focus_auth]')
    const diagnostic = JSON.parse(args[1])
    assert.deepEqual(Object.keys(diagnostic).sort(), ['category', 'duration_ms', 'status'])
    assert.equal(diagnostic.category, 'upstream_unavailable'); assert.equal(diagnostic.status, 503)
  }
}))

test('real SDK and endpoint distinguish transient failures without admission, retry, raw SDK logs or completed flags', async () => logsDuring(async logs => {
  const oldFetch = globalThis.fetch, saved = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY }
  process.env.SUPABASE_URL = 'https://offline-auth.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-offline-key'
  let mode, calls = 0
  globalThis.fetch = async (url, options) => {
    calls++
    assert.equal(String(url), 'https://offline-auth.invalid/auth/v1/user', 'No quota, ledger, replay or provider request is allowed before verified auth')
    assert.ok(options.signal instanceof AbortSignal)
    if (mode === 'timeout') throw new DOMException(`private ${token}`, 'TimeoutError')
    if (mode === 'network') throw new Error(`private ${token}`)
    return new Response(JSON.stringify(mode === 200 ? { id: 'verified-owner', email: 'synthetic@example.invalid', privateMetadata: 'excluded' }
      : { message: `private ${token}`, code: mode === 401 ? 'bad_jwt' : 'unexpected_failure' }), {
      status: mode, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
    })
  }
  try {
    for (mode of [401, 403, 500, 503, 429, 'timeout', 'network']) {
      const before = calls, res = response()
      await focusAssistant(req(`Bearer ${token}`), res)
      assert.equal(calls, before + 1, 'Authentication is never retried implicitly')
      assert.equal(res.statusCode, [401, 403].includes(mode) ? 401 : 503)
      assert.equal(res.body.error, res.statusCode === 401 ? 'auth_required' : 'auth_unavailable')
      assert.equal(res.headers['Cache-Control'], 'no-store')
      if (res.statusCode === 503) { assert.deepEqual(res.body.actions, []); assert.deepEqual(res.body.proposed_actions, []) }
      assert.equal(res.body.request_completed, undefined); assert.equal(res.body.request_retryable, undefined)
      assert.equal(res.body.requestId, undefined)
    }
    mode = 503
    assert.equal(await getUserFromAuth(req(`Bearer ${token}`)), null)
    assert.equal(await getUserIdFromAuth(req(`Bearer ${token}`)), null)
    mode = 200
    assert.deepEqual(await getUserFromAuth(req(`Bearer ${token}`)), { id: 'verified-owner', email: 'synthetic@example.invalid' })
    assert.equal(await getUserIdFromAuth(req(`Bearer ${token}`)), 'verified-owner')
    assert.ok(logs.every(entry => entry.level === 'info'))
    for (const { args } of logs) {
      assert.equal(args[0], '[focus_auth]')
      assert.deepEqual(Object.keys(JSON.parse(args[1])).sort(), ['category', 'duration_ms', 'status'])
    }
    assert.doesNotMatch(JSON.stringify(logs), /private|syntheticHeader|offline-auth|synthetic-offline-key/)
  } finally {
    globalThis.fetch = oldFetch
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value
  }
}))

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Execute the actual provider's first effect. JSX rendering and external
// features are excluded, while the real Supabase session lock and REST client
// remain in the first regression. Every HTTP call uses the in-memory fetch.
const source = fs.readFileSync(new URL('../src/context/AuthContext.jsx', import.meta.url), 'utf8')
const start = source.indexOf('  useEffect(() => {') + '  useEffect(() => {'.length
const effect = source.slice(start, source.indexOf('  }, [])', start))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

function mount(auth, dataService) {
  const state = { user: null, loading: true, publications: [], behavior: [] }
  const bindings = {
    supabase: auth, dataService,
    setUser(user) { state.user = user; state.publications.push(user?.id ?? null) },
    setLoading(value) { state.loading = value }, setSignalsUserId() {},
    setRecoveryMode() {}, setAuthModal() {}, clearPrivateUserDataLocal() {},
    flushSignalsQueue: async () => {}, fetchBehavior: async id => { state.behavior.push(id) },
    flushPendingSubscription: async () => {}, flushPendingNativeToken: async () => {},
    getNativePushStatus: async () => ({ supported: false }), getPushStatus: async () => ({ supported: false }),
    registerNativePush: async () => {}, subscribeToPush: async () => {},
  }
  const cleanup = new Function(...Object.keys(bindings), effect)(...Object.values(bindings))
  return { state, cleanup }
}

function restoredClient() {
  const id = 'c318741e-847e-45aa-842e-c3dd41e8f36c'
  const exp = Math.floor(Date.now() / 1000) + 3600
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp, role: 'authenticated' })}.synthetic-signature`
  const storageKey = `auth-lock-test-${crypto.randomUUID()}`
  const values = new Map([[storageKey, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', expires_at: exp,
    expires_in: 3600, token_type: 'bearer', user: { id, aud: 'authenticated', role: 'authenticated' } })]])
  const requests = []
  const client = createClient('https://synthetic.invalid', 'synthetic-anon-key', {
    auth: { storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } },
    global: { fetch: async (url, init) => {
      assert.equal(new URL(url).origin, 'https://synthetic.invalid')
      requests.push({ method: init.method, pathname: new URL(url).pathname })
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  return { client, id, requests }
}

test('restored session releases the real SDK auth lock before flushing a REST deletion', { timeout: 2500 }, async () => {
  const { client, id, requests } = restoredClient()
  const { state, cleanup } = mount(client, { clearGlobalCache() {}, flushQueue: async () => {
    const { error } = await client.from('events').delete().eq('user_id', id).eq('id', 'own-synthetic-event')
    assert.equal(error, null)
  } })
  try {
    for (let i = 0; i < 100 && !requests.length; i++) await pause(10)
    assert.ok(requests.some(request => request.method === 'DELETE' && request.pathname === '/rest/v1/events'), 'queued deletion must reach REST instead of waiting forever on its own auth callback')
    assert.equal(state.user.id, id)
    assert.equal(state.loading, false)
  } finally { cleanup(); await client.auth.stopAutoRefresh() }
})

test('unmount during session restoration neither publishes a late user nor flushes private queues', async () => {
  const { client, requests } = restoredClient()
  let flushes = 0
  const { state, cleanup } = mount(client, { clearGlobalCache() {}, flushQueue: async () => { flushes++ } })
  cleanup()
  await client.auth.getSession()
  await pause(20)
  assert.deepEqual(state.publications, [])
  assert.equal(flushes, 0)
  assert.equal(requests.length, 0)
  await client.auth.stopAutoRefresh()
})

test('sign-out cancels deferred sync and stops an in-flight account from starting later sync steps', async () => {
  let callback, releaseQueue, flushes = 0
  const auth = { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() {} } } } } } }
  const { state, cleanup } = mount(auth, { clearGlobalCache() {}, flushQueue: () => { flushes++; return new Promise(resolve => { releaseQueue = resolve }) } })
  try {
    await pause(0)
    assert.equal(callback('SIGNED_IN', { user: { id: 'A' } }), undefined)
    callback('SIGNED_OUT', null)
    await pause(10)
    assert.equal(flushes, 0)
    callback('SIGNED_IN', { user: { id: 'A' } })
    await pause(10)
    assert.equal(flushes, 1)
    callback('SIGNED_OUT', null)
    releaseQueue()
    await pause(10)
    assert.equal(state.user, null)
    assert.deepEqual(state.behavior, [])
  } finally { cleanup() }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeleteAccountHandler } from '../api/auth/delete-account.js'

const userId = '00000000-0000-4000-8000-000000000001'

function request(body = { confirm: 'DELETE' }) {
  return {
    method: 'POST',
    headers: { host: 'focus.test', origin: 'https://focus.test', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '198.51.100.60' },
    body,
  }
}

function response() {
  return {
    statusCode: null, body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    end() { return this },
  }
}

function fixture({ authenticated = true, cleanupError = null, deleteError = null, throws = false, configured = true } = {}) {
  const calls = []
  const admin = {
    from(table) {
      assert.equal(table, 'device_pairings')
      return {
        delete() {
          return { async eq(column, owner) {
            calls.push({ operation: 'cleanup', table, column, owner })
            if (throws) throw new Error('Simulated transport failure')
            return { error: cleanupError }
          } }
        },
      }
    },
    auth: { admin: { async deleteUser(id, shouldSoftDelete) {
      calls.push({ operation: 'deleteUser', id, shouldSoftDelete })
      return { error: deleteError }
    } } },
  }
  return {
    calls,
    handler: createDeleteAccountHandler({
      resolveUserId: async () => authenticated ? userId : null,
      getAdmin: () => configured ? admin : null,
      isRateLimited: () => false,
    }),
  }
}

test('account deletion cleans non-cascading pairing data before requesting hard delete', async () => {
  const { handler, calls } = fixture()
  const res = response()
  await handler(request(), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { ok: true })
  assert.deepEqual(calls, [
    { operation: 'cleanup', table: 'device_pairings', column: 'user_id', owner: userId },
    { operation: 'deleteUser', id: userId, shouldSoftDelete: false },
  ])
})

test('account deletion requires authentication and explicit confirmation before mutation', async () => {
  for (const options of [{ authenticated: false }, {}]) {
    const { handler, calls } = fixture(options)
    const res = response()
    await handler(request({}), res)
    assert.equal(res.statusCode, options.authenticated === false ? 401 : 400)
    assert.deepEqual(calls, [])
  }
})

test('a cleanup failure or ambiguous schema cache error never deletes auth or claims success', async () => {
  for (const code of ['42501', 'PGRST205', '57014']) {
    const { handler, calls } = fixture({ cleanupError: { code } })
    const res = response()
    await handler(request(), res)
    assert.equal(res.statusCode, 500)
    assert.deepEqual(res.body, { error: 'cleanup_failed' })
    assert.equal(calls.length, 1)
  }
})

test('a definitely absent optional pairing table does not prevent hard deletion', async () => {
  const { handler, calls } = fixture({ cleanupError: { code: '42P01' } })
  const res = response()
  await handler(request(), res)
  assert.equal(res.statusCode, 200)
  assert.equal(calls.at(-1).shouldSoftDelete, false)
})

test('auth delete errors return failure after idempotent pairing cleanup', async () => {
  const { handler, calls } = fixture({ deleteError: { message: 'simulated error' } })
  const res = response()
  await handler(request(), res)
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.body, { error: 'delete_failed' })
  assert.equal(calls.at(-1).shouldSoftDelete, false)
})

test('unconfigured backend and thrown cleanup do not claim account deletion', async () => {
  for (const options of [{ configured: false }, { throws: true }]) {
    const { handler, calls } = fixture(options)
    const res = response()
    await handler(request(), res)
    assert.equal(res.statusCode, options.configured === false ? 503 : 500)
    assert.equal(calls.some(call => call.operation === 'deleteUser'), false)
  }
})

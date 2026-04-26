import assert from 'node:assert/strict'
import test from 'node:test'

import { isTrustedOrigin, rejectCrossSiteUnsafe } from '../api/_lib/security.js'

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

test('Capacitor localhost origins are trusted for native app API calls', () => {
  assert.equal(isTrustedOrigin({ headers: {} }, 'capacitor://localhost'), true)
  assert.equal(isTrustedOrigin({ headers: {} }, 'https://localhost'), true)
})

test('cross-site unsafe requests are allowed only for trusted native origins', () => {
  const nativeReq = {
    method: 'POST',
    headers: {
      origin: 'capacitor://localhost',
      'sec-fetch-site': 'cross-site',
    },
  }
  assert.equal(rejectCrossSiteUnsafe(nativeReq, mockRes()), false)

  const evilRes = mockRes()
  const evilReq = {
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    },
  }
  assert.equal(rejectCrossSiteUnsafe(evilReq, evilRes), true)
  assert.equal(evilRes.statusCode, 403)

  const noOriginRes = mockRes()
  const noOriginReq = {
    method: 'POST',
    headers: {
      'sec-fetch-site': 'cross-site',
    },
  }
  assert.equal(rejectCrossSiteUnsafe(noOriginReq, noOriginRes), true)
  assert.equal(noOriginRes.statusCode, 403)
})

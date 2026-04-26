import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'

import {
  buildApnsNotification,
  createApnsJwt,
  normalizeApnsToken,
} from '../api/_lib/apns.js'

function decodeBase64UrlJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

test('normalizeApnsToken accepts hex tokens and strips separators', () => {
  const token = 'ab cd-01:EF'
  assert.equal(normalizeApnsToken(token), 'abcd01ef')
})

test('normalizeApnsToken rejects invalid APNs tokens', () => {
  assert.equal(normalizeApnsToken('not a token'), null)
  assert.equal(normalizeApnsToken('abc'), null)
})

test('createApnsJwt builds an ES256 provider token', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' })
  const jwt = createApnsJwt({
    teamId: 'TEAM123456',
    keyId: 'KEY1234567',
    privateKey: pem,
    nowSeconds: 1777183200,
  })

  const [headerPart, payloadPart, signaturePart] = jwt.split('.')
  assert.deepEqual(decodeBase64UrlJson(headerPart), {
    alg: 'ES256',
    kid: 'KEY1234567',
  })
  assert.deepEqual(decodeBase64UrlJson(payloadPart), {
    iss: 'TEAM123456',
    iat: 1777183200,
  })
  assert.ok(Buffer.from(signaturePart, 'base64url').length > 60)
})

test('buildApnsNotification maps Focus payload to APNs request details', () => {
  const req = buildApnsNotification({
    token: 'AB CD 01 EF 23 45 67 89',
    bundleId: 'me.usefocus.app',
    jwt: 'provider.jwt',
    payload: {
      title: 'Reunión en 10 min',
      body: 'Abre Focus para el detalle.',
      tag: 'reminder-event-1',
      url: '/?view=day',
      data: { eventId: 'event-1', kind: 'meeting_prep' },
    },
  })

  assert.equal(req.path, '/3/device/abcd01ef23456789')
  assert.equal(req.headers.authorization, 'bearer provider.jwt')
  assert.equal(req.headers['apns-topic'], 'me.usefocus.app')
  assert.equal(req.headers['apns-push-type'], 'alert')
  assert.equal(req.headers['apns-collapse-id'], 'reminder-event-1')
  assert.deepEqual(req.body.aps.alert, {
    title: 'Reunión en 10 min',
    body: 'Abre Focus para el detalle.',
  })
  assert.equal(req.body.url, '/?view=day')
  assert.equal(req.body.eventId, 'event-1')
})

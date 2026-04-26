import { createSign } from 'node:crypto'
import { connect } from 'node:http2'

const DEFAULT_BUNDLE_ID = 'me.usefocus.app'
const PROD_HOST = 'api.push.apple.com'
const SANDBOX_HOST = 'api.sandbox.push.apple.com'
const providerTokenCache = new Map()

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n').trim()
}

function normalizeEnvironment(value) {
  return value === 'development' || value === 'sandbox' ? 'development' : 'production'
}

function hostForEnvironment(value) {
  return normalizeEnvironment(value) === 'development' ? SANDBOX_HOST : PROD_HOST
}

export function normalizeApnsToken(value) {
  const token = String(value || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase()
  if (token.length < 8 || token.length % 2 !== 0) return null
  return token
}

export function createApnsJwt({ teamId, keyId, privateKey, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!teamId || !keyId || !privateKey) {
    throw new Error('apns_missing_credentials')
  }

  const header = base64UrlJson({ alg: 'ES256', kid: keyId })
  const claims = base64UrlJson({ iss: teamId, iat: nowSeconds })
  const input = `${header}.${claims}`
  const signer = createSign('sha256')
  signer.update(input)
  signer.end()
  const signature = signer.sign({
    key: normalizePrivateKey(privateKey),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')

  return `${input}.${signature}`
}

function getCachedApnsJwt(config) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const cacheKey = `${config.teamId}:${config.keyId}`
  const cached = providerTokenCache.get(cacheKey)
  if (cached && cached.expiresAt > nowSeconds + 60) return cached.token

  const token = createApnsJwt({ ...config, nowSeconds })
  providerTokenCache.set(cacheKey, {
    token,
    expiresAt: nowSeconds + 50 * 60,
  })
  return token
}

export function clearApnsJwtCache() {
  providerTokenCache.clear()
}

export function getApnsConfig(env = process.env) {
  const teamId = env.APNS_TEAM_ID
  const keyId = env.APNS_KEY_ID
  const privateKey = normalizePrivateKey(env.APNS_PRIVATE_KEY)
  const bundleId = env.APNS_BUNDLE_ID || DEFAULT_BUNDLE_ID
  const environment = normalizeEnvironment(env.APNS_ENV || env.APNS_ENVIRONMENT || 'production')
  const host = hostForEnvironment(environment)

  return {
    configured: Boolean(teamId && keyId && privateKey && bundleId),
    teamId,
    keyId,
    privateKey,
    bundleId,
    host,
    environment,
  }
}

export function resolveApnsConfig(config = getApnsConfig()) {
  const environment = normalizeEnvironment(config.environment)
  return {
    ...config,
    environment,
    host: hostForEnvironment(environment),
  }
}

export function buildApnsNotification({
  token,
  bundleId,
  jwt,
  payload = {},
  expiration = Math.floor(Date.now() / 1000) + 3600,
}) {
  const cleanToken = normalizeApnsToken(token)
  if (!cleanToken) throw new Error('apns_invalid_token')
  if (!bundleId) throw new Error('apns_missing_bundle_id')
  if (!jwt) throw new Error('apns_missing_jwt')

  const title = String(payload.title || 'Focus')
  const body = String(payload.body || '')
  const tag = String(payload.tag || payload.data?.eventId || `focus-${Date.now()}`)
  const customData = payload.data && typeof payload.data === 'object' ? payload.data : {}
  const aps = {
    alert: { title, body },
    sound: payload.sound || 'default',
    'thread-id': tag,
  }
  if (Number.isInteger(payload.badge)) aps.badge = payload.badge

  return {
    path: `/3/device/${cleanToken}`,
    headers: {
      ':method': 'POST',
      ':path': `/3/device/${cleanToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': String(payload.priority || 10),
      'apns-expiration': String(expiration),
      'apns-collapse-id': tag.slice(0, 64),
    },
    body: {
      aps,
      url: payload.url || '/',
      ...customData,
    },
  }
}

export async function sendApnsNotification({ token, payload, config = getApnsConfig() }) {
  const resolvedConfig = resolveApnsConfig(config)
  if (!resolvedConfig?.configured) return { ok: false, statusCode: null, error: 'apns_not_configured' }

  const jwt = getCachedApnsJwt(resolvedConfig)
  const request = buildApnsNotification({
    token,
    bundleId: resolvedConfig.bundleId,
    jwt,
    payload,
  })
  const body = JSON.stringify(request.body)

  return new Promise((resolve) => {
    const client = connect(`https://${resolvedConfig.host}`)
    let resolved = false
    const timeout = setTimeout(() => {
      finish({ ok: false, statusCode: null, error: 'apns_timeout' })
    }, resolvedConfig.timeoutMs || 10000)

    function finish(value) {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      client.close()
      resolve(value)
    }

    client.on('error', (err) => {
      finish({ ok: false, statusCode: null, error: String(err?.message || err) })
    })

    const stream = client.request({
      ...request.headers,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    })
    let statusCode = null
    let response = ''

    stream.setEncoding('utf8')
    stream.on('response', (headers) => {
      statusCode = Number(headers[':status'])
    })
    stream.on('data', (chunk) => {
      response += chunk
    })
    stream.on('error', (err) => {
      finish({ ok: false, statusCode, error: String(err?.message || err) })
    })
    stream.on('end', () => {
      if (statusCode >= 200 && statusCode < 300) {
        finish({ ok: true, statusCode, error: null })
        return
      }

      let reason = response
      try {
        reason = JSON.parse(response)?.reason || response
      } catch {}
      finish({ ok: false, statusCode, error: String(reason || `status ${statusCode}`) })
    })
    stream.end(body)
  })
}

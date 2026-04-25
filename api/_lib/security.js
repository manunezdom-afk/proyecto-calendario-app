const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function parseOrigin(value) {
  if (!value || typeof value !== 'string') return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function hostFromOrigin(origin) {
  try {
    return new URL(origin).host
  } catch {
    return ''
  }
}

function envOrigins() {
  return [
    process.env.APP_URL,
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VITE_APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null,
  ]
    .map(parseOrigin)
    .filter(Boolean)
}

function isLocalHost(host) {
  return (
    host.startsWith('localhost:') ||
    host.startsWith('127.0.0.1:') ||
    host.startsWith('[::1]:') ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]'
  )
}

export function isTrustedOrigin(req, rawOrigin = req.headers?.origin) {
  const origin = parseOrigin(rawOrigin)
  if (!origin) return true

  const originHost = hostFromOrigin(origin)
  const requestHost = String(req.headers?.host || '').toLowerCase()
  if (originHost && requestHost && originHost.toLowerCase() === requestHost) return true
  if (isLocalHost(originHost)) return true

  return envOrigins().includes(origin)
}

export function setCorsHeaders(req, res, { methods = 'POST, OPTIONS' } = {}) {
  const origin = parseOrigin(req.headers?.origin)
  if (origin && isTrustedOrigin(req, origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', methods)
}

export function rejectCrossSiteUnsafe(req, res) {
  if (!UNSAFE_METHODS.has(req.method)) return false

  const secFetchSite = String(req.headers?.['sec-fetch-site'] || '').toLowerCase()
  if (secFetchSite === 'cross-site') {
    res.status(403).json({ error: 'cross_site_blocked' })
    return true
  }

  if (!isTrustedOrigin(req)) {
    res.status(403).json({ error: 'untrusted_origin' })
    return true
  }

  return false
}

export function publicOrigin(req) {
  const origin = parseOrigin(req.headers?.origin)
  if (origin && isTrustedOrigin(req, origin)) return origin

  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').trim()
  if (!host) return ''
  const proto = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https'
  return `${proto}://${host}`
}

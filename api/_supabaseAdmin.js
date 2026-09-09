// Cliente Supabase con service_role (bypasea RLS). Solo backend.
// Necesita: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en env vars del backend.

import { createClient } from '@supabase/supabase-js'

let _admin = null

function authDiagnostic(category, status, started) {
  console.info('[focus_auth]', JSON.stringify({ category, status, duration_ms: Math.max(0, Date.now() - started) }))
}

async function adminFetch(input, options = {}) {
  const started = Date.now()
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000)
  try {
    return await fetch(input, { ...options, signal })
  } catch (error) {
    // Auth JS prints transport exceptions before returning them. Keep private
    // URLs/headers/error causes out of that SDK log, without retrying the read.
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.pathname !== '/auth/v1/user' || (options.method || 'GET').toUpperCase() !== 'GET') throw error
    authDiagnostic(signal.aborted || ['AbortError', 'TimeoutError'].includes(error?.name) ? 'transport_timeout' : 'transport_error', 503, started)
    return new Response(JSON.stringify({ message: 'Authentication service unavailable' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }
}

export function getSupabaseAdmin() {
  if (_admin) return _admin
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: adminFetch },
  })
  return _admin
}

/** Extrae el user_id del JWT "Bearer <token>" del header Authorization */
export async function getUserIdFromAuth(req) {
  const user = await getUserFromAuth(req)
  return user?.id || null
}

/** Devuelve { id, email } del JWT. Una sola llamada a Supabase — evita
 *  que un handler tenga que volver a consultar getUserById después. */
export async function getUserFromAuth(req) {
  const result = await getUserFromAuthDetailed(req, { diagnostics: false })
  return result.status === 'authenticated' ? result.user : null
}

/** Server verification is the only identity authority. Availability failures
 *  are distinct from invalid credentials; neither permits admission or replay. */
export async function getUserFromAuthDetailed(req, { admin, diagnostics = true } = {}) {
  const started = Date.now()
  const result = (status, category, user) => {
    if (diagnostics) authDiagnostic(category, status === 'authenticated' ? 200 : status === 'invalid' ? 401 : 503, started)
    return user ? { status, user } : { status }
  }
  const authHeader = req.headers?.authorization || req.headers?.Authorization
  if (authHeader == null) return result('invalid', 'missing_bearer')
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return result('invalid', 'malformed_bearer')
  const token = authHeader.slice(7)
  // Shape rejection is not JWT validation. Even a well-formed token must pass
  // auth.getUser; never decode its claims as proof of an authenticated user.
  if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return result('invalid', 'malformed_bearer')
  try {
    const client = admin === undefined ? getSupabaseAdmin() : admin
    if (typeof client?.auth?.getUser !== 'function') return result('unavailable', 'missing_client')
    const { data, error } = await client.auth.getUser(token)
    if (error) return classifyAuthError(error, result)
    if (typeof data?.user?.id !== 'string' || !data.user.id) return result('unavailable', 'invalid_response')
    return result('authenticated', 'verified', { id: data.user.id, email: data.user.email || null })
  } catch (error) {
    return classifyAuthError(error, result)
  }
}

function classifyAuthError(error, result) {
  if (['AbortError', 'TimeoutError'].includes(error?.name)) return result('unavailable', 'transport_timeout')
  const status = error?.status
  if (status === 429 || Number.isInteger(status) && status >= 500 && status <= 599) return result('unavailable', 'upstream_unavailable')
  if (error?.name === 'AuthRetryableFetchError') return result('unavailable', 'transport_error')
  if ([401, 403].includes(status) || error?.name === 'AuthSessionMissingError'
    || ['bad_jwt', 'jwt_expired', 'no_authorization', 'session_not_found', 'user_not_found'].includes(error?.code)) return result('invalid', 'invalid_credential')
  return result('unavailable', 'verification_unavailable')
}

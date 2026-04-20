// Cliente Supabase con service_role (bypasea RLS). Solo backend.
// Necesita: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en env vars del backend.

import { createClient } from '@supabase/supabase-js'

let _admin = null

export function getSupabaseAdmin() {
  if (_admin) return _admin
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}

// Cache en memoria de (token → userId) por 5 min. Evita un round-trip a
// Supabase en cada llamada. Se resetea en cada cold start del serverless,
// que es justamente cuando el cache estaría más "frío" de todos modos.
const _jwtCache = new Map()
const JWT_CACHE_TTL_MS = 5 * 60 * 1000

/** Extrae el user_id del JWT "Bearer <token>" del header Authorization */
export async function getUserIdFromAuth(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const cached = _jwtCache.get(token)
  if (cached && cached.exp > Date.now()) return cached.userId

  const admin = getSupabaseAdmin()
  if (!admin) return null
  try {
    const { data, error } = await admin.auth.getUser(token)
    if (error) return null
    const userId = data?.user?.id || null
    if (userId) {
      _jwtCache.set(token, { userId, exp: Date.now() + JWT_CACHE_TTL_MS })
      // Evita que el Map crezca sin límite en procesos largos.
      if (_jwtCache.size > 500) {
        const oldestKey = _jwtCache.keys().next().value
        _jwtCache.delete(oldestKey)
      }
    }
    return userId
  } catch {
    return null
  }
}

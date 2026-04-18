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

/** Extrae el user_id del JWT "Bearer <token>" del header Authorization */
export async function getUserIdFromAuth(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const admin = getSupabaseAdmin()
  if (!admin) return null
  try {
    const { data, error } = await admin.auth.getUser(token)
    if (error) return null
    return data?.user?.id || null
  } catch {
    return null
  }
}

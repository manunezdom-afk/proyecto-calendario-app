// POST /api/auth/device/approve
// El dispositivo con sesión aprueba un pairing ingresando el user_code.
// Auth: Bearer <access_token> de Supabase.
// Body: { user_code }
// Response: { ok: true, email, user_agent }
//
// Genera un magic-link via supabase.auth.admin.generateLink: esto NO envía
// email (solo devuelve el token_hash que el nuevo dispositivo intercambia).

import { getSupabaseAdmin, getUserFromAuth } from '../../_supabaseAdmin.js'
import { rateLimited, clientIp } from '../../_lib/rateLimit.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (rateLimited(clientIp(req), { max: 15, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const authUser = await getUserFromAuth(req)
  if (!authUser?.id || !authUser?.email) return res.status(401).json({ error: 'unauthorized' })
  const userId = authUser.id
  const email = authUser.email

  // Normalizamos: quitamos espacios, guiones, y pasamos a mayúsculas. El
  // alfabeto del user_code no tiene letras ambiguas, así que no mapeamos O→0.
  const userCode = String(req.body?.user_code || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()

  if (userCode.length < 6 || userCode.length > 12) {
    return res.status(400).json({ error: 'invalid_user_code' })
  }

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const { data: pairing, error: fErr } = await admin
    .from('device_pairings')
    .select('device_code, status, expires_at, user_agent')
    .eq('user_code', userCode)
    .maybeSingle()

  if (fErr) {
    console.error('[device/approve] find error', fErr)
    return res.status(500).json({ error: 'db_error' })
  }
  if (!pairing) return res.status(404).json({ error: 'not_found' })
  if (pairing.status !== 'pending') {
    return res.status(409).json({ error: 'invalid_state', status: pairing.status })
  }
  if (new Date(pairing.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'expired' })
  }

  const { data: linkData, error: lErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = linkData?.properties?.hashed_token
  if (lErr || !tokenHash) {
    console.error('[device/approve] generateLink', lErr)
    return res.status(500).json({ error: 'link_generation_failed' })
  }

  const { error: upErr } = await admin
    .from('device_pairings')
    .update({
      status: 'approved',
      user_id: userId,
      email,
      token_hash: tokenHash,
      approved_at: new Date().toISOString(),
    })
    .eq('device_code', pairing.device_code)
    .eq('status', 'pending')

  if (upErr) {
    console.error('[device/approve] update error', upErr)
    return res.status(500).json({ error: 'db_error' })
  }

  return res.status(200).json({
    ok: true,
    email,
    user_agent: pairing.user_agent || null,
  })
}

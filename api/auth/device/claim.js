// POST /api/auth/device/claim
// El dispositivo nuevo (sin sesión) canjea un user_code pre-aprobado por el
// token_hash que le permite abrir sesión. El user_code lo genera el
// dispositivo ya logueado via /api/auth/device/start.
//
// Sin auth. Body: { user_code }. Response: { email, token_hash }.
// La row queda marcada consumed al primer acierto para bloquear replay.

import { getSupabaseAdmin } from '../../_supabaseAdmin.js'
import { rateLimited, clientIp } from '../../_lib/rateLimit.js'
import { rejectCrossSiteUnsafe, setCorsHeaders } from '../../_lib/security.js'

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS' })
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (rejectCrossSiteUnsafe(req, res)) return

  // Rate-limit agresivo para bloquear bruteforce del user_code (32^8 combos,
  // pero TTL de 5 min y consumición al primer hit hacen que valga la pena
  // mantener baja la tasa de intentos por IP).
  const ip = clientIp(req)
  if (rateLimited(ip, { max: 20, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const userCode = String(req.body?.user_code || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()

  if (userCode.length !== 8) {
    return res.status(400).json({ error: 'invalid_user_code' })
  }
  if (rateLimited(`${ip}:device-claim:${userCode}`, { max: 5, windowMs: 5 * 60_000 })) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const { data: pairing, error: fErr } = await admin
    .from('device_pairings')
    .select('device_code, status, expires_at, email, token_hash')
    .eq('user_code', userCode)
    .maybeSingle()

  if (fErr) {
    console.error('[device/claim] find error', fErr)
    return res.status(500).json({ error: 'db_error' })
  }
  if (!pairing) return res.status(404).json({ error: 'not_found' })

  if (new Date(pairing.expires_at).getTime() < Date.now()) {
    // Best-effort: marcar expired para que no quede "approved" vencida en DB.
    if (pairing.status === 'approved') {
      await admin
        .from('device_pairings')
        .update({ status: 'expired' })
        .eq('device_code', pairing.device_code)
        .eq('status', 'approved')
    }
    return res.status(410).json({ error: 'expired' })
  }

  if (pairing.status !== 'approved' || !pairing.token_hash || !pairing.email) {
    return res.status(409).json({ error: 'invalid_state', status: pairing.status })
  }

  // Consumimos ANTES de responder. La condición `.eq('status', 'approved')`
  // garantiza que dos claims concurrentes no se lleven ambos el token: el
  // segundo update afectará 0 rows (y podemos detectarlo si hiciera falta).
  const { error: upErr } = await admin
    .from('device_pairings')
    .update({ status: 'consumed', consumed_at: new Date().toISOString() })
    .eq('device_code', pairing.device_code)
    .eq('status', 'approved')

  if (upErr) {
    console.error('[device/claim] consume error', upErr)
    return res.status(500).json({ error: 'db_error' })
  }

  return res.status(200).json({
    email: pairing.email,
    token_hash: pairing.token_hash,
  })
}

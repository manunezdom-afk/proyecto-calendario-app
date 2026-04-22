// POST /api/auth/device/poll
// El nuevo dispositivo consulta el estado del pairing.
// Body: { device_code }
// Response:
//   { status: 'pending' | 'expired' | 'consumed' }
//   { status: 'approved', email, token_hash }  ← una sola vez, luego 'consumed'

import { getSupabaseAdmin } from '../../_supabaseAdmin.js'
import { rateLimited, clientIp } from '../../_lib/rateLimit.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // Polling cada ~3s durante 5 min → ~100 reqs. Damos margen x3 para reintentos.
  if (rateLimited(clientIp(req), { max: 120, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limited', retry_after: 5 })
  }

  const device_code = String(req.body?.device_code || '').trim()
  if (!device_code || device_code.length < 32) {
    return res.status(400).json({ error: 'invalid_device_code' })
  }

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const { data, error } = await admin
    .from('device_pairings')
    .select('status, email, token_hash, expires_at')
    .eq('device_code', device_code)
    .maybeSingle()

  if (error) {
    console.error('[device/poll] db error', error)
    return res.status(500).json({ error: 'db_error' })
  }
  if (!data) return res.status(404).json({ status: 'not_found' })

  const nowExpired = new Date(data.expires_at).getTime() < Date.now()
  if (nowExpired && data.status === 'pending') {
    await admin
      .from('device_pairings')
      .update({ status: 'expired' })
      .eq('device_code', device_code)
    return res.status(200).json({ status: 'expired' })
  }

  if (data.status === 'approved' && data.email && data.token_hash) {
    // Único uso: marcamos consumed antes de responder, así un replay no
    // vuelve a obtener el token_hash aunque alguien intercepte el device_code.
    const { error: upErr } = await admin
      .from('device_pairings')
      .update({ status: 'consumed', consumed_at: new Date().toISOString() })
      .eq('device_code', device_code)
      .eq('status', 'approved')
    if (upErr) {
      console.error('[device/poll] consume error', upErr)
      return res.status(500).json({ error: 'db_error' })
    }
    return res.status(200).json({
      status: 'approved',
      email: data.email,
      token_hash: data.token_hash,
    })
  }

  return res.status(200).json({ status: data.status })
}

// POST /api/auth/device/start
// Flujo invertido: el dispositivo LOGUEADO genera un pairing pre-aprobado y
// muestra el user_code en un QR. El dispositivo nuevo lo escanea y canjea el
// user_code por una sesión via /api/auth/device/claim.
//
// Auth: Bearer <access_token> de Supabase (requerido).
// Body: opcional.
// Response: { user_code, expires_in }.
//
// Genera un magic-link via supabase.auth.admin.generateLink (sin enviar email)
// y lo guarda en la row junto al user_code. Ese token_hash lo entrega /claim.

import { randomBytes, randomUUID } from 'crypto'
import { getSupabaseAdmin, getUserFromAuth } from '../../_supabaseAdmin.js'
import { rateLimited, clientIp } from '../../_lib/rateLimit.js'

// Alfabeto sin ambigüedades visuales: sin 0/O, sin 1/I/L.
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TTL_SEC = 5 * 60

function generateUserCode() {
  const bytes = randomBytes(8)
  let s = ''
  for (const b of bytes) s += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]
  return s
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (rateLimited(clientIp(req), { max: 10, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const authUser = await getUserFromAuth(req)
  if (!authUser?.id || !authUser?.email) return res.status(401).json({ error: 'unauthorized' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  // Generamos el magic-link una sola vez — es lo más caro del endpoint.
  const { data: linkData, error: lErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: authUser.email,
  })
  const tokenHash = linkData?.properties?.hashed_token
  if (lErr || !tokenHash) {
    console.error('[device/start] generateLink', lErr)
    return res.status(500).json({ error: 'link_generation_failed' })
  }

  const user_agent = String(
    req.body?.user_agent || req.headers['user-agent'] || ''
  ).slice(0, 200)

  const nowIso = new Date().toISOString()

  // Retry por colisión del UNIQUE en user_code (muy improbable con 32^8 combos).
  for (let i = 0; i < 5; i++) {
    const device_code = `${randomUUID()}.${randomBytes(16).toString('hex')}`
    const user_code   = generateUserCode()
    const expires_at  = new Date(Date.now() + TTL_SEC * 1000).toISOString()

    const { error } = await admin.from('device_pairings').insert({
      device_code,
      user_code,
      expires_at,
      user_agent,
      status: 'approved',
      user_id: authUser.id,
      email: authUser.email,
      token_hash: tokenHash,
      approved_at: nowIso,
    })

    if (!error) {
      return res.status(200).json({
        user_code,
        expires_in: TTL_SEC,
      })
    }
    if (!/duplicate|unique/i.test(error.message || '')) {
      console.error('[device/start] db error', error)
      return res.status(500).json({ error: 'db_error' })
    }
  }

  return res.status(500).json({ error: 'code_collision' })
}

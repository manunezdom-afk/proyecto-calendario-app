// POST /api/auth/device/start
// Crea un device pairing para un dispositivo nuevo sin sesión.
// Responde { device_code, user_code, expires_in }.
// device_code: opaco (polling). user_code: legible (se muestra al usuario).

import { randomBytes, randomUUID } from 'crypto'
import { getSupabaseAdmin } from '../../_supabaseAdmin.js'
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

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const user_agent = String(
    req.body?.user_agent || req.headers['user-agent'] || ''
  ).slice(0, 200)

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
    })

    if (!error) {
      return res.status(200).json({
        device_code,
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

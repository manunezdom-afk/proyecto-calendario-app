// POST /api/push-snooze
// Marca que un recordatorio debe re-enviarse en N minutos más.
// Se llama desde el SW cuando el usuario toca "Posponer 10 min".
// Auth: token HMAC firmado emitido por el cron (el SW no puede adjuntar JWT),
// o Bearer <access_token> de Supabase si la llamada viene del cliente.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'

export function verifySnoozeToken(token, expectedUserId, expectedEventId) {
  const secret = process.env.CRON_SECRET
  if (!secret || !token) return false
  const [payload, sig] = String(token).split('.')
  if (!payload || !sig) return false
  let decoded
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  if (decoded.u !== expectedUserId || decoded.e !== expectedEventId) return false
  if (typeof decoded.exp !== 'number' || decoded.exp < Date.now()) return false
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const { eventId, minutes = 10, snoozeToken } = req.body || {}
  if (!eventId) return res.status(400).json({ error: 'missing_eventId' })

  // Prefer Bearer JWT when disponible (cliente web). Fallback al token HMAC
  // del SW, que sí puede obtenerlo del payload del push.
  let userId = await getUserIdFromAuth(req)
  if (!userId && snoozeToken) {
    try {
      const [payload] = String(snoozeToken).split('.')
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      if (verifySnoozeToken(snoozeToken, decoded.u, eventId)) {
        userId = decoded.u
      }
    } catch {
      // fallthrough
    }
  }
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  try {
    await admin.from('sent_notifications')
      .update({ sent_at: snoozeUntil })
      .eq('event_id', eventId)
      .eq('user_id', userId)
    return res.status(200).json({ ok: true, snoozeUntil })
  } catch (err) {
    return res.status(500).json({ error: 'internal' })
  }
}

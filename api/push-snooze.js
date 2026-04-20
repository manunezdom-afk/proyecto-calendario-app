// POST /api/push-snooze
// Marca que un recordatorio debe re-enviarse en N minutos más.
// Se llama desde el SW cuando el usuario toca "Posponer 10 min".
//
// Auth: token HMAC firmado que el cron embebe en el push payload.
// El SW devuelve ese token tal cual en body.snoozeToken. El token
// contiene {user_id, event_id, exp}; acá verificamos la firma y
// filtramos el UPDATE por ambos campos.
// Esto reemplaza el endpoint sin auth que permitía a cualquiera con
// un eventId silenciar notifs de otros usuarios (fix de auditoría).

import { getSupabaseAdmin } from './_supabaseAdmin.js'
import { verifySnoozeToken } from './_shared/snoozeToken.mjs'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const { snoozeToken, minutes = 10 } = req.body || {}
  if (!snoozeToken) return res.status(401).json({ error: 'missing_token' })

  const claims = verifySnoozeToken(snoozeToken)
  if (!claims) return res.status(401).json({ error: 'invalid_or_expired_token' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  try {
    // Doble filtro: user_id + event_id vienen del token firmado, no del body.
    // Un atacante no puede cambiarlos sin invalidar la firma HMAC.
    await admin.from('sent_notifications')
      .update({ sent_at: snoozeUntil })
      .eq('user_id', claims.userId)
      .eq('event_id', claims.eventId)
    return res.status(200).json({ ok: true, snoozeUntil })
  } catch (err) {
    console.warn('[push-snooze] update failed', err?.message)
    return res.status(500).json({ error: 'internal' })
  }
}

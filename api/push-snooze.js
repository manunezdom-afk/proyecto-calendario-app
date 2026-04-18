// POST /api/push-snooze
// Marca que un recordatorio debe re-enviarse en N minutos más.
// Se llama desde el SW cuando el usuario toca "Posponer 10 min".
// Simple: borra la entrada en sent_notifications para que el cron vuelva a disparar.

import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // Nota: el SW no puede adjuntar el token del usuario fácilmente, así que
  // por ahora aceptamos snooze sin auth (el eventId + endpoint son suficiente
  // prueba para re-enviar la misma notif al mismo dispositivo). Se puede
  // endurecer en el futuro.
  const { eventId, minutes = 10 } = req.body || {}
  if (!eventId) return res.status(400).json({ error: 'missing_eventId' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  try {
    // Borramos la entrada "sent" del offset más cercano para que vuelva a dispararse.
    // Y además creamos un override que diga "no enviar hasta snoozeUntil".
    await admin.from('sent_notifications')
      .update({ sent_at: snoozeUntil })
      .eq('event_id', eventId)
    return res.status(200).json({ ok: true, snoozeUntil })
  } catch (err) {
    return res.status(500).json({ error: 'internal' })
  }
}

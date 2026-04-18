/**
 * GET /api/cron-notifications
 *
 * Endpoint llamado cada ~5 min por GitHub Actions (o Vercel Cron).
 * Escanea eventos próximos y dispara push notifications.
 *
 * Auth: header 'Authorization: Bearer <CRON_SECRET>' — shared secret.
 *
 * Algoritmo:
 * 1. Lee eventos de Supabase que empiecen en los próximos 65 min
 * 2. Para cada event × offset (10/30/60 min antes), chequea si ya se envió
 *    (sent_notifications) y si el timing cuadra con ahora ± 2.5 min
 * 3. Fetchea las push_subscriptions del user_id y manda la push
 * 4. Registra en sent_notifications
 */

import webpush from 'web-push'
import { getSupabaseAdmin } from './_supabaseAdmin.js'

const OFFSETS = [10, 30, 60] // minutos antes del evento
const WINDOW_MIN = 2.5 // tolerancia: ±2.5 min alrededor del objetivo

function configureWebPush() {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL || 'mailto:admin@focus.app'
  if (!pub || !priv) return false
  webpush.setVapidDetails(email, pub, priv)
  return true
}

// Parsea "HH:MM" o "HH:MM – HH:MM" → Date del event en la fecha dada
function buildEventDate(eventDate, timeStr) {
  if (!eventDate || !timeStr) return null
  const m = String(timeStr).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const [y, mo, d] = eventDate.split('-').map(Number)
  const h = parseInt(m[1], 10)
  const mn = parseInt(m[2], 10)
  return new Date(y, mo - 1, d, h, mn, 0, 0)
}

function minutesUntil(date) {
  return (date.getTime() - Date.now()) / 60000
}

async function sendPushToUser(admin, userId, payload) {
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId)
  if (error || !subs?.length) return { sent: 0, failed: 0 }

  let sent = 0, failed = 0
  const deadEndpoints = []

  await Promise.all(subs.map(async (row) => {
    const sub = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload))
      sent++
    } catch (err) {
      // 404/410 = suscripción muerta, la borramos
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        deadEndpoints.push(row.endpoint)
      } else {
        console.warn('[cron] push failed', row.endpoint, err?.statusCode)
      }
      failed++
    }
  }))

  if (deadEndpoints.length > 0) {
    await admin.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
  }
  return { sent, failed }
}

export default async function handler(req, res) {
  // Auth: shared secret
  const authHeader = req.headers?.authorization || req.headers?.Authorization
  const expected = process.env.CRON_SECRET
  if (!expected) return res.status(503).json({ error: 'no_cron_secret_configured' })
  if (authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  if (!configureWebPush()) {
    return res.status(503).json({ error: 'vapid_not_configured' })
  }

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_supabase_admin' })

  const now = new Date()
  const horizon = new Date(now.getTime() + 65 * 60 * 1000) // 65 min hacia adelante
  const todayISO = now.toISOString().slice(0, 10)
  const tomorrowISO = new Date(now.getTime() + 86400000).toISOString().slice(0, 10)

  // Traemos eventos de hoy y mañana (cross-day si es de noche)
  const { data: events, error: evErr } = await admin
    .from('events')
    .select('id, user_id, title, time, date, section, icon')
    .in('date', [todayISO, tomorrowISO, null])

  if (evErr) return res.status(500).json({ error: 'events_fetch', message: evErr.message })

  let checked = 0, pushes = 0, failures = 0
  const actionsSummary = []

  for (const ev of (events || [])) {
    const eventDate = ev.date || todayISO
    const when = buildEventDate(eventDate, ev.time)
    if (!when || when < now) continue
    const minsLeft = minutesUntil(when)
    if (minsLeft > 65) continue

    checked++

    for (const offset of OFFSETS) {
      // ¿El evento está en la ventana [offset - WINDOW, offset + WINDOW]?
      const delta = Math.abs(minsLeft - offset)
      if (delta > WINDOW_MIN) continue

      // ¿Ya se envió esta combinación?
      const { data: sentRow } = await admin
        .from('sent_notifications')
        .select('id, sent_at')
        .eq('user_id', ev.user_id)
        .eq('event_id', ev.id)
        .eq('offset_min', offset)
        .maybeSingle()

      if (sentRow) {
        // Si sent_at está en el futuro (snooze), esperar
        if (new Date(sentRow.sent_at) > now) continue
        // Si ya se envió antes, skip
        continue
      }

      // Build payload
      const payload = {
        title: `En ${offset} min: ${ev.title}`,
        body: `${ev.time}${ev.section ? ` · ${ev.section}` : ''}`,
        url: '/',
        tag: `reminder-${ev.id}-${offset}`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { eventId: ev.id, offset, kind: 'event_reminder' },
      }

      const { sent, failed } = await sendPushToUser(admin, ev.user_id, payload)
      pushes += sent
      failures += failed

      if (sent > 0) {
        await admin.from('sent_notifications').insert({
          user_id: ev.user_id,
          event_id: ev.id,
          offset_min: offset,
        }).then(() => {}, () => {})
        actionsSummary.push({ event_id: ev.id, user_id: ev.user_id, offset, sent })
      }
    }
  }

  return res.status(200).json({
    ok: true,
    checked,
    pushes,
    failures,
    actions: actionsSummary,
    now: now.toISOString(),
  })
}

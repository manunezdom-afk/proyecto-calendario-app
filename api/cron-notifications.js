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

// Parsea "HH:MM" o "HH:MM – HH:MM" en la timezone del usuario → Date absoluta.
// timezone: IANA string (ej. "America/Santiago"). Si no se pasa, asume UTC.
function buildEventDate(eventDate, timeStr, timezone = 'UTC') {
  if (!eventDate || !timeStr) return null
  const m = String(timeStr).match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i)
  if (!m) return null
  const [y, mo, d] = eventDate.split('-').map(Number)
  let h = parseInt(m[1], 10)
  const mn = parseInt(m[2] ?? '0', 10)
  const ap = m[3]?.toUpperCase()
  if (Number.isNaN(h) || Number.isNaN(mn)) return null
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return null
  // Calculamos el timestamp UTC que corresponde a esa hora local en la zona del usuario.
  // Estrategia: construir un Date como si fuera UTC, luego ajustar por el offset de la tz.
  const asUtc = Date.UTC(y, mo - 1, d, h, mn, 0, 0)
  try {
    // Queremos saber qué hora local es ese instante en la tz del usuario, y medir la diferencia.
    const localStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(asUtc))
    const parts = Object.fromEntries(localStr.filter(p => p.type !== 'literal').map(p => [p.type, p.value]))
    const localH = parseInt(parts.hour, 10) === 24 ? 0 : parseInt(parts.hour, 10)
    const localM = parseInt(parts.minute, 10)
    // offset en minutos: (hora local - hora UTC) módulo 1440
    const utcTotal = h * 60 + mn
    const localTotal = localH * 60 + localM
    let deltaMin = localTotal - utcTotal
    if (deltaMin > 720) deltaMin -= 1440
    if (deltaMin < -720) deltaMin += 1440
    return new Date(asUtc - deltaMin * 60000)
  } catch {
    return new Date(asUtc)
  }
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
      await webpush.sendNotification(sub, JSON.stringify(payload), {
        TTL: 3600,
        urgency: 'high',
        contentEncoding: 'aes128gcm',
      })
      sent++
    } catch (err) {
      // 404/410 = suscripción muerta, la borramos
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        deadEndpoints.push(row.endpoint)
      } else {
        console.warn('[cron] push failed', row.endpoint, err?.statusCode, err?.body)
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
  const yesterdayISO = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
  const tomorrowISO = new Date(now.getTime() + 86400000).toISOString().slice(0, 10)

  // Traemos eventos del rango [ayer, hoy, mañana] para cubrir cruces de medianoche
  // en distintas zonas horarias.
  const { data: events, error: evErr } = await admin
    .from('events')
    .select('id, user_id, title, time, date, section, icon')
    .in('date', [yesterdayISO, todayISO, tomorrowISO])

  if (evErr) return res.status(500).json({ error: 'events_fetch', message: evErr.message })

  // Cachear timezones por user_id (evita queries repetidas)
  const userTzCache = new Map()
  async function getUserTz(userId) {
    if (userTzCache.has(userId)) return userTzCache.get(userId)
    const { data } = await admin
      .from('user_profiles').select('timezone').eq('id', userId).maybeSingle()
    const tz = data?.timezone || 'UTC'
    userTzCache.set(userId, tz)
    return tz
  }

  let checked = 0, pushes = 0, failures = 0
  const actionsSummary = []

  for (const ev of (events || [])) {
    const eventDate = ev.date || todayISO
    const tz = await getUserTz(ev.user_id)
    const when = buildEventDate(eventDate, ev.time, tz)
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
        // Upsert para evitar condiciones de carrera si el cron corre dos veces simultáneamente.
        // Requiere unique constraint (user_id, event_id, offset_min) en sent_notifications.
        await admin.from('sent_notifications').upsert({
          user_id: ev.user_id,
          event_id: ev.id,
          offset_min: offset,
          sent_at: new Date().toISOString(),
        }, { onConflict: 'user_id,event_id,offset_min' }).then(() => {}, () => {})
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

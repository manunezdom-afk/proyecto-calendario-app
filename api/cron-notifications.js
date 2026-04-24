/**
 * GET /api/cron-notifications
 *
 * Endpoint llamado cada ~5 min por GitHub Actions (o Vercel Cron).
 * Escanea eventos próximos y dispara push notifications.
 *
 * Auth: header 'Authorization: Bearer <CRON_SECRET>' — shared secret.
 *
 * Algoritmo:
 * 1. Lee eventos de Supabase que puedan tener recordatorios próximos
 * 2. Para cada event × reminder_offset, chequea si ya se envió
 * 3. Reserva la combinación en sent_notifications para evitar carreras
 * 4. Envía la push, registra telemetría y guarda el copy enviado
 */

import webpush from 'web-push'
import { getSupabaseAdmin } from './_supabaseAdmin.js'
import {
  DEFAULT_REMINDER_OFFSETS,
  buildSmartNotificationPayload,
  maxLateMinutesForOffset,
  normalizeReminderOffsets,
} from '../src/utils/smartNotifications.js'

function configureWebPush() {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL || 'mailto:admin@focus.app'
  if (!pub || !priv) return false
  webpush.setVapidDetails(email, pub, priv)
  return true
}

// Parsea "HH:MM" o "HH:MM – HH:MM" en la timezone del usuario -> Date absoluta.
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

  const asUtc = Date.UTC(y, mo - 1, d, h, mn, 0, 0)
  try {
    const localStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(asUtc))
    const parts = Object.fromEntries(
      localStr.filter(p => p.type !== 'literal').map(p => [p.type, p.value]),
    )
    const localH = parseInt(parts.hour, 10) === 24 ? 0 : parseInt(parts.hour, 10)
    const localM = parseInt(parts.minute, 10)
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

async function sendPushToUser(admin, userId, payload, logCtx = null) {
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId)
  if (error || !subs?.length) return { sent: 0, failed: 0 }

  let sent = 0
  let failed = 0
  const deadEndpoints = []
  const deliveryRows = []

  await Promise.all(subs.map(async (row) => {
    const sub = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }
    const startedAt = Date.now()
    let status = 'delivered'
    let statusCode = null
    let errorMessage = null

    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), {
        TTL: 3600,
        urgency: 'high',
        contentEncoding: 'aes128gcm',
      })
      sent++
    } catch (err) {
      failed++
      statusCode = err?.statusCode ?? null
      errorMessage = (err?.body?.toString?.() || err?.message || '').slice(0, 300)
      if (statusCode === 404 || statusCode === 410) {
        deadEndpoints.push(row.endpoint)
        status = 'gone'
      } else {
        status = 'failed'
        console.warn('[cron] push failed', row.endpoint, statusCode, errorMessage)
      }
    }

    if (logCtx) {
      deliveryRows.push({
        user_id: userId,
        event_id: logCtx.eventId ?? null,
        offset_min: logCtx.offset ?? null,
        endpoint: row.endpoint,
        status,
        status_code: statusCode,
        error: errorMessage,
        payload_title: payload.title?.slice(0, 200) ?? null,
        duration_ms: Date.now() - startedAt,
        sent_at: new Date().toISOString(),
      })
    }
  }))

  if (deadEndpoints.length > 0) {
    await admin.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
  }

  // Tabla opcional: si la migración no existe, no rompemos el cron.
  if (deliveryRows.length > 0) {
    admin.from('notification_deliveries').insert(deliveryRows).then(() => {}, () => {})
  }

  return { sent, failed }
}

async function recordSentNotification(admin, row) {
  const extended = {
    user_id: row.user_id,
    event_id: row.event_id,
    offset_min: row.offset_min,
    sent_at: row.sent_at,
    kind: row.kind,
    title: row.title,
    body: row.body,
    payload: row.payload,
  }

  const base = {
    user_id: row.user_id,
    event_id: row.event_id,
    offset_min: row.offset_min,
    sent_at: row.sent_at,
  }

  const options = { onConflict: 'user_id,event_id,offset_min' }
  const { error } = await admin.from('sent_notifications').upsert(extended, options)
  if (!error) return

  // Compatibilidad con proyectos que aún no aplicaron la migración de metadata.
  if (/kind|title|body|payload/i.test(error.message || '')) {
    await admin.from('sent_notifications').upsert(base, options).then(() => {}, () => {})
    return
  }

  console.warn('[cron] sent_notifications upsert failed', error.message)
}

export default async function handler(req, res) {
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
  const todayISO = now.toISOString().slice(0, 10)
  const yesterdayISO = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
  const tomorrowISO = new Date(now.getTime() + 86400000).toISOString().slice(0, 10)
  const dayAfterTomorrowISO = new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10)

  const { data: events, error: evErr } = await admin
    .from('events')
    .select('id, user_id, title, time, date, section, icon, description, reminder_offsets, timezone')
    .in('date', [yesterdayISO, todayISO, tomorrowISO, dayAfterTomorrowISO])

  if (evErr) return res.status(500).json({ error: 'events_fetch', message: evErr.message })

  const userTzCache = new Map()
  async function getUserTz(userId) {
    if (userTzCache.has(userId)) return userTzCache.get(userId)
    const { data } = await admin
      .from('user_profiles').select('timezone').eq('id', userId).maybeSingle()
    const tz = data?.timezone || 'UTC'
    userTzCache.set(userId, tz)
    return tz
  }

  let checked = 0
  let pushes = 0
  let failures = 0
  const actionsSummary = []

  for (const ev of (events || [])) {
    const eventDate = ev.date || todayISO
    const tz = ev.timezone || (await getUserTz(ev.user_id))
    const when = buildEventDate(eventDate, ev.time, tz)
    if (!when) continue

    const minsLeft = minutesUntil(when)
    const offsets = normalizeReminderOffsets(ev.reminder_offsets, DEFAULT_REMINDER_OFFSETS)
    if (offsets.length === 0) continue
    if (minsLeft > Math.max(...offsets)) continue

    checked++

    const { data: sentRows } = await admin
      .from('sent_notifications')
      .select('offset_min, sent_at')
      .eq('user_id', ev.user_id)
      .eq('event_id', ev.id)
    const sentByOffset = new Map((sentRows || []).map(r => [r.offset_min, r.sent_at]))

    for (const offset of offsets) {
      const maxLate = maxLateMinutesForOffset(offset)
      if (minsLeft > offset) continue
      if (minsLeft < offset - maxLate) continue

      const existingSentAt = sentByOffset.get(offset)
      if (existingSentAt) {
        if (new Date(existingSentAt) > now) continue
        continue
      }

      const leaseRes = await admin
        .from('sent_notifications')
        .insert({
          user_id: ev.user_id,
          event_id: ev.id,
          offset_min: offset,
          sent_at: new Date().toISOString(),
        })
      if (leaseRes.error) continue

      const payload = buildSmartNotificationPayload(ev, {
        offset,
        minsLeft,
        startsAt: when,
      })

      const { sent, failed } = await sendPushToUser(admin, ev.user_id, payload, {
        eventId: ev.id,
        offset,
      })
      pushes += sent
      failures += failed

      if (sent === 0) {
        await admin.from('sent_notifications')
          .delete()
          .eq('user_id', ev.user_id)
          .eq('event_id', ev.id)
          .eq('offset_min', offset)
          .then(() => {}, () => {})
        continue
      }

      await recordSentNotification(admin, {
        user_id: ev.user_id,
        event_id: ev.id,
        offset_min: offset,
        sent_at: new Date().toISOString(),
        kind: payload.data?.kind || 'event_reminder',
        title: payload.title,
        body: payload.body,
        payload,
      })

      actionsSummary.push({
        event_id: ev.id,
        user_id: ev.user_id,
        offset,
        kind: payload.data?.kind,
        title: payload.title,
        sent,
      })
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

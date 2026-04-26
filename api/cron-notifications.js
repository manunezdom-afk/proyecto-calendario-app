/**
 * GET /api/cron-notifications
 *
 * Endpoint llamado cada ~5 min por GitHub Actions.
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
import { getApnsConfig, sendApnsNotification } from './_lib/apns.js'
import { getSupabaseAdmin } from './_supabaseAdmin.js'
import {
  DEFAULT_REMINDER_OFFSETS,
  buildSmartNotificationPayload,
  classifyMoment,
  maxLateMinutesForOffset,
  normalizeReminderOffsets,
} from '../src/utils/smartNotifications.js'
import { pickSubjectForEvent } from '../src/utils/memoryInjection.js'

// Devuelve la hora local (0..23) del usuario dadas su timezone IANA y una
// fecha de referencia. Usado para decidir si un push cae dentro de su
// ventana de "no molestar".
function getLocalHour(date, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const h = parts.find((p) => p.type === 'hour')?.value
    const n = parseInt(h, 10)
    return Number.isFinite(n) ? (n === 24 ? 0 : n) : null
  } catch {
    return null
  }
}

// Quiet hours por usuario. Si start > end, la ventana cruza medianoche
// (ej. 22→7 cubre [22..23] ∪ [0..6]). Null/Null = no molestar desactivado.
function isWithinQuietHours(hour, start, end) {
  if (hour == null) return false
  if (start == null || end == null) return false
  if (start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

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

async function sendPushToUser(admin, userId, payload, logCtx = null, options = {}) {
  const webPushConfigured = options.webPushConfigured !== false
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
      if (!webPushConfigured) throw new Error('vapid_not_configured')
      const ttl = Math.max(60, Math.min(Number(payload.ttl) || 3600, 24 * 60 * 60))
      const urgency = ['very-low', 'low', 'normal', 'high'].includes(payload.urgency)
        ? payload.urgency
        : 'normal'
      await webpush.sendNotification(sub, JSON.stringify(payload), {
        TTL: ttl,
        urgency,
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

async function sendNativePushToUser(admin, userId, payload, logCtx = null, apnsConfig = getApnsConfig()) {
  const { data: tokens, error } = await admin
    .from('native_push_tokens')
    .select('token, bundle_id, environment')
    .eq('user_id', userId)
  if (error || !tokens?.length) return { sent: 0, failed: 0 }

  let sent = 0
  let failed = 0
  const deadTokens = []
  const deliveryRows = []

  await Promise.all(tokens.map(async (row) => {
    const startedAt = Date.now()
    let status = 'delivered'
    let statusCode = null
    let errorMessage = null

    try {
      if (!apnsConfig?.configured) throw new Error('apns_not_configured')
      const result = await sendApnsNotification({
        token: row.token,
        payload,
        config: {
          ...apnsConfig,
          bundleId: row.bundle_id || apnsConfig.bundleId,
          environment: row.environment || apnsConfig.environment,
        },
      })
      statusCode = result.statusCode ?? null
      if (result.ok) {
        sent++
      } else {
        failed++
        errorMessage = String(result.error || '').slice(0, 300)
        if (statusCode === 410 || /Unregistered|BadDeviceToken/i.test(errorMessage)) {
          deadTokens.push(row.token)
          status = 'gone'
        } else {
          status = 'failed'
          console.warn('[cron] apns push failed', row.token.slice(0, 8), statusCode, errorMessage)
        }
      }
    } catch (err) {
      failed++
      errorMessage = String(err?.message || err).slice(0, 300)
      status = 'failed'
      console.warn('[cron] apns push failed', row.token.slice(0, 8), statusCode, errorMessage)
    }

    if (logCtx) {
      deliveryRows.push({
        user_id: userId,
        event_id: logCtx.eventId ?? null,
        offset_min: logCtx.offset ?? null,
        endpoint: `apns:${row.token.slice(0, 32)}`,
        status,
        status_code: statusCode,
        error: errorMessage,
        payload_title: payload.title?.slice(0, 200) ?? null,
        duration_ms: Date.now() - startedAt,
        sent_at: new Date().toISOString(),
      })
    }
  }))

  if (deadTokens.length > 0) {
    await admin.from('native_push_tokens').delete().in('token', deadTokens)
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

  const webPushConfigured = configureWebPush()
  const apnsConfig = getApnsConfig()
  if (!webPushConfigured && !apnsConfig.configured) {
    return res.status(503).json({ error: 'push_not_configured' })
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

  // Cachea el perfil completo por user_id para esta corrida del cron. Con
  // esto leemos timezone, personalidad y quiet hours en una sola query y no
  // machacamos Supabase cuando el mismo usuario tiene múltiples eventos.
  const userProfileCache = new Map()
  async function getUserProfile(userId) {
    if (userProfileCache.has(userId)) return userProfileCache.get(userId)
    const { data } = await admin
      .from('user_profiles')
      .select('timezone, nova_personality, quiet_start, quiet_end')
      .eq('id', userId)
      .maybeSingle()
    const profile = {
      timezone: data?.timezone || 'UTC',
      personality: data?.nova_personality || 'focus',
      quietStart: Number.isInteger(data?.quiet_start) ? data.quiet_start : null,
      quietEnd: Number.isInteger(data?.quiet_end) ? data.quiet_end : null,
    }
    userProfileCache.set(userId, profile)
    return profile
  }

  // Memorias por usuario (mismo espíritu: una sola query por cron run). Si
  // la tabla está vacía o la fetcheada falla, devolvemos un array vacío y
  // pickSubjectForEvent sencillamente no inyecta nada.
  const userMemoriesCache = new Map()
  async function getUserMemories(userId) {
    if (userMemoriesCache.has(userId)) return userMemoriesCache.get(userId)
    try {
      const { data } = await admin
        .from('user_memories')
        .select('category, subject, content')
        .eq('user_id', userId)
      const memories = Array.isArray(data) ? data : []
      userMemoriesCache.set(userId, memories)
      return memories
    } catch {
      userMemoriesCache.set(userId, [])
      return []
    }
  }

  let checked = 0
  let pushes = 0
  let failures = 0
  const actionsSummary = []

  let quietSkipped = 0

  for (const ev of (events || [])) {
    const eventDate = ev.date || todayISO
    const profile = await getUserProfile(ev.user_id)
    const tz = ev.timezone || profile.timezone
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

      // Quiet hours del usuario. Si la hora local actual cae dentro de la
      // ventana de "no molestar", skippeamos — excepto cuando el evento ya
      // es inminente (imminent/late), porque avisar de algo que empieza
      // ahora vale más que respetar el silencio.
      const moment = classifyMoment(minsLeft)
      const localHour = getLocalHour(now, tz)
      const inQuiet = isWithinQuietHours(localHour, profile.quietStart, profile.quietEnd)
      const canOverrideQuiet = moment === 'imminent' || moment === 'late'
      if (inQuiet && !canOverrideQuiet) {
        quietSkipped += 1
        // Liberamos el lease: si más tarde, fuera del horario silencioso,
        // el evento todavía cae en maxLate para este offset, el próximo
        // cron reintenta.
        await admin.from('sent_notifications')
          .delete()
          .eq('user_id', ev.user_id)
          .eq('event_id', ev.id)
          .eq('offset_min', offset)
          .then(() => {}, () => {})
        continue
      }

      const memories = await getUserMemories(ev.user_id)
      const subject = pickSubjectForEvent(ev, memories)

      const payload = buildSmartNotificationPayload(ev, {
        offset,
        minsLeft,
        startsAt: when,
        personality: profile.personality,
        subject,
      })

      const webResult = await sendPushToUser(admin, ev.user_id, payload, {
        eventId: ev.id,
        offset,
      }, { webPushConfigured })
      const nativeResult = await sendNativePushToUser(admin, ev.user_id, payload, {
        eventId: ev.id,
        offset,
      }, apnsConfig)
      const sent = webResult.sent + nativeResult.sent
      const failed = webResult.failed + nativeResult.failed
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
        web_sent: webResult.sent,
        native_sent: nativeResult.sent,
      })
    }
  }

  return res.status(200).json({
    ok: true,
    checked,
    pushes,
    failures,
    quiet_skipped: quietSkipped,
    actions: actionsSummary,
    now: now.toISOString(),
  })
}

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

const DEFAULT_OFFSETS = [10, 30, 60] // usado cuando event.reminder_offsets = null
// Hasta cuántos minutos TARDE puede dispararse un recordatorio después de su
// momento ideal. Antes era ±2.5 min, pero el scheduler (GitHub Actions schedule
// o Vercel Hobby) puede atrasarse hasta varias horas. Ampliamos la ventana
// para offsets chicos especialmente, porque "en 10 min" tarde es mejor que
// silencio — el usuario prefiere recibir algo antes del evento aunque no sean
// exactamente 10. La función fallbackMaxLate() acota por proporción del
// offset para evitar que "en 60 min" se dispare con el evento ya encima.
function maxLateFor(offset) {
  if (offset <= 10) return 9                   // 9/10 — hasta 1 min antes
  if (offset <= 30) return 20                  // 2/3
  if (offset <= 60) return 35                  // ~60%
  return Math.max(40, Math.round(offset * 0.5)) // offsets largos: mitad
}

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

async function sendPushToUser(admin, userId, payload, logCtx = null) {
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId)
  if (error || !subs?.length) return { sent: 0, failed: 0 }

  let sent = 0, failed = 0
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

  // Telemetría: tabla notification_deliveries (opcional — si no existe, el
  // error se silencia para no romper el cron).
  if (deliveryRows.length > 0) {
    admin.from('notification_deliveries').insert(deliveryRows).then(() => {}, () => {})
  }

  return { sent, failed }
}

// Detección de tipo basada en el título. El modelo de datos no guarda un
// flag explícito: todos los items viven en la tabla `events`, pero por
// convención de cómo Nova / el usuario los crea, un recordatorio se
// distingue por llevar la palabra "recordatorio" en el título ("Recordatorio:
// pagar luz", "Clase — recordatorio 10 min"), o por arrancar con un verbo
// imperativo corto. Si no matchea, asumimos evento agendado.
function detectKind(ev) {
  const t = String(ev?.title || '').trim()
  if (!t) return 'event'
  if (/^recordatorio\s*:/i.test(t)) return 'reminder'
  if (/(?:—|-)\s*recordatorio\b/i.test(t)) return 'reminder'
  if (/\brecordatorio\b/i.test(t)) return 'reminder'
  if (/^(recordar|recuerda|revisar|enviar|llamar|pagar|comprar|confirmar|agendar)\b/i.test(t)) return 'reminder'
  return 'event'
}

// Armado del payload por tipo. Cada tipo usa icono, cuerpo, acciones y
// copy distintos: un EVENTO muestra el título tal cual (es un compromiso
// agendado con hora), mientras que un RECORDATORIO antepone un prefijo
// "Recordatorio · " y reemplaza el lead temporal por un "Ahora"/"En X min"
// más simple — el valor del recordatorio es que aparece en el momento,
// no saber "cuánto falta". El SW tiene defaults por kind por si el payload
// llegara sin icon/actions, así podemos iterar el formato sin redeploy
// del SW.
function buildPayload(minsLeft, ev, offset) {
  const kind = detectKind(ev)
  const m = Math.max(0, Math.round(minsLeft))

  if (kind === 'reminder') {
    const clean = String(ev.title || '')
      .replace(/^recordatorio\s*:\s*/i, '')
      .replace(/\s*(?:—|-)\s*recordatorio\b.*$/i, '')
      .trim() || 'Recordatorio'
    const when = m <= 1 ? 'Ahora' : `En ${m} min`
    return {
      title: `Recordatorio · ${clean}`,
      body: when,
      url: '/',
      tag: `reminder-${ev.id}-${offset}`,
      icon: '/icons/notif-reminder.svg',
      badge: '/icons/notif-reminder.svg',
      actions: [
        { action: 'done',   title: 'Listo' },
        { action: 'snooze', title: 'Luego' },
      ],
      data: { eventId: ev.id, offset, kind: 'reminder' },
    }
  }

  // Evento agendado: el valor es el lead contextual.
  let lead
  if (m <= 1) lead = 'Empieza ahora'
  else if (m <= 15) lead = `En ${m} min`
  else if (m <= 35) lead = 'En media hora'
  else if (m <= 75) lead = 'Dentro de una hora'
  else lead = `En ${m} min`

  const bodyParts = []
  if (ev.time) bodyParts.push(ev.time)
  bodyParts.push(lead)

  return {
    title: ev.title || 'Evento',
    body: bodyParts.join(' · '),
    url: '/',
    tag: `reminder-${ev.id}-${offset}`,
    icon: '/icons/notif-event.svg',
    badge: '/icons/notif-event.svg',
    actions: [
      { action: 'open',   title: 'Abrir' },
      { action: 'snooze', title: 'Posponer 10 min' },
    ],
    data: { eventId: ev.id, offset, kind: 'event' },
  }
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
    .select('id, user_id, title, time, date, section, icon, reminder_offsets')
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
    if (minsLeft > 75) continue

    // Respetar reminder_offsets del evento:
    //   · null/undefined → usar defaults [10, 30, 60]
    //   · []             → el usuario silenció recordatorios, skip total
    //   · array          → usar tal cual (solo offsets en rango 1..1440)
    const raw = ev.reminder_offsets
    let offsets
    if (!Array.isArray(raw)) offsets = DEFAULT_OFFSETS
    else if (raw.length === 0) continue
    else offsets = raw.filter((x) => Number.isFinite(x) && x >= 1 && x <= 1440)
    if (offsets.length === 0) continue

    checked++

    // RACE: antes de disparar, idempotency via upsert con pre-check.
    // Primero levantamos todos los sent_rows de este evento para minimizar
    // queries.
    const { data: sentRows } = await admin
      .from('sent_notifications')
      .select('offset_min, sent_at')
      .eq('user_id', ev.user_id)
      .eq('event_id', ev.id)
    const sentByOffset = new Map((sentRows || []).map(r => [r.offset_min, r.sent_at]))

    for (const offset of offsets) {
      const maxLate = maxLateFor(offset)
      if (minsLeft > offset) continue
      if (minsLeft < offset - maxLate) continue

      const existingSentAt = sentByOffset.get(offset)
      if (existingSentAt) {
        if (new Date(existingSentAt) > now) continue // snoozed
        continue                                      // already sent
      }

      // Lease preventivo — insert con onConflict: no-op para cubrir la race
      // en la que dos corridas simultáneas del cron lean la misma ausencia.
      // Si falla el insert (constraint violation), otra corrida ganó y
      // skipeamos.
      const leaseRes = await admin
        .from('sent_notifications')
        .insert({
          user_id: ev.user_id,
          event_id: ev.id,
          offset_min: offset,
          sent_at: new Date().toISOString(),
        })
      if (leaseRes.error) {
        // Conflict (otro cron ya reservó) o error real. En ambos casos
        // skipeamos; la otra corrida enviará la notif.
        continue
      }

      const payload = buildPayload(minsLeft, ev, offset)

      const { sent, failed } = await sendPushToUser(admin, ev.user_id, payload, {
        eventId: ev.id,
        offset,
      })
      pushes += sent
      failures += failed

      if (sent === 0) {
        // Todas las subs fallaron — liberar el lease para que un cron futuro
        // pueda reintentar (por ejemplo si era un error 5xx temporal).
        await admin.from('sent_notifications')
          .delete()
          .eq('user_id', ev.user_id)
          .eq('event_id', ev.id)
          .eq('offset_min', offset)
          .then(() => {}, () => {})
      } else {
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

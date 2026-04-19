/**
 * GET /api/ics-feed?token=xxx
 *
 * Endpoint público (sin auth por header — los calendar clients no mandan JWT)
 * que devuelve el calendario del usuario en formato ICS.
 *
 * El token se genera al crear el feed y se guarda en calendar_feeds.
 * Cualquiera con el token puede ver el calendario (por eso tiene que ser largo
 * y random — lo generamos con crypto). El usuario puede revocar un token
 * regenerándolo en la UI.
 *
 * Calendar apps (Google, Apple, Outlook) consultan este URL periódicamente
 * (típicamente cada 1-24h) y muestran los eventos actualizados sin que el
 * usuario tenga que re-exportar nada.
 */

import { getSupabaseAdmin } from './_supabaseAdmin.js'

const pad = (n) => String(n).padStart(2, '0')

function fmtDTZ(d) {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
  )
}

function escapeICS(s) {
  if (!s) return ''
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function foldLine(line) {
  // RFC 5545: líneas máximo 75 bytes, continuación con \n\t
  if (line.length <= 75) return line
  const chunks = []
  for (let i = 0; i < line.length; i += 73) chunks.push(line.slice(i, i + 73))
  return chunks.join('\r\n\t')
}

// Parsea "HH:MM" o "HH:MM – HH:MM" del evento en una fecha dada
function buildEventDates(eventDate, timeStr) {
  if (!timeStr) return null
  const [startStr, endStr] = String(timeStr).split(/[–-]/).map(s => s.trim())
  const mStart = startStr?.match(/^(\d{1,2}):(\d{2})/)
  if (!mStart) return null

  const [y, mo, d] = eventDate.split('-').map(Number)
  const startH = parseInt(mStart[1], 10)
  const startM = parseInt(mStart[2], 10)
  const start = new Date(y, mo - 1, d, startH, startM, 0, 0)

  let end
  const mEnd = endStr?.match(/^(\d{1,2}):(\d{2})/)
  if (mEnd) {
    const endH = parseInt(mEnd[1], 10)
    const endM = parseInt(mEnd[2], 10)
    end = new Date(y, mo - 1, d, endH, endM, 0, 0)
  } else {
    end = new Date(start.getTime() + 60 * 60 * 1000) // default 1h
  }
  return { start, end }
}

function buildICS(events, feedLabel = 'Focus') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Focus App//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(feedLabel)}`,
    'X-WR-TIMEZONE:UTC',
  ]

  for (const ev of events) {
    const eventDate = ev.date || new Date().toISOString().slice(0, 10)
    const dates = buildEventDates(eventDate, ev.time)
    if (!dates) continue

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${ev.id}@focus.app`)
    lines.push(`DTSTAMP:${fmtDTZ(new Date())}`)
    lines.push(`DTSTART:${fmtDTZ(dates.start)}`)
    lines.push(`DTEND:${fmtDTZ(dates.end)}`)
    lines.push(foldLine(`SUMMARY:${escapeICS(ev.title)}`))
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeICS(ev.description)}`))
    if (ev.section) lines.push(`CATEGORIES:${escapeICS(ev.section)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export default async function handler(req, res) {
  // CORS permissive — necesario para que Google/Apple Calendar puedan leer
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).end()

  const token = req.query?.token
  if (!token || typeof token !== 'string' || token.length < 20) {
    return res.status(400).json({ error: 'invalid_token' })
  }

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend' })

  // Lookup del feed por token
  const { data: feed, error: feedErr } = await admin
    .from('calendar_feeds')
    .select('user_id, label, filter')
    .eq('token', token)
    .maybeSingle()

  if (feedErr || !feed) return res.status(404).json({ error: 'feed_not_found' })

  const filter = feed.filter || {}

  // Fetch eventos del usuario con filtros opcionales
  let q = admin.from('events').select('*').eq('user_id', feed.user_id)
  if (filter.section) q = q.eq('section', filter.section)
  if (filter.after)   q = q.gte('date', filter.after)
  if (filter.before)  q = q.lte('date', filter.before)

  const { data: events, error: evErr } = await q
  if (evErr) return res.status(500).json({ error: 'events_fetch' })

  // Actualizar métricas de lectura (fire-and-forget). Usamos RPC para incrementar
  // atómicamente; si la RPC no existe, hacemos un UPDATE simple a last_read_at.
  admin
    .rpc('increment_feed_read', { p_token: token })
    .then(({ error }) => {
      if (error) {
        admin
          .from('calendar_feeds')
          .update({ last_read_at: new Date().toISOString() })
          .eq('token', token)
          .then(() => {}, () => {})
      }
    }, () => {})

  // Mapear a shape compatible con buildICS
  const mapped = (events || []).map(r => ({
    id: r.id,
    title: r.title,
    time: r.time,
    date: r.date,
    description: r.description,
    section: r.section,
  }))

  const ics = buildICS(mapped, feed.label || 'Focus')

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', `inline; filename="focus-calendar.ics"`)
  // Cache: 10 min. Apple/Google cachean igual, pero no queremos servir viejos eternos.
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600')
  return res.status(200).send(ics)
}

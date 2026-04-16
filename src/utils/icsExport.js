import { parseEventTime } from './parseEventTime'
import { resolveEventDate } from './resolveEventDate'

const pad = (n) => String(n).padStart(2, '0')

// Format a Date as UTC ICS datetime: YYYYMMDDTHHMMSSZ
// Using UTC avoids timezone ambiguity in Google Calendar, Apple Calendar, Outlook.
function fmtDTZ(date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`
  )
}

// Format a Date as ICS all-day date: YYYYMMDD
function fmtDate(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

// Escape special characters in ICS text values
function escapeICS(str) {
  if (!str) return ''
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g,  '\\;')
    .replace(/,/g,  '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Convert the events array from useEvents into an ICS calendar string.
 * @param {Array} events
 * @returns {string}
 */
export function eventsToICS(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Focus App//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Focus',
    'X-WR-TIMEZONE:local',
  ]

  events.forEach((ev) => {
    // Resolvemos la fecha correctamente para cualquier formato guardado
    const dateStr = resolveEventDate(ev)
    const start   = parseEventTime(ev.time, dateStr)
    const allDay  = !start

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${ev.id}@focus-app`)

    if (allDay) {
      const [y, m, d] = dateStr.split('-').map(Number)
      const base = new Date(y, m - 1, d)
      const next = new Date(y, m - 1, d + 1)
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(base)}`)
      lines.push(`DTEND;VALUE=DATE:${fmtDate(next)}`)
    } else {
      // Timed event — 1 hour duration, exported as UTC so every calendar app shows the right local time
      const end = new Date(start.getTime() + 60 * 60 * 1000)
      lines.push(`DTSTART:${fmtDTZ(start)}`)
      lines.push(`DTEND:${fmtDTZ(end)}`)
    }

    lines.push(`SUMMARY:${escapeICS(ev.title)}`)
    if (ev.description) lines.push(`DESCRIPTION:${escapeICS(ev.description)}`)

    // Stamp (required by RFC 5545)
    lines.push(`DTSTAMP:${fmtDT(new Date())}`)
    lines.push('END:VEVENT')
  })

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/**
 * Trigger a browser download of the ICS file.
 * @param {Array} events
 * @param {string} filename
 */
export function downloadICS(events, filename = 'focus-calendar.ics') {
  const content = eventsToICS(events)
  const blob    = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url     = URL.createObjectURL(blob)
  const a       = document.createElement('a')
  a.href        = url
  a.download    = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

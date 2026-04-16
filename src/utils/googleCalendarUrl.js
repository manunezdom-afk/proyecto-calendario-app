import { parseEventTime }  from './parseEventTime'
import { resolveEventDate } from './resolveEventDate'

const pad = (n) => String(n).padStart(2, '0')

// Format local Date as YYYYMMDDTHHmmSS (no Z) for Google Calendar + ctz param
function fmtLocal(date) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}00`
  )
}

/**
 * Build a Google Calendar "add event" URL for a single app event.
 * Opens directly in browser — no file download needed.
 */
export function googleCalendarUrl(ev) {
  const dateStr = resolveEventDate(ev)
  const start   = parseEventTime(ev.time, dateStr)
  const tz      = Intl.DateTimeFormat().resolvedOptions().timeZone

  let dates
  if (!start) {
    // All-day: YYYYMMDD/next-day (no time part)
    const [y, m, d] = dateStr.split('-').map(Number)
    const next = new Date(y, m - 1, d + 1)
    dates = `${y}${pad(m)}${pad(d)}/${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`
  } else {
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    dates = `${fmtLocal(start)}/${fmtLocal(end)}`
  }

  const params = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates })
  if (start) params.set('ctz', tz)          // timezone hint so GCal shows correct local time
  if (ev.description) params.set('details', ev.description)

  return `https://calendar.google.com/calendar/render?${params}`
}

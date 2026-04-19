/**
 * Parse an ICS (iCalendar) string and return an array of event objects
 * compatible with useEvents format.
 *
 * Handles DTSTART in three forms:
 *   DTSTART:20260414T170000Z         (UTC datetime)
 *   DTSTART;TZID=...:20260414T170000  (local datetime with timezone)
 *   DTSTART;VALUE=DATE:20260414       (all-day date)
 */

// Format 12h time string from a Date
function to12h(date) {
  const h = date.getHours()
  const m = date.getMinutes()
  const period = h >= 12 ? 'PM' : 'AM'
  const h12    = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// Format YYYY-MM-DD from a Date
function toISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Icon guesser compartido en src/utils/iconGuesser.js
import { guessIcon } from './iconGuesser'

/**
 * Unfold ICS lines (continued lines start with a space/tab).
 */
function unfold(raw) {
  return raw.replace(/\r?\n[ \t]/g, '')
}

/**
 * Parse the value of an ICS datetime property line.
 * @param {string} line  e.g. "DTSTART;VALUE=DATE:20260414" or "DTSTART:20260414T170000Z"
 * @returns {{ date: Date, allDay: boolean } | null}
 */
function parseDTLine(line) {
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return null

  const params = line.slice(0, colonIdx).toUpperCase()
  const value  = line.slice(colonIdx + 1).trim()

  // All-day: VALUE=DATE → YYYYMMDD
  if (params.includes('VALUE=DATE') || /^\d{8}$/.test(value)) {
    const y = parseInt(value.slice(0, 4))
    const m = parseInt(value.slice(4, 6)) - 1
    const d = parseInt(value.slice(6, 8))
    return { date: new Date(y, m, d, 0, 0, 0), allDay: true }
  }

  // Datetime: YYYYMMDDTHHMMSS[Z]
  const dtMatch = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/)
  if (dtMatch) {
    const [, y, mo, d, h, mi] = dtMatch.map(Number)
    const isUTC = dtMatch[7] === 'Z'
    const date  = isUTC
      ? new Date(Date.UTC(y, mo - 1, d, h, mi, 0))
      : new Date(y, mo - 1, d, h, mi, 0)
    return { date, allDay: false }
  }

  return null
}

/**
 * Unescape ICS text values.
 */
function unescapeICS(str) {
  return str
    .replace(/\\n/g,  '\n')
    .replace(/\\,/g,  ',')
    .replace(/\\;/g,  ';')
    .replace(/\\\\/g, '\\')
}

/**
 * Parse an ICS string into an array of event objects for useEvents.
 * @param {string} icsText
 * @returns {Array<{id, title, time, description, section, icon, dotColor, date}>}
 */
export function parseICS(icsText) {
  const text   = unfold(icsText)
  const lines  = text.split(/\r?\n/)
  const events = []

  let inEvent = false
  let current = {}

  lines.forEach((raw) => {
    const line = raw.trim()

    if (line === 'BEGIN:VEVENT') {
      inEvent = true
      current = {}
      return
    }

    if (line === 'END:VEVENT') {
      inEvent = false
      if (current.title) {
        const ev = {
          id:          `evt-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title:       current.title,
          time:        current.time   || '',
          description: current.desc   || '',
          section:     current.section || 'focus',
          featured:    false,
          icon:        guessIcon(current.title),
          dotColor:    current.section === 'evening' ? 'bg-secondary-container' : '',
          date:        current.date   || null,
        }
        events.push(ev)
      }
      return
    }

    if (!inEvent) return

    // Property name is everything before the first ':'
    // BUT params can contain ':', so split carefully
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) return

    const propFull = line.slice(0, colonIdx)
    const propName = propFull.split(';')[0].toUpperCase()
    const value    = line.slice(colonIdx + 1)

    switch (propName) {
      case 'SUMMARY':
        current.title = unescapeICS(value).trim()
        break

      case 'DESCRIPTION':
        current.desc = unescapeICS(value).trim()
        break

      case 'DTSTART': {
        const parsed = parseDTLine(line)
        if (parsed) {
          current.date = toISO(parsed.date)
          if (!parsed.allDay) {
            const timeStr = to12h(parsed.date)
            current.time  = timeStr
            // evening if hour >= 14
            current.section = parsed.date.getHours() >= 14 ? 'evening' : 'focus'
          }
        }
        break
      }

      // Ignore other properties
      default:
        break
    }
  })

  return events
}

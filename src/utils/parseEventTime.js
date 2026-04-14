/**
 * Parses a free-form time string from useEvents into a Date object.
 *
 * Handles:
 *   "5:00 PM"                  → today at 17:00
 *   "2:00 PM - 3:30 PM"        → today at 14:00 (first segment)
 *   "12:30 PM - Parque Cercano" → today at 12:30 (first segment, ignore text)
 *   ""                         → null
 *
 * @param {string} timeStr  - raw time string from event.time
 * @param {string|null} dateStr - YYYY-MM-DD or null (null = today)
 * @returns {Date|null}
 */
export function parseEventTime(timeStr, dateStr = null) {
  if (!timeStr || !timeStr.trim()) return null

  // Take the first segment if the string contains " - "
  const segment = timeStr.split(' - ')[0].trim()

  // Match "HH:MM AM/PM"
  const match = segment.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!match) return null

  let hours   = parseInt(match[1], 10)
  const mins  = parseInt(match[2], 10)
  const period = match[3].toUpperCase()

  if (period === 'PM' && hours !== 12) hours += 12
  if (period === 'AM' && hours === 12) hours  = 0

  // Build base date
  let base
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number)
    base = new Date(y, m - 1, d)
  } else {
    base = new Date()
  }

  base.setHours(hours, mins, 0, 0)
  return base
}

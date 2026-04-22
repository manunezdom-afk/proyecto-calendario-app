// Helpers de tiempo compartidos entre vistas.

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Convierte "9:00 AM", "3:30 PM", "14:30", "14", "9" a decimal (14.5, 9, etc).
// Acepta tanto formato 12h (AM/PM) como 24h. Devuelve null si no matchea.
export function parseTimeToDecimal(timeStr) {
  if (timeStr == null || timeStr === '—') return null
  const m = String(timeStr).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2] ?? '0', 10)
  const ap = m[3]?.toUpperCase()
  if (Number.isNaN(h) || Number.isNaN(min)) return null
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h + min / 60
}

// Igual que parseTimeToDecimal pero acepta rangos ("9:00 AM - 10:00 AM") y usa
// la primera hora. Devuelve null si no parsea.
export function parseEventHour(timeStr) {
  if (!timeStr || timeStr === '—') return null
  const first = String(timeStr).split('-')[0].trim()
  return parseTimeToDecimal(first)
}

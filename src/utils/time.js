// Helpers de tiempo compartidos entre vistas.

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseTimeToDecimal(timeStr) {
  if (!timeStr || timeStr === '—') return null
  const [h, m] = String(timeStr).split(':').map(Number)
  if (isNaN(h)) return null
  return h + (isNaN(m) ? 0 : m) / 60
}

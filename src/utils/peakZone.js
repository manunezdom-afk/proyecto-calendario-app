/**
 * Utilidades para la Zona de Rendimiento (cronotipo).
 * "Zona de rendimiento" = ventana horaria de máxima energía cognitiva.
 */

/** Parsea cualquier formato de hora a decimal (9.5 = 9:30). Toma la primera hora si hay rango. */
export function parseEventHour(timeStr) {
  if (!timeStr || timeStr === '—') return null
  const first = String(timeStr).split('-')[0].trim()

  // "HH:mm" — 24h
  const m24 = first.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) return Number(m24[1]) + Number(m24[2]) / 60

  // "h:mm AM/PM" — 12h
  const m12 = first.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (m12) {
    let h = Number(m12[1])
    const m = Number(m12[2] ?? '0')
    const ap = m12[3].toUpperCase()
    if (h === 12) h = 0
    if (ap === 'PM') h += 12
    return h + m / 60
  }
  return null
}

/** true = en zona, false = fuera de zona, null = hora no parseable o perfil sin configurar */
export function isInPeak(timeStr, peakStart, peakEnd) {
  const h = parseEventHour(timeStr)
  if (h === null || peakStart == null || peakEnd == null) return null
  return h >= peakStart && h < peakEnd
}

/** Convierte horas decimales a "H:mm" legible */
export function formatHour(decimal) {
  if (decimal == null) return ''
  const h = Math.floor(decimal)
  const m = Math.round((decimal - h) * 60)
  return m > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${h}:00`
}

/** "7:00–11:00" */
export function peakRangeLabel(peakStart, peakEnd) {
  return `${formatHour(peakStart)}–${formatHour(peakEnd)}`
}

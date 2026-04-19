// Helpers de fecha/hora compartidos. Antes estaban duplicados en
// MorningBrief, EveningShutdown, PlannerView, MonthCalendar, parseScheduleText,
// icsImport y varios `new Date().toISOString().slice(0, 10)` sueltos.

// YYYY-MM-DD en la TZ local del usuario (ojo: toISOString() usa UTC y desalinea
// con la fecha del calendario a ciertas horas). Preferimos SIEMPRE esta.
export function toISODate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayISO() {
  return toISODate(new Date())
}

export function tomorrowISO() {
  return toISODate(new Date(Date.now() + 86400000))
}

// Convierte "HH:MM", "9:00 AM", "7pm", "14h30" a decimal (horas.min/60).
// Devuelve null si no se puede parsear.
export function parseTimeToDecimal(timeStr) {
  if (!timeStr) return null
  const s = String(timeStr).trim()

  // Rango "9:00 - 10:00" → usamos el inicio
  const rangeStart = s.split(/[–-]/)[0]?.trim() ?? s

  // 12h: "9:00 AM", "7pm"
  const m12 = rangeStart.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const min = parseInt(m12[2] ?? '0', 10)
    const ap = m12[3].toUpperCase()
    if (ap === 'PM' && h !== 12) h += 12
    if (ap === 'AM' && h === 12) h = 0
    return h + min / 60
  }

  // "14h30" o "9h"
  const mH = rangeStart.match(/^(\d{1,2})h(\d{2})?$/i)
  if (mH) return parseInt(mH[1], 10) + (parseInt(mH[2] ?? '0', 10)) / 60

  // 24h: "14:30"
  const m24 = rangeStart.match(/^(\d{1,2}):(\d{2})/)
  if (m24) {
    const h = parseInt(m24[1], 10)
    const min = parseInt(m24[2], 10)
    if (h >= 0 && h <= 23) return h + min / 60
  }

  return null
}

// Formatea decimal → "3:30 PM". Si withSeconds=false y min=0, omite ":00".
export function formatHour12(dec) {
  if (dec == null || Number.isNaN(dec)) return ''
  const h24 = Math.floor(dec)
  const min = Math.round((dec - h24) * 60)
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return min > 0
    ? `${h12}:${String(min).padStart(2, '0')} ${period}`
    : `${h12}:00 ${period}`
}

// "14:30" en 24h
export function formatHour24(dec) {
  if (dec == null || Number.isNaN(dec)) return ''
  const h = Math.floor(dec)
  const m = Math.round((dec - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Extrae hora entera (0-23) de un string tipo "HH:MM" o "HH:MM - HH:MM".
// Usado para señales y agrupaciones por hora. Devuelve null si no hay match.
export function parseEventHour(timeStr) {
  const dec = parseTimeToDecimal(timeStr)
  return dec == null ? null : Math.floor(dec)
}

// Nombre localizado del día de la semana usando Intl (evita arrays hardcoded).
const DOW_FORMATTER = new Intl.DateTimeFormat('es-ES', { weekday: 'long' })
const DOW_SHORT_FORMATTER = new Intl.DateTimeFormat('es-ES', { weekday: 'short' })
const MONTH_FORMATTER = new Intl.DateTimeFormat('es-ES', { month: 'long' })
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
})

export function weekdayName(date = new Date()) { return DOW_FORMATTER.format(date) }
export function weekdayShort(date = new Date()) { return DOW_SHORT_FORMATTER.format(date) }
export function monthName(date = new Date()) { return MONTH_FORMATTER.format(date) }
export function formatDateLong(date = new Date()) { return FULL_DATE_FORMATTER.format(date) }

// "Lun, 14 Abr" — uso rápido para chips y listas
export function formatDateShort(date = new Date()) {
  return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(date)
}

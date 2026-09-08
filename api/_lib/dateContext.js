const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
export function addCivilDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
export function validTimezone(value) {
  if (typeof value !== 'string' || !value) return false
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true } catch { return false }
}
export function buildDateContext(clientNow, clientTimezone) {
  const tz = validTimezone(clientTimezone) ? clientTimezone : 'UTC'
  const timestamp = typeof clientNow === 'number' && Number.isFinite(clientNow) && Math.abs(clientNow) < 8.64e15 ? clientNow : Date.now()
  const now = new Date(timestamp)
  const formatter = options => new Intl.DateTimeFormat('es-ES', { timeZone: tz, ...options })
  const parts = formatter({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const component = name => parts.find(p => p.type === name).value
  const todayISO = `${component('year')}-${component('month')}-${component('day')}`
  const currentTime24 = formatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const weekDates = {}
  for (let offset = 1; offset <= 7; offset++) {
    const iso = addCivilDays(todayISO, offset)
    weekDates[DAY_NAMES[new Date(`${iso}T12:00:00Z`).getUTCDay()]] = iso
  }
  return { tz, todayISO, tomorrow: addCivilDays(todayISO, 1), dayAfter: addCivilDays(todayISO, 2),
    currentTime24, currentTime12: formatter({ hour: '2-digit', minute: '2-digit', hour12: true }).format(now),
    todayStr: formatter({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now),
    weekDates, nowISO: now.toISOString() }
}

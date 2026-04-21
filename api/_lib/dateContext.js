const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export function buildDateContext(clientNow, clientTimezone) {
  const tz = typeof clientTimezone === 'string' && clientTimezone ? clientTimezone : 'UTC'
  const nowMs = typeof clientNow === 'number' ? clientNow : Date.now()

  function formatInTz(date, options) {
    try {
      return new Intl.DateTimeFormat('es-ES', { timeZone: tz, ...options }).format(date)
    } catch {
      return new Intl.DateTimeFormat('es-ES', options).format(date)
    }
  }
  function isoDateInTz(date) {
    const parts = formatInTz(date, { year: 'numeric', month: '2-digit', day: '2-digit' })
    const [d, m, y] = parts.split('/')
    return `${y}-${m}-${d}`
  }
  function timeInTz(date) {
    return formatInTz(date, { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const today = new Date(nowMs)
  const todayISO = isoDateInTz(today)
  const tomorrow = isoDateInTz(new Date(today.getTime() + 86400000))
  const dayAfter = isoDateInTz(new Date(today.getTime() + 2 * 86400000))
  const currentTime24 = timeInTz(today)
  const currentTime12 = formatInTz(today, { hour: '2-digit', minute: '2-digit', hour12: true })
  const todayStr = formatInTz(today, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const todayWeekdayIdx = DAY_NAMES.indexOf(formatInTz(today, { weekday: 'long' }).toLowerCase())

  const weekDates = {}
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today.getTime() + i * 86400000)
    const weekday = todayWeekdayIdx >= 0
      ? DAY_NAMES[(todayWeekdayIdx + i) % 7]
      : formatInTz(d, { weekday: 'long' }).toLowerCase()
    weekDates[weekday] = isoDateInTz(d)
  }

  return { todayISO, tomorrow, dayAfter, currentTime24, currentTime12, todayStr, weekDates }
}

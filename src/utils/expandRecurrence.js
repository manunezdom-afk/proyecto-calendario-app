// Expande una acción `add_recurring_event` emitida por Nova en N eventos
// concretos (cada uno con su `date`). Nova emite la intención ("diario",
// "cada lunes") y el cliente calcula las fechas — así la respuesta del
// LLM se mantiene dentro del presupuesto de tokens aunque sean 30
// instancias, y evitamos errores aritméticos del modelo en rollover
// de mes.
//
// Patrones soportados:
//   daily     → N días corridos desde startDate (default 30)
//   weekdays  → N días hábiles desde startDate, saltando sábados y
//               domingos (default 22 ≈ 1 mes laboral)
//   weekly    → N ocurrencias del weekday indicado, comenzando por la
//               primera ≥ startDate (default 12 ≈ 3 meses)
//
// Guardrail: nunca más de MAX_OCCURRENCES instancias por acción. Si el
// usuario quiere más, que renueve la rutina en un mes — preferimos no
// inundarle la base con 365 filas por una orden ambigua.

const MAX_OCCURRENCES = 31

const DEFAULT_COUNT = {
  daily:    30,
  weekdays: 22,
  weekly:   12,
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseISO(iso) {
  // Parseamos en local (no `new Date(iso)`) para que un ISO "2026-04-24"
  // signifique el día local 24/04, no un instante UTC que puede caer en
  // el día anterior en zonas con offset negativo.
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function isValidISO(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export function expandRecurrence(action) {
  if (!action || action.type !== 'add_recurring_event') return []
  const base = action.event
  const rec  = action.recurrence
  if (!base || !rec || typeof rec.pattern !== 'string') return []

  const startISO = isValidISO(rec.startDate) ? rec.startDate : toISO(new Date())
  const start = parseISO(startISO)

  const defCount = DEFAULT_COUNT[rec.pattern] ?? 0
  const rawCount = Number.isFinite(rec.count) ? rec.count : defCount
  const count = Math.max(0, Math.min(MAX_OCCURRENCES, Math.floor(rawCount)))
  if (!count) return []

  const events = []

  if (rec.pattern === 'daily') {
    for (let i = 0; i < count; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      events.push({ ...base, date: toISO(d) })
    }
    return events
  }

  if (rec.pattern === 'weekdays') {
    const d = new Date(start)
    while (events.length < count) {
      const wd = d.getDay()
      if (wd >= 1 && wd <= 5) {
        events.push({ ...base, date: toISO(d) })
      }
      d.setDate(d.getDate() + 1)
    }
    return events
  }

  if (rec.pattern === 'weekly') {
    const target = Number.isInteger(rec.weekday) && rec.weekday >= 0 && rec.weekday <= 6
      ? rec.weekday
      : start.getDay()
    // Primera ocurrencia: mismo día de la semana igual o posterior a
    // startDate. Si startDate cae justo en ese weekday, esa es la
    // primera instancia.
    const first = new Date(start)
    const offset = (target - start.getDay() + 7) % 7
    first.setDate(start.getDate() + offset)
    for (let i = 0; i < count; i++) {
      const d = new Date(first)
      d.setDate(first.getDate() + i * 7)
      events.push({ ...base, date: toISO(d) })
    }
    return events
  }

  return []
}

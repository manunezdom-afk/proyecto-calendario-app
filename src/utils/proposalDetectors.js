// ── Proposal detectors ─────────────────────────────────────────────────────
// Funciones puras que examinan el estado del calendario/tareas y devuelven
// "candidatos" a propuesta para la bandeja. Son agnósticas a React: el hook
// useProposalEngine las llama y se encarga de deduplicar (no proponer la
// misma cosa dos veces) y persistir (recordar lo ya propuesto entre sesiones).
//
// Cada detector devuelve UN ARRAY de objetos { key, suggestion }, donde:
//   · `key` es un string estable que identifica la propuesta (para dedup).
//   · `suggestion` es el objeto que se pasa a addSuggestion — incluye
//     kind, payload, previewTitle/Body/Icon, reason, etc.
//
// Si no hay nada que proponer, devolver array vacío.

import { parseTimeRange, composeTimeRange } from './eventDuration'
import { resolveEventDate } from './resolveEventDate'
import { isReminderItem, normalizeTitleKey } from './reminders'

// Util: ¿dos rangos [a,b] y [c,d] se superponen?
function overlaps(a, b, c, d) {
  if (a == null || b == null || c == null || d == null) return false
  return a < d && c < b
}

// ¿Dos eventos chocan? Mismo día + horas que se cruzan.
// Eventos sin hora de término asumimos 60 min de buffer (intuición razonable).
function eventsConflict(a, b) {
  if (!a || !b || a.id === b.id) return false
  // Recordatorios no chocan con nada — son avisos puntuales, no bloqueos.
  if (isReminderItem(a) || isReminderItem(b)) return false

  const dateA = resolveEventDate(a)
  const dateB = resolveEventDate(b)
  if (!dateA || !dateB || dateA !== dateB) return false

  const rangeA = parseTimeRange(a.time)
  const rangeB = parseTimeRange(b.time)
  if (!rangeA || !rangeB) return false

  const aStart = rangeA.startH
  const aEnd   = rangeA.endH ?? (aStart + 1) // sin fin → buffer 1h
  const bStart = rangeB.startH
  const bEnd   = rangeB.endH ?? (bStart + 1)

  return overlaps(aStart, aEnd, bStart, bEnd)
}

// Clave estable para un par de eventos (orden alfabético del id).
function pairKey(idA, idB) {
  return [idA, idB].sort().join('|')
}

// Convierte una hora decimal (15.5) en string "3:30 PM".
function decimalToTime12(decH) {
  const h24 = Math.floor(decH)
  const m   = Math.round((decH - h24) * 60)
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// ── A) Detector de conflictos ─────────────────────────────────────────────
// Para cada par (a, b) de eventos que se solapan en el mismo día, propone
// MOVER el segundo (el que se creó después si los ids son secuenciales) a
// inmediatamente después del primero. Skip si ya fue propuesto antes.
export function detectConflicts(events, alreadySeenPairKeys) {
  if (!Array.isArray(events) || events.length < 2) return []
  const out = []
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i]
      const b = events[j]
      if (!eventsConflict(a, b)) continue

      const key = pairKey(a.id, b.id)
      if (alreadySeenPairKeys.has(key)) continue

      // Movemos el "más reciente" (b por convención de ids tsk-/evt-${ts})
      // al final del primero. Si parseTimeRange falla, skip — no podemos
      // proponer una hora válida.
      const rangeA = parseTimeRange(a.time)
      const rangeB = parseTimeRange(b.time)
      if (!rangeA || !rangeB) continue

      const aEnd  = rangeA.endH ?? (rangeA.startH + 1)
      const bDur  = (rangeB.endH ?? (rangeB.startH + 1)) - rangeB.startH
      const newStart = aEnd
      const newEnd   = newStart + bDur

      // Si la nueva hora se va más allá de las 23h, no proponemos —
      // moverlo a las 11pm es peor que tener el conflicto. Idealmente
      // propondríamos al día siguiente, pero eso es scope para v2.
      if (newEnd > 23) continue

      const newTimeStr = composeTimeRange(decimalToTime12(newStart), Math.round(bDur * 60))

      out.push({
        key: `conflict|${key}`,
        suggestion: {
          kind: 'edit_event',
          previewIcon: 'swap_horiz',
          previewTitle: `Conflicto: "${b.title}" choca con "${a.title}"`,
          previewBody: `Mover "${b.title}" a ${newTimeStr}`,
          reason: `Ambos eventos se solapan en ${a.time} y ${b.time}. Moverlo libera el conflicto.`,
          payload: {
            id: b.id,
            updates: { time: newTimeStr },
          },
        },
      })
    }
  }
  return out
}

// ── B) Detector de patrones recurrentes ───────────────────────────────────
// Si un evento se repite ≥3 veces en el mismo día de la semana a una hora
// similar (±15 min), proponemos hacerlo recurrente semanal.
// Skip eventos que ya son parte de una serie (tienen recurrence en su id o
// metadata) — no queremos proponer recurrencia sobre recurrencia.
export function detectRecurringCandidates(events, alreadyProposedKeys) {
  if (!Array.isArray(events) || events.length < 3) return []

  // Agrupar por (titleKey + weekday + bucket de hora redondeado a 15 min)
  const groups = new Map()
  for (const ev of events) {
    if (isReminderItem(ev)) continue
    const titleKey = normalizeTitleKey(ev.title)
    if (!titleKey) continue
    const date = resolveEventDate(ev)
    if (!date) continue
    const range = parseTimeRange(ev.time)
    if (!range) continue
    const weekday = new Date(date + 'T00:00:00').getDay()
    const bucket  = Math.round(range.startH * 4) / 4 // a cuartos de hora
    const groupKey = `${titleKey}|${weekday}|${bucket}`

    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(ev)
  }

  const out = []
  for (const [groupKey, items] of groups) {
    if (items.length < 3) continue
    if (alreadyProposedKeys.has(groupKey)) continue

    // Tomar el primer item como template para el evento recurrente
    const template = items[0]
    const range = parseTimeRange(template.time)
    if (!range) continue
    const weekday = new Date(resolveEventDate(template) + 'T00:00:00').getDay()
    const dayName = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][weekday]

    out.push({
      key: `recurring|${groupKey}`,
      suggestion: {
        kind: 'add_recurring_event',
        previewIcon: 'event_repeat',
        previewTitle: `Patrón detectado: "${template.title}" los ${dayName}`,
        previewBody: `Lo agendaste ${items.length} veces a la misma hora. ¿Hacerlo recurrente cada ${dayName} a ${template.time}?`,
        reason: `Detectado patrón ${items.length}x en ${items.map(i => resolveEventDate(i)).join(', ')}.`,
        payload: {
          event: {
            title: template.title,
            time: template.time,
            section: template.section,
            icon: template.icon,
          },
          recurrence: {
            pattern: 'weekly',
            weekday,
            count: 12,
            // startDate: próximo lunes/martes/etc. desde hoy
            startDate: nextWeekdayISO(weekday),
          },
        },
      },
    })
  }
  return out
}

function nextWeekdayISO(targetWeekday) {
  const today = new Date()
  const todayWd = today.getDay()
  const diff = (targetWeekday - todayWd + 7) % 7
  const next = new Date(today)
  next.setDate(today.getDate() + (diff === 0 ? 7 : diff))
  return next.toISOString().slice(0, 10)
}

// ── C) Cierre del día (Evening review) ────────────────────────────────────
// Después de las 20:00, una sola vez por día, si hay tareas pendientes con
// category='hoy', proponemos moverlas a category='semana' (no se eliminan,
// quedan en backlog visible). Una propuesta ÚNICA con varias acciones
// batch — el usuario las aprueba todas de un saque.
export function detectEveningReview(tasks, lastReviewDateISO, nowDate = new Date()) {
  if (nowDate.getHours() < 20) return []
  const todayISO = nowDate.toISOString().slice(0, 10)
  if (lastReviewDateISO === todayISO) return []
  if (!Array.isArray(tasks)) return []

  const pending = tasks.filter((t) => t && !t.done && t.category === 'hoy')
  if (pending.length === 0) return []

  // Una propuesta para cada tarea (batch lógico): el preview muestra el
  // total y el reason explica el "porqué". Mismo batchId agrupa.
  const batchId = `evening|${todayISO}`
  return [
    {
      key: `evening|${todayISO}`,
      suggestion: {
        kind: 'reschedule_pending_today',
        previewIcon: 'wb_twilight',
        previewTitle: `${pending.length} ${pending.length === 1 ? 'tarea' : 'tareas'} sin terminar hoy`,
        previewBody: pending.length === 1
          ? `Mover "${pending[0].label}" a esta semana para no perderla.`
          : `Moverlas a esta semana para no perderlas: ${pending.slice(0, 3).map(t => `"${t.label}"`).join(', ')}${pending.length > 3 ? '…' : ''}`,
        reason: `Cierre del día — quedaron ${pending.length} tareas marcadas para hoy sin completar.`,
        batchId,
        payload: {
          taskIds: pending.map((t) => t.id),
        },
      },
    },
  ]
}

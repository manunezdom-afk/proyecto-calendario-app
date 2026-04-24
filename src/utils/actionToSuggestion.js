// ── actionToSuggestion ──────────────────────────────────────────────────────
// Convierte una acción emitida por Nova (add_event/edit_event/delete_event/
// mark_task_done) en una "suggestion" con preview legible para la bandeja.

import { expandRecurrence } from './expandRecurrence'

const ICON_BY_KIND = {
  add_event: 'add_circle',
  add_recurring_event: 'event_repeat',
  edit_event: 'edit_calendar',
  delete_event: 'delete',
  add_task: 'check_box',
  toggle_task: 'task_alt',
  mark_task_done: 'task_alt',
  delete_task: 'delete',
}

function describeReminderOffsets(offsets) {
  if (!Array.isArray(offsets) || offsets.length === 0) return ''
  if (offsets.length === 1) return `Aviso ${offsets[0]} min antes`
  const sorted = [...offsets].sort((a, b) => a - b)
  return `Avisos ${sorted.join(', ')} min antes`
}

const PATTERN_LABELS = {
  daily: 'todos los días',
  weekdays: 'de lunes a viernes',
  weekly: 'cada semana',
}

const WEEKDAY_LABELS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MONTH_NAMES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function formatDateReadable(dateISO) {
  if (!dateISO) return 'hoy'
  try {
    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    if (dateISO === today) return 'hoy'
    if (dateISO === tomorrow) return 'mañana'
    const d = new Date(dateISO + 'T00:00:00')
    return `${DAY_NAMES_ES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES_ES[d.getMonth()]}`
  } catch {
    return dateISO
  }
}

function describeEvent(ev) {
  const parts = []
  // Nova emite `time` (inicio) y `endTime` (fin) por separado. En la UI el
  // rango se compone al guardar, pero en el preview de la bandeja queremos
  // mostrar "3:00 PM – 4:00 PM" desde ya. Si el `time` ya viene como rango,
  // se usa tal cual.
  const alreadyRange = ev?.time && String(ev.time).includes('-')
  if (ev?.time) {
    parts.push(alreadyRange ? ev.time : (ev.endTime ? `${ev.time} – ${ev.endTime}` : ev.time))
  }
  parts.push(formatDateReadable(ev?.date))
  if (ev?.section === 'focus') parts.push('Focus')
  return parts.join(' · ')
}

// ── Conversores por tipo ───────────────────────────────────────────────────

export function actionToSuggestion(action, { reason, batchId, events = [], tasks = [] } = {}) {
  if (!action?.type) return null

  const base = {
    kind: action.type,
    reason: reason || null,
    batchId: batchId || null,
    previewIcon: ICON_BY_KIND[action.type] || 'auto_awesome',
  }

  switch (action.type) {
    case 'add_event': {
      const ev = action.event || {}
      const parts = [describeEvent(ev)]
      const reminderLabel = describeReminderOffsets(ev.reminderOffsets)
      if (reminderLabel) parts.push(reminderLabel)
      return {
        ...base,
        payload: { event: ev },
        previewTitle: `Crear: ${ev.title || 'evento sin título'}`,
        previewBody: parts.filter(Boolean).join(' · '),
      }
    }

    case 'add_recurring_event': {
      const ev = action.event || {}
      const rec = action.recurrence || {}
      const patternLabel = rec.pattern === 'weekly' && Number.isInteger(rec.weekday)
        ? `cada ${WEEKDAY_LABELS[rec.weekday]}`
        : (PATTERN_LABELS[rec.pattern] || rec.pattern || '')
      const bodyParts = [patternLabel]
      if (ev.time) bodyParts.push(ev.time)
      const reminderLabel = describeReminderOffsets(ev.reminderOffsets)
      if (reminderLabel) bodyParts.push(reminderLabel)
      return {
        ...base,
        kind: 'add_recurring_event',
        payload: { event: ev, recurrence: rec },
        previewTitle: `Crear recurrente: ${ev.title || 'evento'}`,
        previewBody: bodyParts.filter(Boolean).join(' · ') || 'Sin detalles',
      }
    }

    case 'edit_event': {
      const target = events.find((e) => e.id === action.id)
      const updates = action.updates || {}
      const title = updates.title || target?.title || 'evento'

      // Describe el cambio más relevante: hora > fecha > título > aviso >
      // fallback a lista de campos. El aviso (reminderOffsets) es el caso
      // común cuando el usuario pide "avísame X min antes" — antes caía a
      // "actualización menor" que no decía nada al usuario en la bandeja.
      let changeBody = ''
      if (updates.time && updates.time !== target?.time) {
        changeBody = `Hora: ${target?.time || '—'} → ${updates.time}`
      } else if (updates.date && updates.date !== target?.date) {
        changeBody = `Fecha: ${formatDateReadable(target?.date)} → ${formatDateReadable(updates.date)}`
      } else if (Array.isArray(updates.reminderOffsets)) {
        const label = describeReminderOffsets(updates.reminderOffsets)
        changeBody = label || 'Recordatorios desactivados'
      } else if (updates.title && updates.title !== target?.title) {
        changeBody = `Título: "${target?.title}" → "${updates.title}"`
      } else {
        changeBody = Object.keys(updates).join(', ') || 'actualización menor'
      }

      return {
        ...base,
        payload: { id: action.id, updates },
        previewTitle: `Actualizar: ${title}`,
        previewBody: changeBody,
      }
    }

    case 'delete_event': {
      const target = events.find((e) => e.id === action.id)
      return {
        ...base,
        payload: { id: action.id },
        previewTitle: `Eliminar: ${target?.title || 'evento'}`,
        previewBody: target ? describeEvent(target) : '—',
      }
    }

    case 'mark_task_done':
    case 'toggle_task': {
      const target = tasks.find((t) => t.id === action.id)
      return {
        ...base,
        kind: 'toggle_task',
        payload: { id: action.id },
        previewTitle: `Completar tarea: ${target?.label || '—'}`,
        previewBody: target?.category === 'hoy' ? 'Hoy' : target?.category || '',
      }
    }

    case 'add_task': {
      const t = action.task || {}
      const linkedEvent = t.linkedEventId
        ? events.find(e => e.id === t.linkedEventId)
        : null
      const bodyParts = []
      if (t.priority && t.priority !== 'Media') bodyParts.push(`Prioridad ${t.priority}`)
      if (t.category) bodyParts.push(`Categoría: ${t.category}`)
      if (linkedEvent) bodyParts.push(`Ligada a "${linkedEvent.title}"${linkedEvent.time ? ` · ${linkedEvent.time}` : ''}`)
      return {
        ...base,
        payload: { task: t },
        previewTitle: `Crear tarea: ${t.label || 'pendiente'}`,
        previewBody: bodyParts.join(' · ') || 'Sin detalles adicionales',
      }
    }

    case 'delete_task': {
      const target = tasks.find((t) => t.id === action.id)
      return {
        ...base,
        payload: { id: action.id },
        previewTitle: `Eliminar tarea: ${target?.label || '—'}`,
        previewBody: target?.category === 'hoy' ? 'Hoy' : target?.category || '',
      }
    }

    default:
      return null
  }
}

// Aplica una suggestion. Para creaciones (add_event / add_task) devuelve
// `{ message, undo }` para que el caller pueda ofrecer "Deshacer" — cerrando
// la promesa del onboarding de que todo cambio es reversible. Para los demás
// kinds devuelve null: las ediciones no guardan estado previo, los toggles no
// generan un mensaje útil, los deletes son la reversa de algo ya aplicado.
export function applySuggestion(suggestion, handlers = {}) {
  if (!suggestion) return null
  const { kind, payload = {} } = suggestion
  const {
    onAddEvent, onEditEvent, onDeleteEvent,
    onAddTask, onToggleTask, onDeleteTask,
  } = handlers

  switch (kind) {
    case 'add_event': {
      const created = onAddEvent?.(payload.event)
      if (created?.id) {
        return {
          message: `Añadí "${created.title || 'evento'}"`,
          undo: () => onDeleteEvent?.(created.id),
        }
      }
      return null
    }
    case 'add_recurring_event': {
      // Expandimos la intención recurrente a N eventos concretos y
      // capturamos los ids reales para que el undo borre todas las
      // instancias de una vez — de otro modo el usuario terminaba con
      // 30 eventos sin forma rápida de revertir.
      const expanded = expandRecurrence({
        type: 'add_recurring_event',
        event: payload.event,
        recurrence: payload.recurrence,
      })
      const ids = []
      let title = payload.event?.title || 'evento'
      for (const ev of expanded) {
        const created = onAddEvent?.(ev)
        if (created?.id) ids.push(created.id)
        if (created?.title) title = created.title
      }
      if (ids.length > 0) {
        return {
          message: `Añadí "${title}" (${ids.length} ${ids.length === 1 ? 'instancia' : 'instancias'})`,
          undo: () => { for (const id of ids) onDeleteEvent?.(id) },
        }
      }
      return null
    }
    case 'edit_event':
      onEditEvent?.(payload.id, payload.updates || {})
      return null
    case 'delete_event':
      onDeleteEvent?.(payload.id)
      return null
    case 'mark_task_done':
    case 'toggle_task':
      onToggleTask?.(payload.id)
      return null
    case 'add_task': {
      const created = onAddTask?.(payload.task)
      if (created?.id) {
        return {
          message: `Añadí la tarea "${created.label || 'nueva'}"`,
          undo: () => onDeleteTask?.(created.id),
        }
      }
      return null
    }
    case 'delete_task':
      onDeleteTask?.(payload.id)
      return null
    default:
      return null
  }
}

// ── actionToSuggestion ──────────────────────────────────────────────────────
// Convierte una acción emitida por Nova (add_event/edit_event/delete_event/
// mark_task_done) en una "suggestion" con preview legible para la bandeja.

const ICON_BY_KIND = {
  add_event: 'add_circle',
  edit_event: 'edit_calendar',
  delete_event: 'delete',
  add_task: 'check_box',
  toggle_task: 'task_alt',
  mark_task_done: 'task_alt',
  delete_task: 'delete',
}

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
  if (ev?.time) parts.push(ev.time)
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
      return {
        ...base,
        payload: { event: ev },
        previewTitle: `Crear: ${ev.title || 'evento sin título'}`,
        previewBody: describeEvent(ev),
      }
    }

    case 'edit_event': {
      const target = events.find((e) => e.id === action.id)
      const updates = action.updates || {}
      const title = updates.title || target?.title || 'evento'

      // Describe el cambio más relevante (hora > fecha > título)
      let changeBody = ''
      if (updates.time && updates.time !== target?.time) {
        changeBody = `Hora: ${target?.time || '—'} → ${updates.time}`
      } else if (updates.date && updates.date !== target?.date) {
        changeBody = `Fecha: ${formatDateReadable(target?.date)} → ${formatDateReadable(updates.date)}`
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

// ── Ejecuta una suggestion aprobada llamando al callback correcto ──────────
export function applySuggestion(suggestion, handlers = {}) {
  if (!suggestion) return
  const { kind, payload = {} } = suggestion
  const {
    onAddEvent, onEditEvent, onDeleteEvent,
    onAddTask, onToggleTask, onDeleteTask,
  } = handlers

  switch (kind) {
    case 'add_event':
      onAddEvent?.(payload.event)
      break
    case 'edit_event':
      onEditEvent?.(payload.id, payload.updates || {})
      break
    case 'delete_event':
      onDeleteEvent?.(payload.id)
      break
    case 'mark_task_done':
    case 'toggle_task':
      onToggleTask?.(payload.id)
      break
    case 'add_task':
      onAddTask?.(payload.task)
      break
    case 'delete_task':
      onDeleteTask?.(payload.id)
      break
    default:
      break
  }
}

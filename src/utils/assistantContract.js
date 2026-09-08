import { expandRecurrence } from './expandRecurrence.js'

const object = value => value && typeof value === 'object' && !Array.isArray(value)
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const copy = value => JSON.parse(JSON.stringify(value))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const failure = message => ({ ok: false, message, receipts: [] })
export const SAVE_FAILED = 'No pude guardar todos los cambios en este dispositivo. Revisa tus pendientes antes de repetirlos.'

// Deterministic UUID-shaped entity IDs keep replayed creations idempotent.
// These identifiers are not credentials or authorization tokens.
export function stableActionIdentifier(actionId, kind) {
  const input = `${kind}:${actionId}`
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map(seed => {
    let hash = seed
    for (const character of input) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0
    return hash.toString(16).padStart(8, '0')
  })
  const hex = words.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
}

export function validCivilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}
function validTime(value) {
  return typeof value === 'string' && /^(?:(?:[01]?\d|2[0-3]):[0-5]\d|(?:0?[1-9]|1[0-2])(?::[0-5]\d)?\s*[AP]M)$/i.test(value.trim())
}
function validEvent(event) {
  return object(event) && nonempty(event.title) && validCivilDate(event.date) && validTime(event.time)
}
const claimsExecution = text => /(?:^|[.!?]\s+)(?:perfecto[,.!]?\s*|listo[,.!]?\s*|ya\s+|hecho[,.!]?\s*|te\s+|lo\s+|la\s+)*(?:he\s+)?(?:cre[eé]|guard[eé]|agend[eé]|program[eé]|borr[eé]|elimin[eé]|actualic[eé]|complet[eé]|marqu[eé]|mov[ií]|a[nñ]ad[ií]|anot[eé]|dej[eé]|creado|guardado|agendado|eliminado|actualizado)(?=$|[\s.,!?;:])/im.test(text || '') || /(?:^|[.!?]\s+)(?:perfecto[,.!]?\s*|listo[,.!]?\s*|ya\s+)?te\s+(?:lo\s+)?(?:recordar[eé]|avisar[eé]|voy\s+a\s+(?:recordar|avisar))(?=$|[\s.,!?;:])/im.test(text || '')

export function completedRetryableFailure(status, payload, requestId) {
  return status === 503 && payload?.request_completed === true && payload?.request_retryable === true &&
    typeof payload?.requestId === 'string' && payload.requestId.toLowerCase() === String(requestId).toLowerCase()
}

// Normalize only structured fields. Never infer a destructive target from a
// reply, title similarity, historical text, or an identifier that is absent.
export function normalizeAssistantAction(raw, context = {}, identity) {
  if (!object(raw) || !nonempty(raw.type)) return null
  const { events = [], tasks = [], memories = [] } = context
  let action = copy(raw)
  action.actionId = nonempty(action.actionId) ? action.actionId : identity
  if (!nonempty(action.actionId)) return null
  const event = events.find(item => item.id === action.id)
  const task = tasks.find(item => item.id === action.id)
  switch (action.type) {
    case 'add_event':
      if (!validEvent(action.event)) return null
      break
    case 'add_recurring_event':
      if (!validEvent(action.event) || !object(action.recurrence) ||
          !['daily', 'weekdays', 'weekly'].includes(action.recurrence.pattern) ||
          !validCivilDate(action.recurrence.startDate) ||
          (action.recurrence.count != null && (!Number.isInteger(action.recurrence.count) || action.recurrence.count < 1 || action.recurrence.count > 31))) return null
      break
    case 'edit_event': {
      if (!event || !object(action.updates)) return null
      const allowed = ['title', 'time', 'endTime', 'date', 'location', 'notes', 'subtitle', 'reminderOffsets', 'reminderNotes', 'section']
      const updates = Object.fromEntries(Object.entries(action.updates).filter(([key]) => allowed.includes(key)))
      if (!Object.keys(updates).length || ('title' in updates && !nonempty(updates.title)) ||
          ('time' in updates && !validTime(updates.time)) || ('date' in updates && !validCivilDate(updates.date)) ||
          ('endTime' in updates && updates.endTime != null && !validTime(updates.endTime))) return null
      action.updates = updates
      break
    }
    case 'delete_event': if (!event) return null; break
    case 'add_task':
      if (!object(action.task) || !nonempty(action.task.label) ||
          (action.task.date != null && !validCivilDate(action.task.date)) ||
          (action.task.time != null && (!action.task.date || !validTime(action.task.time))) ||
          (action.task.linkedEventId && !events.some(item => item.id === action.task.linkedEventId)) ||
          (action.task.parentTaskId && !tasks.some(item => item.id === action.task.parentTaskId))) return null
      break
    case 'mark_task_done': action = { ...action, type: 'complete_task', done: true }; break
    case 'toggle_task':
      if (!task) return null
      action = { ...action, type: 'complete_task', done: !task.done }
      break
    case 'complete_task': if (typeof action.done !== 'boolean') return null; break
    case 'edit_task': {
      if (!task || !object(action.updates)) return null
      const allowed = ['label', 'date', 'time', 'priority', 'done']
      const updates = Object.fromEntries(Object.entries(action.updates).filter(([key]) => allowed.includes(key)))
      if (!Object.keys(updates).length || ('label' in updates && !nonempty(updates.label)) ||
          (updates.date != null && !validCivilDate(updates.date)) || (updates.time != null && !validTime(updates.time)) ||
          ('done' in updates && typeof updates.done !== 'boolean') ||
          ('priority' in updates && !['Alta', 'Media', 'Baja'].includes(updates.priority))) return null
      if ('date' in updates && updates.date === null) updates.time = null
      if (updates.time && !(updates.date ?? task.date)) return null
      action.updates = updates
      break
    }
    case 'delete_task': if (!task) return null; break
    case 'remember':
      if (!object(action.memory) || !nonempty(action.memory.content)) return null
      action.type = 'save_memory'
      break
    case 'save_memory': {
      const memory = action.memory || action
      const key = memory.key ?? memory.subject
      const value = memory.value ?? memory.content
      if (!nonempty(value) || (memory.value != null && !nonempty(key))) return null
      action.memory = { subject: key || null, content: value, category: memory.category === 'person_alias' ? 'relationship' : memory.category }
      break
    }
    case 'forget_memory': {
      const key = action.key ?? action.memory?.key
      const matches = key === '__all__' ? memories : memories.filter(item => item.id === action.id || item.subject === key)
      if (!matches.length || (key !== '__all__' && matches.length !== 1)) return null
      action.memoryIds = matches.map(item => item.id)
      break
    }
    default: return null
  }
  if (['complete_task', 'edit_task', 'delete_task'].includes(action.type) && !task) return null
  if (event) action.reviewedEvent = copy(event)
  if (task) action.reviewedTask = copy(task)
  if (action.type === 'forget_memory') action.reviewedMemories = copy(memories.filter(item => action.memoryIds.includes(item.id)))
  return action
}

export function targetsUnchanged(action, { events = [], tasks = [], memories = [] } = {}) {
  if (action.reviewedEvent && !same(events.find(item => item.id === action.id), action.reviewedEvent)) return false
  if (action.reviewedTask && !same(tasks.find(item => item.id === action.id), action.reviewedTask)) return false
  if (action.reviewedMemories && !same(memories.filter(item => action.memoryIds.includes(item.id)), action.reviewedMemories)) return false
  return true
}

export function prepareAssistantResponse(data, context = {}, { requestId, forceReview = false } = {}) {
  if (!object(data) || (data.requestId && String(data.requestId).toLowerCase() !== String(requestId).toLowerCase())) return failure('No pude verificar la respuesta. Inténtalo de nuevo.')
  if (data.smartActionsBlocked || data.smart_actions_blocked) return failure('Las acciones de IA no están disponibles con tu límite actual. Puedes crear el pendiente manualmente.')
  const mode = data.mode || (data.shouldAskUser ? 'clarification' : data.actions?.length ? 'chat_with_action' : 'chat_only')
  const reply = typeof data.reply === 'string' ? data.reply : ''
  if (!['chat_only', 'chat_with_action', 'clarification', 'proposal'].includes(mode)) return failure('No pude verificar la respuesta.')
  if (['chat_only', 'clarification'].includes(mode) || data.shouldAskUser || (data.confidence != null && (!Number.isFinite(data.confidence) || data.confidence < 0.55))) {
    if (claimsExecution(reply)) return failure('No hay cambios guardados que confirmen esa respuesta. Repite la solicitud.')
    return { ok: true, kind: 'chat', message: reply, actions: [] }
  }
  if (data.replacesProposalId && (mode !== 'proposal' || data.replacesProposalId !== context.pendingProposal?.id)) return failure('La propuesta cambió mientras la ajustaba. Conservé la versión actual sin aplicar.')
  if (context.pendingProposal && (mode !== 'proposal' || data.replacesProposalId !== context.pendingProposal.id)) return failure('No pude verificar el ajuste. Conservé la propuesta anterior sin aplicar.')
  const raw = mode === 'proposal' ? data.proposed_actions ?? data.proposedActions : data.actions
  if (!Array.isArray(raw) || !raw.length) return failure('La respuesta no contiene cambios que pueda aplicar.')
  const actions = raw.map((action, index) => normalizeAssistantAction(action, context, `${requestId}:${index}`))
  if (actions.some(action => !action)) return failure('Faltan datos válidos o el elemento ya no existe. Revisa la solicitud; todavía no apliqué cambios.')
  const review = forceReview || mode === 'proposal' || actions.some(action => ['delete_event', 'delete_task', 'save_memory', 'forget_memory'].includes(action.type))
  return { ok: true, kind: review ? 'review' : 'execute', actions, message: review ? 'Preparé una propuesta. Revisa los cambios en la bandeja antes de aplicarlos.' : '' }
}

export function actionLabel(action) {
  switch (action.type) {
    case 'add_event': case 'add_recurring_event': return `Crear: ${action.event.title}`
    case 'edit_event': return `Actualizar: ${action.reviewedEvent?.title || 'evento'}`
    case 'delete_event': return `Eliminar: ${action.reviewedEvent?.title || 'evento'}`
    case 'add_task': return `Crear tarea: ${action.task.label}`
    case 'edit_task': return `Actualizar tarea: ${action.reviewedTask?.label || 'pendiente'}`
    case 'complete_task': return `${action.done ? 'Completar' : 'Reabrir'}: ${action.reviewedTask?.label || 'tarea'}`
    case 'delete_task': return `Eliminar tarea: ${action.reviewedTask?.label || 'pendiente'}`
    case 'save_memory': return `Recordar: ${action.memory.subject || action.memory.content}`
    case 'forget_memory': return `Olvidar ${action.memoryIds.length} ${action.memoryIds.length === 1 ? 'memoria' : 'memorias'}`
    default: return 'Revisar cambio'
  }
}

// A callback must return evidence of a successful local commit. React state
// updates or a prospective model reply are not receipts.
export function applyConfirmedAction(action, handlers = {}, { reviewed = false } = {}) {
  if (!targetsUnchanged(action, handlers)) return failure('El elemento cambió desde la propuesta. Pide una nueva revisión para conservar tus cambios.')
  if (!reviewed && ['delete_event', 'delete_task', 'save_memory', 'forget_memory'].includes(action.type)) return failure('Revisa la propuesta antes de aplicar este cambio.')
  const receipt = (message, value, undo) => ({ ok: true, message, value, undo, action })
  let saved
  switch (action.type) {
    case 'add_event':
      saved = handlers.onAddEvent?.({ ...action.event, id: stableActionIdentifier(action.actionId, 'event') })
      if (saved?.id === stableActionIdentifier(action.actionId, 'event')) return receipt(`Añadí «${saved.title}» en este dispositivo.`, saved, () => handlers.onDeleteEvent?.(saved.id))
      break
    case 'add_recurring_event': {
      const expanded = expandRecurrence(action)
      const receipts = []
      for (const [index, event] of expanded.entries()) {
        const result = applyConfirmedAction({ ...action, type: 'add_event', event, actionId: `${action.actionId}:${index}` }, handlers, { reviewed })
        if (!result.ok) return { ...failure(SAVE_FAILED), receipts }
        receipts.push(result)
      }
      if (receipts.length) return { ...receipt(`Añadí ${receipts.length} eventos en este dispositivo.`, receipts.map(item => item.value), () => receipts.forEach(item => item.undo?.())), receipts }
      break
    }
    case 'edit_event':
      saved = handlers.onEditEvent?.(action.id, action.updates)
      if (saved?.id === action.id) return receipt('Actualicé el evento en este dispositivo.', saved)
      break
    case 'delete_event':
      if (handlers.onDeleteEvent?.(action.id) === true) return receipt('Eliminé el evento en este dispositivo.', action.id)
      break
    case 'add_task':
      saved = handlers.onAddTask?.({ ...action.task, id: stableActionIdentifier(action.actionId, 'task') })
      if (saved?.id === stableActionIdentifier(action.actionId, 'task')) return receipt(`Añadí la tarea «${saved.label}» en este dispositivo.`, saved, () => handlers.onDeleteTask?.(saved.id))
      break
    case 'complete_task':
      saved = handlers.onUpdateTask?.(action.id, { done: action.done })
      if (saved?.id === action.id && saved.done === action.done) return receipt(action.done ? 'La tarea está completada.' : 'La tarea está pendiente.', saved)
      break
    case 'edit_task':
      saved = handlers.onUpdateTask?.(action.id, action.updates)
      if (saved?.id === action.id) return receipt('Actualicé la tarea en este dispositivo.', saved)
      break
    case 'delete_task':
      if (handlers.onDeleteTask?.(action.id) === true) return receipt('Eliminé la tarea en este dispositivo.', action.id)
      break
    case 'save_memory':
      saved = handlers.onAddMemory?.({ ...action.memory, id: stableActionIdentifier(action.actionId, 'memory') })
      if (saved?.id) return receipt('Guardé la memoria en este dispositivo.', saved, () => handlers.onDeleteMemory?.(saved.id))
      break
    case 'forget_memory':
      if (handlers.onDeleteMemories?.(action.memoryIds) === true) return receipt('Olvidé las memorias seleccionadas en este dispositivo.', action.memoryIds)
      break
    default: break
  }
  return failure(SAVE_FAILED)
}

export function applyAssistantActions(actions, handlers) {
  const receipts = []
  for (const action of actions) {
    const result = applyConfirmedAction(action, handlers)
    if (!result.ok) return { ...result, receipts: [...receipts, ...(result.receipts || [])] }
    receipts.push(result)
  }
  return { ok: true, receipts, message: receipts.map(item => item.message).join('\n') }
}

export function enqueueAssistantReview(actions, onProposeActions, options = {}) {
  const saved = onProposeActions?.(actions, { ...options, reply: 'Propuesta pendiente de revisión.' })
  if (!Array.isArray(saved) || saved.length !== actions.length) return failure('No pude guardar toda la propuesta. Revisa la bandeja antes de repetirla.')
  return { ok: true, message: 'Preparé una propuesta. Revisa los cambios en la bandeja antes de aplicarlos.', actions }
}

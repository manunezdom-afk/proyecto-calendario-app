import { normalizeAssistantAction, actionLabel, applyConfirmedAction, stableActionIdentifier } from './assistantContract.js'

const ICONS = {
  add_event: 'add_circle', add_recurring_event: 'event_repeat', edit_event: 'edit_calendar',
  delete_event: 'delete', add_task: 'check_box', edit_task: 'edit', complete_task: 'task_alt',
  delete_task: 'delete', save_memory: 'psychology', forget_memory: 'delete',
}

export function actionToSuggestion(raw, { reason, batchId, events = [], tasks = [], memories = [] } = {}) {
  const context = { events, tasks, memories }
  // A prepared response already carries the snapshot captured before review.
  const action = raw?.actionId && (raw.reviewedEvent || raw.reviewedTask || raw.reviewedMemories)
    ? raw : normalizeAssistantAction(raw, context, raw?.actionId || crypto.randomUUID())
  if (!action) return null
  const payload = { ...action }
  delete payload.type
  const entity = action.event || action.task || action.updates || {}
  const details = [entity.date, entity.time, entity.endTime, entity.location, entity.priority].filter(Boolean)
  if (action.type === 'save_memory') details.push(action.memory.content)
  if (action.type === 'forget_memory') details.push(...action.reviewedMemories.map(item => item.subject || item.content))
  if (action.type === 'add_recurring_event') details.push({ daily: 'Todos los días', weekdays: 'De lunes a viernes', weekly: 'Cada semana' }[action.recurrence.pattern])
  if (action.type === 'edit_task') {
    if (entity.date === null) details.push('Sin fecha')
    else if (entity.time === null) details.push('Sin hora')
  }
  return {
    id: stableActionIdentifier(action.actionId, 'suggestion'), kind: action.type, payload,
    reason: reason || null, batchId: batchId || null, previewIcon: ICONS[action.type] || 'auto_awesome',
    previewTitle: actionLabel(action), previewBody: details.join(' · ') || 'Revisa este cambio antes de aplicarlo.',
  }
}

export function applySuggestion(suggestion, handlers = {}) {
  if (!suggestion) return { ok: false, message: 'La propuesta ya no existe.' }
  const payload = suggestion.payload || {}
  const raw = { ...payload, type: suggestion.kind }
  // Old persisted proposals lack a reviewed snapshot. Never silently execute
  // a legacy destructive target; requesting a fresh plan is safe and explicit.
  if (['delete_event', 'delete_task', 'forget_memory'].includes(raw.type) &&
      !raw.reviewedEvent && !raw.reviewedTask && !raw.reviewedMemories) {
    return { ok: false, message: 'Esta propuesta antigua necesita una nueva revisión. Pide el cambio de nuevo.' }
  }
  const action = raw.actionId ? raw : normalizeAssistantAction(raw, handlers, suggestion.id)
  if (!action) return { ok: false, message: 'No pude verificar los datos de esta propuesta.' }
  return applyConfirmedAction(action, handlers, { reviewed: true })
}

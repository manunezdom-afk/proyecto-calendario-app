// A pending calendar plan is review context, never saved calendar state.
const fields = ['title', 'date', 'time', 'endTime', 'location', 'subtitle', 'reminderOffsets', 'reminderNotes']
const clone = value => JSON.parse(JSON.stringify(value))
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

export const PROPOSAL_CONTEXT_LIMIT = 'La propuesta llegó al límite de ajustes. La conservé sin aplicar; descártala y pide una planificación nueva con todos tus requisitos.'

// JS string length counts UTF-16 units, matching the native/wire limit.
// Call only for an accepted replacement; retries reuse the previous snapshot.
export function appendProposalRequest(previous, message) {
  if (typeof previous !== 'string' || typeof message !== 'string') return null
  const combined = previous + '\n' + message
  return combined.length <= 4000 ? combined : null
}

export function pendingCalendarAction(raw) {
  if (!raw || !['add_event', 'edit_event'].includes(raw.type)) return null
  const source = raw.type === 'add_event' ? raw.event : raw.updates
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const value = Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, clone(source[key])]))
  if (raw.type === 'edit_event') return typeof raw.id === 'string' && raw.id ? { type: raw.type, id: raw.id, updates: value } : null
  return { type: raw.type, event: value }
}

export function pendingCalendarProposal(suggestions = []) {
  const groups = new Map()
  for (const item of suggestions) {
    if (!item.batchId) continue
    if (!groups.has(item.batchId)) groups.set(item.batchId, [])
    groups.get(item.batchId).push(item)
  }
  for (const [id, items] of groups) {
    if (id.length > 128 || !items.length || items.length > 12 || items.some(item => item.status !== 'pending')) continue
    const originalRequest = items[0].payload?.proposalContext?.originalRequest
    if (typeof originalRequest !== 'string' || !originalRequest.trim() || originalRequest.length > 4000) continue
    if (items.some(item => item.payload?.proposalContext?.id !== id || item.payload.proposalContext.originalRequest !== originalRequest)) continue
    const actions = items.map(item => pendingCalendarAction({ ...item.payload, type: item.kind }))
    if (actions.some(action => !action)) continue
    return { id, originalRequest, actions }
  }
  return null
}

// Prepare one cache replacement. The caller commits this collection once and
// reports success only after that write. A resolved/changed batch fails closed.
export function prepareProposalBatch(current, incoming, { replacesProposalId, expectedProposal } = {}) {
  if (!Array.isArray(incoming) || !incoming.length || incoming.some(item => !item?.id)) return null
  const ids = new Set(incoming.map(item => item.id))
  if (ids.size !== incoming.length) return null
  const existing = current.filter(item => ids.has(item.id))
  if (existing.length) {
    return existing.length === incoming.length && existing.every(item => item.status === 'pending') &&
      existing.every(item => same(item.payload, incoming.find(next => next.id === item.id)?.payload))
      ? { next: current, saved: existing, changed: [] } : null
  }
  let retired = []
  if (replacesProposalId) {
    const pending = pendingCalendarProposal(current)
    if (!expectedProposal || expectedProposal.id !== replacesProposalId || !same(pending, expectedProposal)) return null
    retired = current.filter(item => item.batchId === replacesProposalId)
    if (!retired.length || retired.some(item => item.status !== 'pending')) return null
  }
  const now = new Date().toISOString()
  const saved = incoming.map(item => ({ ...item, status: 'pending', createdAt: now, resolvedAt: null }))
  const retiredIDs = new Set(retired.map(item => item.id))
  const resolved = retired.map(item => ({ ...item, status: 'rejected', resolvedAt: now }))
  const resolvedByID = new Map(resolved.map(item => [item.id, item]))
  return { next: [...saved, ...current.map(item => retiredIDs.has(item.id) ? resolvedByID.get(item.id) : item)], saved, changed: [...saved, ...resolved] }
}

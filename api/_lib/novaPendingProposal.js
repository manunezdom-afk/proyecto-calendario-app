// Draft calendar blocks are data awaiting review. They are never merged into
// saved events and cannot supply authority for execution or destructive work.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const bounded = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const civilDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T12:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function pendingClockMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  if (match[3]) {
    if (hour < 1 || hour > 12) return null
    hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0)
  } else if (hour > 23 || !match[2]) return null
  return hour * 60 + Number(match[2] || 0)
}
function fields(raw, partial = false) {
  if (!object(raw)) return null
  const allowed = ['title', 'date', 'time', 'endTime', 'subtitle', 'reminderOffsets']
  const result = Object.fromEntries(allowed.filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]]))
  if (!partial && !['title', 'date', 'time'].every(key => Object.hasOwn(result, key))) return null
  if ('title' in result && !bounded(result.title, 120)) return null
  if ('date' in result && !civilDate(result.date)) return null
  if ('time' in result && pendingClockMinutes(result.time) === null) return null
  if (result.endTime != null && pendingClockMinutes(result.endTime) === null) return null
  if (result.subtitle != null && (typeof result.subtitle !== 'string' || result.subtitle.length > 300)) return null
  if (result.reminderOffsets != null && (!Array.isArray(result.reminderOffsets) || result.reminderOffsets.length > 5 ||
      !result.reminderOffsets.every(value => Number.isInteger(value) && value >= 0 && value <= 10080))) return null
  return result
}
export function sanitizePendingProposal(raw, events = []) {
  if (!object(raw) || typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(raw.id) || !bounded(raw.originalRequest, 4000) ||
      !Array.isArray(raw.actions) || raw.actions.length < 1 || raw.actions.length > 12 ||
      Buffer.byteLength(JSON.stringify(raw), 'utf8') > 12000) return null
  const actions = []
  for (const action of raw.actions) {
    if (!object(action)) return null
    if (action.type === 'add_event') {
      const event = fields(action.event)
      if (!event) return null
      actions.push({ type: 'add_event', event })
    } else if (action.type === 'edit_event') {
      const original = events.find(event => event?.id === action.id)
      const updates = fields(action.updates, true)
      if (!original || !updates || !Object.keys(updates).length || !fields({ ...original, ...updates })) return null
      actions.push({ type: 'edit_event', id: original.id, updates })
    } else return null
  }
  return { id: raw.id, status: 'not_saved', originalRequest: raw.originalRequest.trim(), actions }
}
export function activePendingProposal(message, raw, events = []) {
  const pending = sanitizePendingProposal(raw, events)
  if (!pending) return null
  const original = norm(pending.originalRequest), current = norm(message)
  if (!/\b(?:organiz\w*|orden\w*|planific\w*|reorganiz\w*|distribu\w*|armame)\b/.test(original) ||
      !/\b(?:dia|hoy|manana|tarde|semana|horario|agenda)\b/.test(original) ||
      /\bno (?:quiero que |me )?(?:organiz\w*|orden\w*|planifi\w*)\b/.test(original)) return null
  // A new objective, consent, deletion, or memory statement never inherits
  // an old planning request. Only an explicit scheduling refinement does.
  if (/\b(?:otra cosa|nuevo tema|olvida|borra|elimina|cancela|guarda|aplica|confirmo|recuerda que|aprende que)\b/.test(current)) return null
  const refinement = /\b(?:ajusta\w*|refina\w*|reorganiza\w*|redistribuye\w*)\b/.test(current) ||
    /\b(?:mejor|mueve|muevelo|cambia|cambialo|adelanta\w*|atrasa\w*)\b/.test(current) && /\b(?:las?|am|pm|antes|despues|manana|hoy|tarde|horario|plan|propuesta|bloque)\b|\d{1,2}:\d{2}/.test(current) ||
    /\b(?:no|nunca)\b[^.!?]{0,80}\b(?:antes|despues)\s+(?:de\s+)?(?:las?\s+)?\d{1,2}\b/.test(current) ||
    /\b(?:deja\w*|mant[eé]n|respeta)\b[^.!?]{0,60}\b(?:libre|fij[oa]|horario|limite)\b/.test(current)
  return refinement ? pending : null
}
export function pendingProposalSchedules(pending, events = []) {
  return (pending?.actions || []).map(action => {
    const event = action.type === 'add_event' ? action.event : { ...events.find(item => item.id === action.id), ...action.updates }
    const start = pendingClockMinutes(event.time), end = pendingClockMinutes(event.endTime)
    return { ...event, id: action.type === 'edit_event' ? action.id : undefined,
      duration: start !== null && end !== null && end > start ? end - start : 0 }
  })
}

// A refinement replaces the entire pending calendar batch. Do not silently
// drop a block, add a new objective, convert an edit into a duplicate, or alter
// allocations while satisfying a new cutoff. Unsupported changes ask again.
export function pendingReplacementIssues(pending, actions, events = []) {
  if (actions.some(action => !['add_event', 'edit_event'].includes(action.type))) return ['pending_proposal_non_calendar_action']
  const expected = pendingProposalSchedules(pending, events)
  const actual = pendingProposalSchedules({ actions }, events)
  const totals = schedules => {
    const groups = new Map()
    for (const block of schedules) {
      const key = block.id ? `edit:${block.id}` : `add:${norm(block.title)}`
      const group = groups.get(key) || { duration: 0, count: 0, dates: new Set() }
      group.duration += block.duration; group.count++
      group.dates.add(block.date)
      groups.set(key, group)
    }
    return groups
  }
  const before = totals(expected), after = totals(actual)
  if (before.size !== after.size || [...before.keys()].some(key => !after.has(key))) return ['pending_proposal_incomplete_replacement']
  if ([...before].some(([key, value]) => value.duration !== after.get(key).duration ||
      (key.startsWith('edit:') || value.duration === 0) && value.count !== after.get(key).count)) return ['pending_proposal_duration_changed']
  if ([...before].some(([key, value]) => value.dates.size !== after.get(key).dates.size ||
      [...value.dates].some(date => !after.get(key).dates.has(date)))) return ['pending_proposal_date_changed']
  return []
}

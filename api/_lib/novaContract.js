import { createHash } from 'node:crypto'
import { hasExplicitEditIntent, hasExplicitDeleteIntent } from './calendarIntent.js'
import { userMentionedExplicitDuration, userAskedToBlockTime } from './durations.js'
import { addCivilDays, validTimezone } from './dateContext.js'
import { activePendingProposal, pendingProposalSchedules, pendingReplacementIssues } from './novaPendingProposal.js'

export const NOVA_ACTION_TYPES = Object.freeze(['create_event', 'create_reminder', 'create_task',
  'edit_event', 'delete_event', 'edit_task', 'complete_task', 'delete_task',
  'save_memory', 'forget_memory', 'chat_only', 'clarify'])
export const NOVA_MODES = Object.freeze(['chat_only', 'chat_with_action', 'proposal', 'clarification', 'confirmation'])
const nullableString = { type: ['string', 'null'] }
const actionProperties = {
  type: { type: 'string', enum: NOVA_ACTION_TYPES }, title: { type: 'string' },
  subtitle: nullableString, dateText: { type: 'string' }, dateISO: nullableString,
  time: nullableString, durationMinutes: { type: 'integer' },
  category: { type: 'string', enum: ['personal', 'universidad', 'salud', 'reunion', 'estudio', 'otro'] },
  reminderOffsetMinutes: { type: ['integer', 'null'] }, linkedToPreviousEvent: { type: 'boolean' },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, sourceText: { type: 'string' },
  targetEventId: nullableString, targetTaskId: nullableString, done: { type: ['boolean', 'null'] },
  priority: { type: ['string', 'null'] },
  memoryKey: nullableString, memoryValue: nullableString, memoryCategory: nullableString,
}
const actionSchema = { type: 'object', additionalProperties: false,
  required: Object.keys(actionProperties), properties: actionProperties }
export const NOVA_PLAN_SCHEMA = Object.freeze({
  name: 'nova_actions', strict: true,
  schema: { type: 'object', additionalProperties: false,
    required: ['mode', 'actions', 'needsClarification', 'clarificationQuestion', 'userConfirmationText'],
    properties: {
      mode: { type: 'string', enum: NOVA_MODES },
      actions: { type: 'array', items: actionSchema },
      needsClarification: { type: 'boolean' }, clarificationQuestion: nullableString,
      userConfirmationText: { type: 'string' },
    },
  },
})

export const validCivilDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
}
export const validClockTime = value => typeof value === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value)
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const bounded = (value, max, allowEmpty = false) => typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0)
const pastClaim = /\b(?:guard[eé]|agend[eé]|cre[eé]|borr[eé]|elimin[eé]|mov[ií]|actualic[eé]|registr[eé]|complet[eé]|he (?:creado|guardado|borrado)|te (?:lo )?recordar[eé]|te (?:voy a |lo voy a )?recordar|te avisar[eé]|voy a avisarte)\b/i
const defaultQuestion = 'No pude preparar ese cambio con seguridad. ¿Me das un poco más de detalle?'
const negativeMutation = text => /\b(?:no|nunca|jamas)\s+(?:lo\s+|la\s+|me\s+)?(?:borres?|elimin\w*|cancel\w*|quit\w*|muev\w*|cambi\w*|edit\w*|guard\w*|agend\w*|crees?|olvides?)\b/.test(norm(text))
const speculative = text => /\b(?:quizas|tal vez|podriamos|creo que deberia|si pudiera|a lo mejor|estaba pensando|pensaba en|algun dia)\b/.test(norm(text))
const memoryIntent = text => /\b(?:recuerda que|recuerda:|guarda (?:que|esto|mi)|aprende que|prefiero|me gusta|no me gusta|mi \w+ (?:se llama|es)|\w+ es mi \w+|cuando diga|tengo un[ao]? \w+ llamad[oa])\b/.test(norm(text))
const forgetIntent = text => /\b(?:olvida|olvidate|borra|elimina)\b/.test(norm(text)) && !negativeMutation(text)
// Spanish departure shorthand supplies minutes only in a motion utterance;
// quantities such as "en 20 cuotas" are not clock evidence.
export function relativeMotionMinutes(text) {
  const value = norm(text)
  if (!/\b(?:salgo|voy|salir|irme)\b/.test(value)) return null
  const match = value.match(/\ben\s+(\d{1,3})(?=\s+(?:me\s+voy|voy|salgo|tengo\s+que\s+(?:ir|salir))\b|[.!]?$)/)
  const minutes = match ? Number(match[1]) : 0
  return minutes > 0 && minutes <= 180 ? minutes : null
}
const anyTimeSignal = text => relativeMotionMinutes(text) !== null || /\b(?:[012]?\d:[0-5]\d|a las? \w+|de \d{1,2} a \d{1,2}|tipo \w+|en (?:\d+|un[ao]?|dos|tres|media) (?:min\w*|hora\w*)|mediodia|medianoche|\d{1,2}\s*(?:am|pm)|(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|hoy)\s+\d{1,2})\b/.test(norm(text))
const hasLocationTrigger = text => /\bcuando (?:llegue|llegues|salga|salgas|este|estes)\b/.test(norm(text))
function negatedAction(text, type) {
  const verbs = type.startsWith('delete_') ? 'borr|elimin|cancel|quit|desagend'
    : type.startsWith('edit_') ? 'muev|mov|cambi|edit|modific|reagend'
      : type === 'complete_task' ? 'complet|termin|marc'
        : type === 'forget_memory' ? 'olvid|borr|elimin' : 'guard|agend|crea|crees|anot'
  return new RegExp(`\\b(?:no|nunca|jamas)\\s+(?:(?:lo|la|los|las|me|quiero|quieras|debes|debemos|he|hemos|voy a|vayas a)\\s+){0,3}(?:${verbs})[a-z]*\\b`).test(norm(text))
}
function oneTypoApart(left, right) {
  if (Math.min(left.length, right.length) < 5 || Math.abs(left.length - right.length) > 1) return false
  let a = 0, b = 0, edits = 0
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) { a++; b++; continue }
    if (++edits > 1) return false
    if (left.length >= right.length) a++
    if (right.length >= left.length) b++
  }
  return edits + (left.length-a) + (right.length-b) <= 1
}
// Short infinitives need an activity at the start (optionally after a date),
// rather than matching incidental mentions in questions or personal facts.
const shortTaskIntent = text => /^(?:por favor[, ]+)?(?:(?:hoy|manana|pasado manana|esta (?:manana|tarde|noche)|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo))(?: por la (?:manana|tarde|noche))?[, :]?\s+)?(?:ver|ir|dar)\s+\S/.test(norm(text))
const negatedShortTask = text => /\b(?:no|nunca|jamas)\s+(?:(?:quiero|puedo|debo|voy a)\s+)?(?:ver|ir|dar)\b/.test(norm(text))
const createIntent = text => !negatedShortTask(text) && (/\b(?:necesito|tengo que|debo|quiero|anota|agend\w*|crea\w*|agrega\w*|recuerd\w*|acuerd\w*|avis\w*|pendiente|tarea|no olvidar|[a-z]{3,}(?:ar|er|ir))\b/.test(norm(text)) || shortTaskIntent(text))
const conversational = text => /^(?:[¿?]\s*)?(?:ayudame a (?:ordenar|organizar|priorizar)|no se (?:por donde|como) empezar|que (?:es mejor|deberia|conviene)|por donde (?:empiezo|empezar))\b/.test(norm(text))
// A conversational question is not a missing field in a capture. Recover only
// explicit capture requests mislabeled chat_only; keep advice in the chat flow.
const captureRequest = text => !conversational(text) && !negatedShortTask(text) && (/^(?:por favor[, ]+)?(?:necesito|tengo que|debo|quiero|anota|agend\w*|crea\w*|agrega\w*|ponme|recuerd\w*|acuerd\w*|avis\w*|pendiente|tarea|no olvidar|[a-z]{3,}(?:ar|er|ir))\b/.test(norm(text)) || shortTaskIntent(text))
const informational = text => /^(?:que (?:tengo|hay|sabes|recuerdas)|cuales|como (?:voy|estan)|muestrame|dime (?:que|mis)|ordena|organiza|resume|resumen)\b/.test(norm(text))
const planningIntent = text => /\b(?:organizame|organiza|orden\w*|planificame|planifica|reorganiza\w*|distribuye|armame)\b/.test(norm(text))
  && /\b(?:dia|hoy|manana|tarde|semana|horario|agenda)\b/.test(norm(text))
  && !/\bno (?:quiero que |me )?(?:organiz\w*|orden\w*|planifi\w*)\b/.test(norm(text))
function clockMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0)
  return hour * 60 + Number(match[2] || 0)
}
function planningIssues(schedules, events, scope, dateContext) {
  const issues = new Set()
  const text = norm(scope)
  const edited = new Set(schedules.map(item => item.id).filter(Boolean))
  const fixed = events.filter(event => !edited.has(event.id)).map(event => {
    const [start, rangeEnd] = String(event.time || '').split(/\s+-\s+/)
    const from = clockMinutes(start), to = clockMinutes(event.endTime || rangeEnd)
    return { date: event.date, from, to: to != null && to > from ? to : from, title: event.title }
  }).filter(event => event.from != null)
  const intervals = []
  const day = !/\bsemana\b/.test(text) ? expectedCivilDate(text, dateContext) : null
  for (const item of schedules) {
    const from = clockMinutes(item.time), to = from + item.duration
    if (from == null || to > 1440) { issues.add('invalid_planned_interval'); continue }
    if (day && item.date !== day) issues.add('planned_date_conflict')
    for (const match of text.matchAll(/\bno\s+([^.;,]{0,80}?)\b(antes|despues)\s+(?:de\s+)?(?:las?\s*)?(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?/g)) {
      let hour = Number(match[3])
      if (match[5]) hour = hour % 12 + (match[5] === 'pm' ? 12 : 0)
      else if (match[2] === 'despues' && hour < 12) hour += 12
      const bound = hour * 60 + Number(match[4] || 0)
      const specific = /\bestudi\w*\b/.test(match[1]) ? /\bestudi\w*\b/.test(norm(item.title)) : true
      if (specific && (match[2] === 'antes' ? from < bound : to > bound)) issues.add('planned_time_constraint')
    }
    const freeNight = text.match(/(?:deja\w*|dej\w*)[^.;]{0,100}\bnoche\b[^.;]{0,20}\blibres?\b/)
    if (freeNight && (from >= 18 * 60 || to > 18 * 60)) {
      const weekdays = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado']
      if (freeNight[0].includes(weekdays[new Date(`${item.date}T12:00Z`).getUTCDay()])) issues.add('planned_free_period_conflict')
    }
    const overlaps = other => other.date === item.date && (from === other.from
      || to > from && other.from >= from && other.from < to
      || other.to > other.from && from >= other.from && from < other.to)
    if (fixed.some(overlaps) || intervals.some(overlaps)) issues.add('planned_schedule_conflict')
    intervals.push({ date: item.date, from, to, title: item.title })
  }
  // Enforce a stated work block when its activity is explicitly nearby. This
  // does not infer a duration for an unnamed activity or convert a vague wish.
  const numbers = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }
  if (!schedules.length) return [...issues]
  for (const match of text.matchAll(/\b(\d{1,2}|una|un|dos|tres|cuatro|cinco|seis) horas?\b/g)) {
    const required = (numbers[match[1]] || Number(match[1])) * 60
    const start = Math.max(text.lastIndexOf(',', match.index), text.lastIndexOf(';', match.index), 0)
    const end = text.indexOf(',', match.index + match[0].length)
    const clause = text.slice(start, end < 0 ? text.length : end)
    const offset = match.index - start
    const after = text.slice(match.index + match[0].length)
    const explicitSubject = after.match(/^\s+(?:con|de|para|en)\s+(.{1,60}?)(?=\s+y\s+|[.;,]|$)/)?.[1]?.trim()
    const subjectStem = explicitSubject?.match(/[a-z]{3,}/)?.[0]?.replace(/(?:ar|er|ir|io|o)$/, '')
    const candidates = [...new Set(schedules.map(item => norm(item.title)))].map(title => {
      const word = title.match(/[a-z]{4,}/)?.[0]?.replace(/(?:ar|er|ir|io|o)$/, '')
      const position = word ? clause.indexOf(word) : -1
      return { title, distance: subjectStem ? title.includes(subjectStem) ? 0 : Infinity
        : position < 0 ? Infinity : Math.abs(position - offset) }
    }).sort((a,b) => a.distance-b.distance)
    const candidate = candidates[0]
    if (subjectStem && (!candidate || !Number.isFinite(candidate.distance))) { issues.add('planned_missing_activity'); continue }
    if (!candidate || candidate.distance > 60 || candidates[1]?.distance === candidate.distance) continue
    const minutes = schedules.filter(item => norm(item.title) === candidate.title).reduce((sum,item) => sum+item.duration,0)
    const prefix = text.slice(Math.max(start,match.index-30),match.index)
    const minimum = /(?:minimo|al menos)\s*$/.test(prefix)
    const maximum = /(?:maximo|no mas de)\s*$/.test(prefix)
    if (maximum ? minutes > required : minimum ? minutes < required : minutes !== required) issues.add('planned_duration_constraint')
  }
  return [...issues]
}
function groundedTitle(title, source, memories) {
  const ignored = new Set(['para','con','sin','una','uno','las','los','del','que','por','hoy','manana','tarea','evento','recordatorio','reunion'])
  const words = norm(title).match(/[a-z0-9]{3,}/g)?.filter(w => !ignored.has(w)) || []
  const evidence = norm(source + ' ' + memories.map(m => typeof m === 'string' ? m : m?.content || '').join(' '))
    .replace(/\bgym\b/g, 'gimnasio gym')
  return words.length > 0 ? words.some(word => evidence.includes(word)
    || evidence.split(/\W+/).some(candidate => oneTypoApart(word, candidate))) : evidence.includes(norm(title))
}
function groundedTarget(id, items, scope, discussed) {
  const item = items.find(candidate => candidate.id === id)
  if (!item) return false
  const title = norm(item.title || item.label)
  if (!title) return true // Transport fixtures may only supply an ID.
  const sameName = items.filter(candidate => norm(candidate.title || candidate.label) === title)
  if (sameName.length > 1 && !scope.includes(id) && !(item.date && scope.includes(item.date))) return false
  if (groundedTitle(title, scope, [])) return true
  return /\b(?:eso|esa|ese|este|esta|anterior|ultimo|muevelo|cambialo|borralo|eliminalo|completalo)\b/.test(norm(scope))
    && (items.length === 1 || discussed.length === 1 && discussed[0] === id)
}
export function civilTimeOccurrences(date, time, timezone) {
  if (!validCivilDate(date) || !validClockTime(time) || !validTimezone(timezone)) return 0
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const target = `${date} ${time.padStart(5, '0')}`
  const center = Date.parse(`${date}T${time.padStart(5, '0')}:00Z`)
  let matches = 0
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const parts = Object.fromEntries(formatter.formatToParts(center + offset * 60_000).map(p => [p.type, p.value]))
    if (`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` === target) matches++
  }
  return matches
}
function expectedCivilDate(source, context) {
  if (!context?.todayISO) return null
  const value = norm(source)
  const exact = value.match(/\b\d{4}-\d{2}-\d{2}\b/)
  if (exact) return exact[0]
  if (/\bpasado manana\b/.test(value)) return context.dayAfter
  if (/\bmanana\b/.test(value) && !/\b(?:la|por la|de la) manana\b/.test(value)) return context.tomorrow
  if (/\bhoy\b/.test(value)) return context.todayISO
  if (/\bayer\b/.test(value)) return addCivilDays(context.todayISO, -1)
  return null
}

function to12h(time) {
  const [h, m] = time.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
function endAt(time, duration) {
  const [h, m] = time.split(':').map(Number)
  const total = (h * 60 + m + duration) % 1440
  return to12h(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`)
}

// Small schema validator: the wire schema intentionally uses only these types.
// No coercion/defaulting of malformed model output is allowed in strict mode.
function matchesSchema(value, schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (!types.includes(type) && !(types.includes('integer') && Number.isInteger(value))) return false
  if (schema.enum && !schema.enum.includes(value)) return false
  if (type === 'object') {
    if (!plainObject(value)) return false
    if (schema.required?.some(key => !Object.hasOwn(value, key))) return false
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false
    return Object.entries(value).every(([key, item]) => !schema.properties?.[key] || matchesSchema(item, schema.properties[key]))
  }
  if (type === 'array') return value.every(item => matchesSchema(item, schema.items))
  return type !== 'number' || Number.isFinite(value)
}
export const isNovaWirePlan = payload => matchesSchema(payload, NOVA_PLAN_SCHEMA.schema)

function confirmedPendingOffer(message, history) {
  if (!/^(?:si|dale|ok|vale|claro|hazlo|confirmo)[.!]?$/i.test(norm(message))) return null
  const last = history.at(-1), previous = history.at(-2)
  if (last?.role !== 'assistant' || previous?.role !== 'user' || !/\?\s*$/.test(last.content || '')
    || pastClaim.test(norm(last.content)) || /\b(?:listo|hecho|guardado|agendado|algo mas)\b/.test(norm(last.content))) return null
  // An explicit user capture must precede the offer. Assistant prose alone,
  // quoted instructions and already completed receipts never authorize writes.
  if (!captureRequest(previous.content) || speculative(previous.content) || negativeMutation(previous.content)) return null
  const offered = String(last.content || '').trim()
  if (offered.length > 240 || (offered.match(/\?/g) || []).length !== 1
    || /[\n"“”«»]|\b(?:ignora|instrucciones|system|prompt|contrase[nñ]a|token|borra\w*|elimina\w*|olvida\w*|cancela\w*)\b/i.test(offered)) return null
  if (!/^¿?(?:te lo agendo|lo (?:dejo|agendo|programo|guardo|creo)|quieres que (?:lo )?(?:agende|cree|programe))\b/.test(norm(offered))) return null
  return offered
}

export function activeIntentText(message, history = []) {
  const last = history.at(-1)
  // A prior user request is relevant only while answering a clarification.
  // Old delete/duration commands must never authorize an unrelated new turn.
  const continuation = last?.role === 'assistant' && /\?\s*$/.test(last.content || '')
    && String(message).length <= 120 && !/\b(?:hola|gracias|otra cosa|nuevo tema)\b/i.test(message)
    && !/\b(?:listo|hecho|guardado|agendado|algo mas|otra cosa)\b/.test(norm(last.content))
    && !pastClaim.test(norm(last.content))
  if (!continuation) return String(message || '')
  const previous = [...history].reverse().find(item => item?.role === 'user')?.content || ''
  const offer = confirmedPendingOffer(message, history)
  return `${previous}\n${offer ? `${offer}\n` : ''}${message}`
}

/** Single, provider-independent gate. Returns a plan; persistence happens in Focus. */
export function validateNovaPlan({ payload, userMessage = '', history = [], events = [], tasks = [],
  memories = [], discussedEventIds = [], pendingProposal = null, requestId, reqId, dateContext, strict = true } = {}) {
  const id = requestId || reqId || null
  const issues = []
  const reject = code => { issues.push(code) }
  const empty = (reply = defaultQuestion) => ({ reply, actions: [], proposed_actions: [], confidence: 0,
    mode: 'clarification', shouldAskUser: true, requestId: id, smart_actions_blocked: false,
    smart_actions_message: null, follow_up_question: null, execution_pending: false,
    validation: { ok: false, issues: [...new Set(issues)] }, _dropped: [...new Set(issues)] })
  if (!plainObject(payload) || (strict && !isNovaWirePlan(payload))) {
    reject('invalid_schema'); return empty()
  }
  if (!Array.isArray(payload.actions) || (payload.proposed_actions != null && !Array.isArray(payload.proposed_actions))) {
    reject('invalid_actions'); return empty()
  }
  const mode = payload.mode || (payload.actions.length ? 'chat_with_action' : payload.needsClarification ? 'clarification' : 'chat_only')
  if (!NOVA_MODES.includes(mode)) { reject('invalid_mode'); return empty() }
  const incoming = [...payload.actions, ...(payload.proposed_actions || [])]
  if (payload.actions.length && payload.proposed_actions?.length) { reject('mixed_execution_modes'); return empty() }
  if (incoming.length > 12) { reject('too_many_actions'); return empty('Divide la solicitud en grupos de hasta 12 cambios.') }
  if (mode === 'chat_only' && incoming.some(a => !['chat_only', 'clarify'].includes(a?.type))) {
    reject('mode_action_conflict'); return empty()
  }
  if (!bounded(payload.userConfirmationText ?? '', 2000, true)) { reject('invalid_reply'); return empty() }
  const pending = activePendingProposal(userMessage, pendingProposal, events)
  const scope = pending ? String(userMessage) : activeIntentText(userMessage, history)
  const scopeNorm = norm(scope)
  const planning = !!pending || planningIntent(scope)
  const durationAllowed = planning || userMentionedExplicitDuration(scope) || userAskedToBlockTime(scope)
  const eventIds = new Set(events.map(event => event?.id).filter(Boolean))
  const taskIds = new Set(tasks.map(task => task?.id).filter(Boolean))
  const actions = []
  const questions = []
  let destructive = false
  let pastOrAmbiguousTime = false
  const fingerprints = new Set()
  const plannedSchedules = []
  for (const [index, a] of incoming.entries()) {
    if (!plainObject(a) || !NOVA_ACTION_TYPES.includes(a.type)) { reject('invalid_action'); continue }
    if (!['high', 'medium', 'low'].includes(a.confidence)) { reject('invalid_confidence'); continue }
    if (a.type === 'chat_only') continue
    if (a.type === 'clarify') {
      const q = a.title || payload.clarificationQuestion
      if (bounded(q, 400)) questions.push(q)
      else reject('missing_clarification')
      continue
    }
    if (pending && !['create_event', 'edit_event'].includes(a.type)) { reject('pending_proposal_non_calendar_action'); continue }
    if (a.confidence === 'low') { reject('low_confidence'); continue }
    if (speculative(userMessage)) { reject('speculative_intent'); continue }
    if (negatedAction(userMessage, a.type)) { reject('negated_mutation'); continue }
    if (a.dateISO != null && !validCivilDate(a.dateISO)) { reject('invalid_date'); continue }
    if (a.time != null && !validClockTime(a.time)) { reject('invalid_time'); continue }
    if (a.priority != null && !['Alta', 'Media', 'Baja'].includes(a.priority)) { reject('invalid_priority'); continue }
    if (a.durationMinutes != null && (!Number.isInteger(a.durationMinutes) || a.durationMinutes < 0 || a.durationMinutes > 1440)) {
      reject('invalid_duration'); continue
    }
    if (a.reminderOffsetMinutes != null && (!Number.isInteger(a.reminderOffsetMinutes) || a.reminderOffsetMinutes < 0 || a.reminderOffsetMinutes > 10080)) {
      reject('invalid_reminder'); continue
    }
    if (a.subtitle != null && !bounded(a.subtitle, 300, true)) { reject('invalid_subtitle'); continue }
    const source = norm(a.sourceText)
    const shortConfirmation = source === norm(userMessage) && confirmedPendingOffer(userMessage, history) !== null
    if (!source || (source.length < 3 && !shortConfirmation) || !scopeNorm.includes(source)) { reject('missing_intent_evidence'); continue }
    const recentDateCorrection = scope !== userMessage && incoming.length === 1 ? expectedCivilDate(userMessage, dateContext) : null
    const expectedDate = recentDateCorrection || expectedCivilDate(a.sourceText, dateContext)
    if (a.dateISO && expectedDate && a.dateISO !== expectedDate) { reject('date_changed_intent'); continue }
    if (a.dateISO && a.time && dateContext?.tz) {
      const occurrences = civilTimeOccurrences(a.dateISO, a.time, dateContext.tz)
      if (!occurrences) { reject('nonexistent_civil_time'); continue }
      if (occurrences > 1) pastOrAmbiguousTime = true
    }
    if (a.dateISO && dateContext?.todayISO && (a.dateISO < dateContext.todayISO ||
      (a.dateISO === dateContext.todayISO && a.time && a.time.padStart(5, '0') < dateContext.currentTime24))) pastOrAmbiguousTime = true
    let action
    const targetId = a.targetEventId
    const targetTask = a.targetTaskId
    if (['edit_event', 'delete_event'].includes(a.type)) {
      if (!eventIds.has(targetId)) { reject('unknown_event'); continue }
      if ((!planning || a.type === 'delete_event') && !groundedTarget(targetId, events, scope, discussedEventIds)) { reject('ambiguous_event'); continue }
      if (a.type === 'delete_event') {
        if (!hasExplicitDeleteIntent(scope)) { reject('missing_delete_intent'); continue }
        destructive = true
        action = { type: 'delete_event', id: targetId }
      } else {
        const original = events.find(event => event.id === targetId)
        if (planning && [scope, pending?.originalRequest || ''].some(text => norm(text).split(/[.;,]/).some(part => part.includes(norm(original.title))
          && /\b(?:fij[oa]|inamovible|sin mover|no (?:quiero )?mover)\b/.test(part)))) { reject('planned_fixed_event'); continue }
        const requestedReminder = a.reminderOffsetMinutes != null && /\b(?:avis\w*|recuerd\w*|acuerd\w*)\b/.test(scopeNorm)
        if (!planning && !hasExplicitEditIntent(scope) && !requestedReminder) { reject('missing_edit_intent'); continue }
        const updates = {}
        if (a.time) updates.time = to12h(a.time)
        if (a.dateISO) updates.date = a.dateISO
        if (a.subtitle != null) updates.subtitle = a.subtitle.trim()
        if (a.reminderOffsetMinutes != null) updates.reminderOffsets = [a.reminderOffsetMinutes]
        if (a.time && a.durationMinutes > 0 && durationAllowed) updates.endTime = endAt(a.time, a.durationMinutes)
        if (!Object.keys(updates).length) { reject('empty_update'); continue }
        action = { type: 'edit_event', id: targetId, updates }
        if (planning) {
          const [originalTime, originalRangeEnd] = String(original.time || '').split(/\s+-\s+/)
          const originalStart = clockMinutes(originalTime), originalEnd = clockMinutes(original.endTime || originalRangeEnd)
          const duration = a.durationMinutes || (originalStart != null && originalEnd != null && originalEnd > originalStart ? originalEnd-originalStart : 0)
          if (a.time && duration) updates.endTime = endAt(a.time,duration)
          plannedSchedules.push({ id: targetId, title: original.title, date: a.dateISO || original.date,
            time: a.time || originalTime, duration })
        }
      }
    } else if (['edit_task', 'complete_task', 'delete_task'].includes(a.type)) {
      if (!taskIds.has(targetTask)) { reject('unknown_task'); continue }
      if (!groundedTarget(targetTask, tasks, scope, [])) { reject('ambiguous_task'); continue }
      if (a.type === 'delete_task') {
        if (!hasExplicitDeleteIntent(scope)) { reject('missing_delete_intent'); continue }
        destructive = true
        action = { type: 'delete_task', id: targetTask }
      } else if (a.type === 'complete_task') {
        if (typeof a.done !== 'boolean' || !/\b(?:complet|termin|hice|hecho|hecha|list[oa]|pendiente|desmarca|marca)/i.test(scope)) {
          reject('missing_completion_intent'); continue
        }
        const requestedDone = !/\b(?:pendiente|desmarca|reabr|sin completar|no completad)/.test(scopeNorm)
        if (a.done !== requestedDone) { reject('completion_state_conflict'); continue }
        action = { type: 'complete_task', id: targetTask, done: a.done }
      } else {
        if (!hasExplicitEditIntent(scope)) { reject('missing_edit_intent'); continue }
        const updates = {}
        if (a.title && bounded(a.title, 120)) updates.label = a.title.trim()
        if (a.dateISO) updates.date = a.dateISO
        if (a.time) updates.time = a.time.padStart(5, '0')
        if (a.priority && ['Alta', 'Media', 'Baja'].includes(a.priority)) updates.priority = a.priority
        if (!Object.keys(updates).length) { reject('empty_update'); continue }
        action = { type: 'edit_task', id: targetTask, updates }
      }
    } else if (a.type === 'save_memory') {
      if (!memoryIntent(scope) || !bounded(a.memoryKey, 80) || !bounded(a.memoryValue, 240)) { reject('invalid_memory_intent'); continue }
      if (/\b(?:ignora|instrucciones del sistema|system prompt|api.?key|contrase[nñ]a|password|token de acceso)\b/i.test(a.memoryValue)) {
        reject('unsafe_memory'); continue
      }
      const categories = ['personAlias', 'courseAlias', 'preference', 'schedulingRule', 'projectContext', 'academicContext']
      action = { type: 'save_memory', memory: { key: a.memoryKey.trim().toLowerCase(), value: a.memoryValue.trim(),
        category: categories.includes(a.memoryCategory) ? a.memoryCategory : 'preference' } }
    } else if (a.type === 'forget_memory') {
      if (!forgetIntent(scope) || !bounded(a.memoryKey, 80)) { reject('invalid_forget_intent'); continue }
      if (a.memoryKey === '__all__' && !/\b(?:todo|toda|memoria|recuerdos)\b/.test(scopeNorm)) { reject('missing_forget_all_intent'); continue }
      destructive = true
      action = { type: 'forget_memory', memory: { key: a.memoryKey.trim().toLowerCase() } }
    } else {
      if (!bounded(a.title, 120) || /^(?:evento|recordatorio|tarea|horas?|hoy|ma[nñ]ana|\d{1,2}(?::\d{2})?)$/i.test(a.title.trim())) {
        reject('invalid_title'); continue
      }
      const evidence = pending ? `${scope}\n${pendingProposalSchedules(pending, events).map(event => event.title).join('\n')}`
        : planning && a.type !== 'create_task' ? `${scope}\n${tasks.map(task => task.label).join('\n')}` : scope
      if ((!planning && (informational(scope) || conversational(scope))) || !groundedTitle(a.title, evidence, planning ? [] : memories)) { reject('unrequested_creation'); continue }
      if (a.type === 'create_task') {
        if (informational(scope) || conversational(scope)) { reject('unrequested_creation'); continue }
        if (!createIntent(scope)) { reject('missing_create_intent'); continue }
        if (a.time) { reject('task_with_invented_time'); continue }
        const reminderScope = incoming.length === 1 ? scopeNorm : source
        if (/\b(?:avis\w*|recuerd\w*|acuerd\w*)\b/.test(reminderScope)
          && /\b(?:manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo|primera hora|tempranito|noche|tarde)\b/.test(reminderScope)
          && !/\btarea\b/.test(reminderScope)) {
          reject('reminder_needs_time'); continue
        }
        action = { type: 'add_task', task: { label: a.title.trim(), priority: a.priority || 'Media', category: 'hoy',
          linkedEventId: null, parentTaskId: null, date: a.dateISO || null } }
      } else {
        if (!a.dateISO || !a.time) { reject('missing_event_schedule'); continue }
        if (hasLocationTrigger(scope) || (!planning && !anyTimeSignal(scope.replace(/\balas?\s*(?=\d)/gi, 'a las ')))) { reject('missing_exact_time'); continue }
        const reminderSource = incoming.length === 1 ? scopeNorm : source
        if (a.type === 'create_event' && a.reminderOffsetMinutes == null
          && /^(?:por favor[, ]+)?(?:avis\w*|recuerd\w*|acuerd\w*)\b/.test(reminderSource)) {
          reject('reminder_type_conflict'); continue
        }
        const reminder = a.type === 'create_reminder'
        const event = { title: a.title.trim(), date: a.dateISO, time: to12h(a.time),
          endTime: !reminder && a.durationMinutes > 0 && durationAllowed ? endAt(a.time, a.durationMinutes) : null,
          section: ['reunion', 'estudio', 'universidad'].includes(a.category) ? 'focus' : 'evening',
          icon: reminder ? 'alarm' : ({ salud: 'local_hospital', reunion: 'groups', estudio: 'menu_book', universidad: 'menu_book' }[a.category] || 'event') }
        if (a.subtitle?.trim()) event.subtitle = a.subtitle.trim()
        if (a.reminderOffsetMinutes != null) event.reminderOffsets = [a.reminderOffsetMinutes]
        action = { type: 'add_event', event }
        if (planning) plannedSchedules.push({ title: a.title, date: a.dateISO, time: a.time, duration: a.durationMinutes })
      }
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(action)).digest('hex')
    if (fingerprints.has(fingerprint)) { reject('duplicate_action'); continue }
    fingerprints.add(fingerprint)
    if (id) action.actionId = `${id}:${index}`
    actions.push(action)
  }
  if (planning) planningIssues(plannedSchedules, events, scope, dateContext).forEach(reject)
  if (pending && actions.length) {
    // Original constraints remain data about this draft, never sourceText or
    // permission to execute. Validate the revised schedule against both sets.
    planningIssues(plannedSchedules, events, pending.originalRequest, dateContext).forEach(reject)
    pendingReplacementIssues(pending, actions, events).forEach(reject)
  }
  if (issues.includes('reminder_needs_time')) return empty('¿A qué hora quieres que te avise?')
  if (issues.length) return empty(bounded(payload.clarificationQuestion, 400) && /\?/.test(payload.clarificationQuestion)
    && !pastClaim.test(norm(payload.clarificationQuestion)) ? payload.clarificationQuestion : defaultQuestion)
  const implicitQuestion = actions.length === 0 && captureRequest(userMessage)
    ? payload.userConfirmationText?.match(/¿[^?]{1,398}\?/)?.[0] : null
  const needsClarification = payload.needsClarification === true || questions.length > 0 || !!implicitQuestion
  const question = payload.clarificationQuestion || questions[0] || implicitQuestion || null
  if (needsClarification && !bounded(question, 400)) { reject('missing_clarification'); return empty() }
  if (mode === 'clarification' && actions.length) { reject('mode_action_conflict'); return empty() }
  if (pending && needsClarification) return { ...empty(question), validation: { ok: true, issues: [] } }
  const proposed = planning || destructive || pastOrAmbiguousTime || speculative(userMessage) || ['proposal', 'confirmation'].includes(mode) || (payload.proposed_actions?.length || 0) > 0
  if (needsClarification && actions.length && !/[,;\n]|\by\b/.test(scope)) { reject('ambiguous_partial_execution'); return empty() }
  const finalMode = actions.length ? (proposed ? 'proposal' : 'chat_with_action') : (needsClarification ? 'clarification' : 'chat_only')
  let reply = String(payload.userConfirmationText || '').trim()
  if (actions.length) reply = planning ? 'Te propongo este horario. Revisa los bloques y sus duraciones antes de guardarlo.'
    : proposed ? 'Revisa estos cambios antes de aplicarlos.' : 'Preparé estos cambios para guardarlos en Focus.'
  else if (needsClarification) reply = question
  else if (!reply || pastClaim.test(norm(reply)) || /^listo[.!]?$/i.test(reply)) reply = 'No hice cambios. Cuéntame qué necesitas.'
  return { reply, actions: proposed ? [] : actions, proposed_actions: proposed ? actions : [],
    ...(pending && actions.length && proposed && !needsClarification ? { replacesProposalId: pending.id } : {}),
    mode: finalMode, shouldAskUser: needsClarification && !actions.length, confidence: 0.9,
    requestId: id, smart_actions_blocked: false, smart_actions_message: null,
    follow_up_question: actions.length && needsClarification ? question : null,
    execution_pending: actions.length > 0, validation: { ok: true, issues: [] }, _dropped: [] }
}

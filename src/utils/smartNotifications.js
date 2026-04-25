export const DEFAULT_REMINDER_OFFSETS = [10, 30, 60]

const MAX_OFFSET_MIN = 1440

// Personalidades soportadas por la voz del copy (espejo de
// api/_lib/personality.js). Si el valor recibido no es uno de estos, caemos
// a 'focus' silenciosamente.
const SUPPORTED_PERSONALITIES = new Set(['focus', 'cercana', 'estrategica'])
const VALID_URGENCY = new Set(['very-low', 'low', 'normal', 'high'])

const KIND_ASSETS = {
  focus_start:    '/icons/notif-reminder.svg',
  focus_reminder: '/icons/notif-reminder.svg',
  meeting_prep:   '/icons/notif-event.svg',
  leave_now:      '/icons/notif-reminder.svg',
  event_start:    '/icons/notif-event.svg',
  day_before:     '/icons/notif-event.svg',
  event_reminder: '/icons/notif-event.svg',
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function getStartTimeLabel(time) {
  const raw = String(time || '').trim()
  if (!raw) return ''
  return raw.split(/\s*(?:-|–|—)\s*/)[0]?.trim() || raw
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b)
}

function resolvePersonality(value) {
  return SUPPORTED_PERSONALITIES.has(value) ? value : 'focus'
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function buildNotificationUrl(event = {}) {
  const date = isIsoDate(event.date) ? event.date : null
  const params = new URLSearchParams()
  params.set('view', 'day')
  if (date) params.set('date', date)
  return `/?${params.toString()}`
}

function assetForKind(kind) {
  return KIND_ASSETS[kind] || '/icons/icon-192.png'
}

function buildActionsForKind(kind, moment) {
  const snoozeTitle = moment === 'imminent' || moment === 'late' ? '5 min' : 'Luego'

  if (kind === 'focus_start' || kind === 'focus_reminder') {
    return [
      { action: 'open', title: 'Empezar' },
      { action: 'snooze', title: snoozeTitle },
    ]
  }

  if (kind === 'meeting_prep') {
    return [
      { action: 'open', title: 'Preparar' },
      { action: 'snooze', title: snoozeTitle },
    ]
  }

  if (kind === 'leave_now') {
    return [
      { action: 'open', title: 'Ver' },
      { action: 'snooze', title: '5 min' },
    ]
  }

  if (kind === 'day_before') {
    return [
      { action: 'open', title: 'Ver mañana' },
      { action: 'snooze', title: 'Luego' },
    ]
  }

  return [
    { action: 'open', title: 'Abrir' },
    { action: 'snooze', title: snoozeTitle },
  ]
}

export function getNotificationDeliveryProfile({ kind, moment, minsLeft }) {
  const m = Number.isFinite(Number(minsLeft)) ? Number(minsLeft) : 10
  const leadSeconds = Math.max(0, Math.round(m * 60))
  const isCritical =
    moment === 'imminent' ||
    moment === 'late' ||
    kind === 'event_start' ||
    kind === 'focus_start' ||
    kind === 'leave_now'

  const graceSeconds =
    moment === 'late' ? 5 * 60 :
    moment === 'imminent' ? 10 * 60 :
    kind === 'day_before' ? 12 * 60 * 60 :
    30 * 60

  const maxTtl =
    kind === 'day_before' ? 12 * 60 * 60 :
    isCritical ? 30 * 60 :
    6 * 60 * 60

  const ttl = Math.max(60, Math.min(maxTtl, leadSeconds + graceSeconds))
  const urgency =
    isCritical ? 'high' :
    kind === 'day_before' || moment === 'far' ? 'low' :
    'normal'

  const snoozeMinutes =
    moment === 'imminent' || moment === 'late' || kind === 'leave_now' ? 5 :
    kind === 'day_before' ? 60 :
    10

  return {
    ttl,
    urgency: VALID_URGENCY.has(urgency) ? urgency : 'normal',
    renotify: moment !== 'far' && kind !== 'day_before',
    requireInteraction: isCritical,
    snoozeMinutes,
  }
}

export function normalizeReminderOffsets(value, fallback = DEFAULT_REMINDER_OFFSETS) {
  if (!Array.isArray(value)) return [...fallback]

  const offsets = value
    .map((offset) => Number(offset))
    .filter((offset) => Number.isInteger(offset) && offset >= 0 && offset <= MAX_OFFSET_MIN)

  return uniqueSorted(offsets)
}

export function maxLateMinutesForOffset(offset) {
  if (offset <= 0) return 4
  if (offset <= 5) return 4
  if (offset <= 10) return 8
  if (offset <= 30) return 15
  if (offset <= 60) return 25
  if (offset <= 120) return 45
  return 120
}

export function formatDurationShort(minutes) {
  const min = Math.max(0, Math.round(Number(minutes) || 0))
  if (min <= 0) return 'ahora'
  if (min < 60) return min === 1 ? '1 min' : `${min} min`
  if (min < 1440) {
    const hours = Math.floor(min / 60)
    const rest = min % 60
    if (!rest) return hours === 1 ? '1 h' : `${hours} h`
    return `${hours} h ${rest} min`
  }
  const days = Math.round(min / 1440)
  return days === 1 ? '1 día' : `${days} días`
}

export function formatReminderLead(minutes) {
  const min = Math.max(0, Math.round(Number(minutes) || 0))
  if (min <= 0) return 'ahora'
  return `en ${formatDurationShort(min)}`
}

// Momento del push respecto al evento. Permite que el copy varíe no sólo
// por "qué" (kind) sino por "cuán cerca estamos" — la ansiedad de "arranca
// en 2 min" no es la misma que "en 45 min, sin prisa".
//   · far      offset > 30 min
//   · near     5 < offset ≤ 30 min
//   · imminent 0 < offset ≤ 5 min
//   · late     minsLeft ≤ 0 (cron llegó tarde, el evento ya empezó)
export function classifyMoment(minsLeft) {
  const m = Number(minsLeft)
  if (!Number.isFinite(m)) return 'near'
  if (m <= 0) return 'late'
  if (m <= 5) return 'imminent'
  if (m <= 30) return 'near'
  return 'far'
}

export function classifySmartNotification(event = {}, offset = 0, minsLeft = offset) {
  const title = normalizeText(event.title)
  const icon = normalizeText(event.icon)

  const isFocus =
    /\b(foco|focus|deep work|concentracion|concentrar|bloque|estudiar|trabajo profundo)\b/.test(title)
    || icon === 'psychology'

  const isMeeting =
    /\b(reunion|meeting|call|llamada|zoom|meet|demo|1:1|one on one)\b/.test(title)
    || ['groups', 'video_call', 'call'].includes(icon)

  const isMove =
    /\b(gym|gimnasio|entren|dentista|doctor|medico|cita|clase|aeropuerto|viaje|salir)\b/.test(title)
    || ['fitness_center', 'directions_car', 'local_hospital', 'flight'].includes(icon)

  if (minsLeft <= 1 || offset <= 0) {
    if (isFocus) return 'focus_start'
    return 'event_start'
  }

  if (isFocus) return 'focus_reminder'
  if (isMove && minsLeft <= 20) return 'leave_now'
  if (isMeeting && minsLeft <= 20) return 'meeting_prep'
  if (offset >= 1440) return 'day_before'
  return 'event_reminder'
}

// Describe el adelanto/atraso del push en palabras — sensible al momento.
// "en 10 min" es aceptable para far/near, pero sentí la urgencia de
// imminent y el realismo de late. "arranca en 2 min" y "empezó hace 3 min"
// son marcadamente distintos al neutro "en X min".
function formatMomentLead(minsLeft, moment) {
  const absMin = Math.max(0, Math.round(Math.abs(Number(minsLeft) || 0)))
  if (moment === 'late') {
    if (absMin <= 1) return 'empezó ahora'
    return `empezó hace ${formatDurationShort(absMin)}`
  }
  if (moment === 'imminent') {
    if (absMin <= 1) return 'arranca en 1 min'
    return `arranca en ${formatDurationShort(absMin)}`
  }
  return formatReminderLead(minsLeft)
}

// Concatena "X con Y" si hay sujeto conocido. Ej: "Reunión" + "Ana" →
// "Reunión con Ana". Conservador: si el título ya contiene el sujeto (match
// case-insensitive), no lo repetimos.
function titleWithSubject(title, subject) {
  if (!subject) return title
  const t = normalizeText(title)
  const s = normalizeText(subject)
  if (!s || t.includes(s)) return title
  return `${title} con ${subject}`
}

// ── Copy por (kind, personality, moment) ───────────────────────────────────
//
// Tres personalidades × 7 kinds × 3 momentos relevantes = matriz amplia. En
// vez de hardcodear 63 variantes, partimos de un "core" por kind y aplicamos
// matices por personalidad + momento. Mantener los tres tonos distintos sin
// caer en caricatura es la parte delicada; los ejemplos del sistema de Nova
// (ver api/_lib/personality.js) son la referencia estilística.
//
// Reglas transversales:
//   · Máximo 2 oraciones.
//   · Texto plano (sin emojis, sin listas, sin markdown).
//   · El título carga el "qué + cuándo"; el body agrega el "qué hacer".
function buildCopyForKind({ kind, personality, title, subject, minsLeft, moment, startTime }) {
  const p = resolvePersonality(personality)
  const lead = formatMomentLead(minsLeft, moment)
  const niceTitle = titleWithSubject(title, subject)
  const startFragment = startTime ? `Empieza a las ${startTime}.` : ''

  // Helper interno: algunas cosas son comunes; el matiz es qué frase elige
  // cada personalidad para el body.
  const say = {
    focus: {
      focus_start:     () => ({ t: `${niceTitle} empieza ahora`, b: 'Protege el bloque. Empieza por lo crítico.' }),
      focus_reminder:  () => ({ t: `${niceTitle} ${lead}`,       b: 'Deja listo lo que vas a trabajar.' }),
      meeting_prep:    () => ({ t: `${niceTitle} ${lead}`,       b: 'Prepara lo importante antes de entrar.' }),
      leave_now:       () => ({ t: `${niceTitle} ${lead}`,       b: 'Buen momento para salir.' }),
      event_start:     () => ({ t: `${niceTitle} empieza ahora`, b: startFragment || 'Abre Focus para el detalle.' }),
      day_before:      () => ({ t: `${niceTitle} es mañana`,     b: startTime ? `Programado a las ${startTime}.` : 'Queda para mañana.' }),
      event_reminder:  () => ({ t: `${niceTitle} ${lead}`,       b: startFragment || 'Abre Focus para el detalle.' }),
    },
    cercana: {
      focus_start:     () => ({ t: `Tu bloque de foco empieza ya`, b: `${niceTitle}. Cuídalo, empieza por lo importante.` }),
      focus_reminder:  () => ({ t: `Tu bloque de foco ${lead}`,    b: `${niceTitle}. Ten a mano lo que vas a trabajar.` }),
      meeting_prep:    () => ({ t: `Tu ${niceTitle} ${lead}`,      b: 'Una pasada rápida a lo clave antes de entrar.' }),
      leave_now:       () => ({ t: `Tu ${niceTitle} ${lead}`,      b: 'Si te mueves, este es buen momento.' }),
      event_start:     () => ({ t: `${niceTitle} empieza ya`,      b: startFragment || 'Abre Focus cuando puedas.' }),
      day_before:      () => ({ t: `Mañana tienes ${niceTitle}`,   b: startTime ? `Lo dejaste a las ${startTime}.` : 'Quedó para mañana.' }),
      event_reminder:  () => ({ t: `Tu ${niceTitle} ${lead}`,      b: startFragment || 'Te aviso cuando esté cerca.' }),
    },
    estrategica: {
      focus_start:     () => ({ t: `${niceTitle} empieza ahora`,   b: 'Empieza con el punto crítico del bloque.' }),
      focus_reminder:  () => ({ t: `${niceTitle} ${lead}`,         b: 'Define la primera tarea antes de entrar al bloque.' }),
      meeting_prep:    () => ({ t: `${niceTitle} ${lead}`,         b: 'Entra con el punto decisivo ya pensado.' }),
      leave_now:       () => ({ t: `${niceTitle} ${lead}`,         b: 'Salir ahora deja margen para imprevistos.' }),
      event_start:     () => ({ t: `${niceTitle} empieza ahora`,   b: startFragment || 'Abre Focus para el detalle.' }),
      day_before:      () => ({ t: `${niceTitle} es mañana`,       b: startTime ? `A las ${startTime}. Deja el día preparado.` : 'Deja el día preparado.' }),
      event_reminder:  () => ({ t: `${niceTitle} ${lead}`,         b: startFragment || 'Prioriza lo que depende de este bloque.' }),
    },
  }

  const builder = (say[p] && say[p][kind]) || say.focus.event_reminder
  const { t, b } = builder()

  // Matices puntuales por momento que se aplican después del builder.
  // 'late' merece un body distinto del original — avisarte de algo que
  // "en realidad ya empezó" suena raro con el copy normal.
  if (moment === 'late') {
    return {
      title: `${niceTitle} ${lead}`,
      body: p === 'cercana'
        ? 'Ya arrancó. Si lo dejaste pasar, muévelo cuando puedas.'
        : p === 'estrategica'
        ? 'Se cruzó. Decide si entras tarde o lo reagendas.'
        : 'Ya empezó. Entra o muévelo.',
      iconName: iconForKind(kind),
    }
  }

  return { title: t, body: b, iconName: iconForKind(kind) }
}

function iconForKind(kind) {
  switch (kind) {
    case 'focus_start':
    case 'focus_reminder':
      return 'psychology'
    case 'meeting_prep':
      return 'groups'
    case 'leave_now':
      return 'directions_walk'
    case 'day_before':
      return 'event_available'
    default:
      return 'event'
  }
}

// Entry point que llama el cron (o cualquier dispatcher local).
//
// Nuevas opciones respecto a la versión anterior:
//   · personality: 'focus' | 'cercana' | 'estrategica' (default 'focus')
//   · subject:     string | null — sujeto extraído de user_memories. Cuando
//                  existe y no está ya en el título, se inyecta: "Reunión"
//                  + "Ana" → "Reunión con Ana".
//
// Cambio de tag: pasamos de `reminder-${eventId}-${offset}` (una entrada
// por offset) a `reminder-${eventId}` (el SO reemplaza la anterior). Así en
// iPhone el usuario ve UNA sola notificación que se actualiza, en vez de 3
// apiladas cuando un evento tiene offsets [30, 10, 0].
export function buildSmartNotificationPayload(event = {}, options = {}) {
  const {
    offset = 10,
    minsLeft = offset,
    startsAt = null,
    personality = 'focus',
    subject = null,
  } = options

  const title = String(event.title || 'Evento').trim() || 'Evento'
  const startTime = getStartTimeLabel(event.time)
  const actualMins = Math.round(Number(minsLeft))
  const moment = classifyMoment(actualMins)
  const kind = classifySmartNotification(event, offset, Math.max(0, actualMins))
  const delivery = getNotificationDeliveryProfile({ kind, moment, minsLeft: actualMins })
  const icon = assetForKind(kind)
  const url = buildNotificationUrl(event)
  const startsAtISO = startsAt instanceof Date ? startsAt.toISOString() : startsAt
  const timestamp = startsAt instanceof Date
    ? startsAt.getTime()
    : Date.parse(startsAtISO || '')

  const copy = buildCopyForKind({
    kind,
    personality: resolvePersonality(personality),
    title,
    subject: subject && String(subject).trim() ? String(subject).trim() : null,
    minsLeft: actualMins,
    moment,
    startTime,
  })

  const eventId = event.id
  const tag = eventId ? `reminder-${eventId}` : `focus-${kind}-${Date.now()}`

  return {
    title: copy.title,
    body: copy.body,
    url,
    tag,
    icon,
    badge: icon,
    actions: buildActionsForKind(kind, moment),
    ttl: delivery.ttl,
    urgency: delivery.urgency,
    renotify: delivery.renotify,
    requireInteraction: delivery.requireInteraction,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    data: {
      eventId,
      offset,
      kind,
      moment,
      urgency: delivery.urgency,
      ttl: delivery.ttl,
      snoozeMinutes: delivery.snoozeMinutes,
      personality: resolvePersonality(personality),
      subject: subject || null,
      eventTitle: title,
      startsAt: startsAtISO,
      eventDate: isIsoDate(event.date) ? event.date : null,
      section: event.section || null,
      iconName: copy.iconName,
    },
    appIcon: copy.iconName,
  }
}

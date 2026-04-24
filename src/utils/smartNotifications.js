export const DEFAULT_REMINDER_OFFSETS = [10, 30, 60]

const MAX_OFFSET_MIN = 1440

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function getStartTimeLabel(time) {
  const raw = String(time || '').trim()
  if (!raw) return ''
  return raw.split(/\s*(?:-|–|—)\s*/)[0]?.trim() || raw
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b)
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

export function buildSmartNotificationPayload(event = {}, options = {}) {
  const {
    offset = 10,
    minsLeft = offset,
    startsAt = null,
  } = options

  const title = String(event.title || 'Evento').trim() || 'Evento'
  const startTime = getStartTimeLabel(event.time)
  const actualMins = Math.max(0, Math.round(Number(minsLeft) || 0))
  const lead = formatReminderLead(actualMins)
  const kind = classifySmartNotification(event, offset, actualMins)

  const baseBody = startTime
    ? `Empieza a las ${startTime}.`
    : 'Abre Focus para ver el detalle.'

  const copyByKind = {
    focus_start: {
      title: 'Tu bloque de foco empieza ahora',
      body: `${title}. Protege este espacio y empieza por lo importante.`,
      iconName: 'psychology',
    },
    focus_reminder: {
      title: `Bloque de foco ${lead}`,
      body: `${title}. Deja listo lo que necesitas antes de empezar.`,
      iconName: 'psychology',
    },
    meeting_prep: {
      title: `${title} ${lead}`,
      body: 'Prepara lo importante antes de entrar.',
      iconName: 'groups',
    },
    leave_now: {
      title: `${title} ${lead}`,
      body: 'Si tienes que moverte, este es buen momento para salir.',
      iconName: event.icon || 'directions_walk',
    },
    event_start: {
      title: `${title} empieza ahora`,
      body: baseBody,
      iconName: event.icon || 'event',
    },
    day_before: {
      title: `${title} es mañana`,
      body: startTime ? `Lo tienes programado a las ${startTime}.` : 'Lo tienes programado para mañana.',
      iconName: event.icon || 'event_available',
    },
    event_reminder: {
      title: `${title} ${lead}`,
      body: baseBody,
      iconName: event.icon || 'event',
    },
  }

  const copy = copyByKind[kind] || copyByKind.event_reminder
  const eventId = event.id
  const tag = eventId ? `reminder-${eventId}-${offset}` : `focus-${kind}-${Date.now()}`

  return {
    title: copy.title,
    body: copy.body,
    url: '/',
    tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'snooze', title: 'Posponer 10 min' },
    ],
    data: {
      eventId,
      offset,
      kind,
      eventTitle: title,
      startsAt: startsAt instanceof Date ? startsAt.toISOString() : startsAt,
      section: event.section || null,
      iconName: copy.iconName,
    },
    appIcon: copy.iconName,
  }
}

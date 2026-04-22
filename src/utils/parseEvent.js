import { stripFillerPhrases } from './titleCleanup'
import {
  extractExplicitDurationMinutes,
  inferDurationFromTitle,
  composeTimeRange,
} from './eventDuration'

/**
 * Extracts { title, time, date, section, icon, dotColor }
 * from informal Spanish text.
 *
 * Supports colloquial patterns:
 *   "levantarme mañana tipo 7:30 para ir al gimnasio"
 *   "acuérdame que tengo gym a las 6 de la tarde"
 *   "ponme dentista el jueves a las 10 y media"
 *   "agéndame reunión mañana a eso de las 3"
 *   "reunion a las 5 y cuarto"
 */

// ── Icon guesser ──────────────────────────────────────────────────────────────

function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function guessIcon(text) {
  const t = norm(text)
  if (/futbol|deporte|gym|gimnasio|ejercicio|entrena|yoga|correr|nadar|pilates|crossfit|pesas/.test(t)) return 'fitness_center'
  if (/reunion|meeting|llamada|call|videollamada|sincro|junta|zoom|teams/.test(t)) return 'groups'
  if (/almuerzo|comida|cena|desayuno|cafe|restaurante|brunch|pizza|sushi/.test(t)) return 'restaurant'
  if (/estudio|estudiar|clase|tarea|libro|leer|examen|facultad|universidad|curso/.test(t)) return 'menu_book'
  if (/trabajo|proyecto|informe|reporte|presentacion|oficina|cliente/.test(t)) return 'work'
  if (/medico|doctor|cita|dentista|consulta|hospital|clinica|turno/.test(t)) return 'local_hospital'
  if (/compras|supermercado|tienda|mercado|farmacia/.test(t)) return 'shopping_cart'
  if (/cumpleanos|fiesta|celebracion|boda|festejo/.test(t)) return 'cake'
  if (/viaje|vuelo|aeropuerto|hotel|vacaciones|pasaje/.test(t)) return 'flight'
  if (/banco|pago|factura|tramite|cobro/.test(t)) return 'account_balance'
  if (/levantarme|despertarme|despertar|alarma/.test(t)) return 'alarm'
  return 'event'
}

// ── Command prefixes (colloquial Spanish) ─────────────────────────────────────

const COMMAND_PREFIXES = [
  // Recordatorios
  'acu[eé]rdame(?:\\s+de)?',
  'recu[eé]rdame(?:\\s+de)?',
  'me\\s+recuerd[ae]s?(?:\\s+de)?',
  'no\\s+me\\s+dejes\\s+olvidar(?:\\s+de)?',
  // Anotar / agendar
  'anota(?:me)?(?:\\s+un[ao]?)?',
  'me\\s+anot[aá]s?(?:\\s+un[ao]?)?',
  'ag[eé]ndame(?:\\s+un[ao]?)?',
  'agr[eé]game(?:\\s+(?:a\\s+mi\\s+agenda|un[ao]?\\s+evento)?)?',
  // Poner / meter
  'pon(?:me)?(?:\\s+un[ao]?\\s+evento(?:\\s+de)?|\\s+en\\s+(?:mi\\s+)?(?:agenda|calendario))?',
  'met[eé]me(?:\\s+(?:en\\s+(?:la|mi)\\s+agenda|un[ao]?))?',
  // Querer / necesitar
  'quiero(?:\\s+que\\s+me\\s+(?:acu[eé]rdes|recuerdes|anotes)(?:\\s+de)?)?',
  'quiero\\s+(?:un[ao]?\\s+)?(?:evento|recordatorio)(?:\\s+de|\\s+para)?',
  'necesito(?:\\s+recordar)?(?:\\s+que)?',
  // Tener / ir
  'tengo(?:\\s+que)?',
  'voy\\s+a(?:\\s+tener)?',
  // Programar
  'program[aá]me(?:\\s+un[ao]?)?',
  'cre[aá]me(?:\\s+un[ao]?(?:\\s+evento)?)?',
]

const COMMAND_PREFIX_REGEX = new RegExp(`^(?:${COMMAND_PREFIXES.join('|')})\\s+`, 'i')
const LEADING_CONNECTOR_REGEX = /^(?:que|por\s+favor|para\s+que|un[ao]?\s+evento\s+de)\s+/i

// Palabras de contexto "mañana" (hora matutina): si aparecen, horas 5-9 → AM
const MORNING_CONTEXT_RE = /levant[ae]rme?|despert[ae]rme?|despertar|alarm[ae]|madrug[ao]r|mañanero|temprano/i

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function capitalizeFirst(text) {
  if (!text) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatHour(h24, min = 0) {
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(min).padStart(2, '0')} ${period}`
}

function stripIntentPrefixes(text) {
  let cleaned = normalizeWhitespace(text)
  for (let i = 0; i < 5; i++) {
    const before = cleaned
    cleaned = cleaned.replace(COMMAND_PREFIX_REGEX, '').trim()
    cleaned = cleaned.replace(LEADING_CONNECTOR_REGEX, '').trim()
    if (cleaned === before) break
  }
  return normalizeWhitespace(cleaned)
}

// ── Minute fractions (y media, y cuarto, menos cuarto) ───────────────────────

/**
 * Extracts extra minutes from fraction words after a time match.
 * Returns { extraMin, matchStr } or null.
 */
function extractFraction(textAfterHour) {
  const half   = /^\s*y\s+media\b/i
  const qtr    = /^\s*y\s+cuarto\b/i
  const mqtr   = /^\s*menos\s+cuarto\b/i

  if (half.test(textAfterHour))  return { extraMin: 30,  matchStr: textAfterHour.match(half)[0] }
  if (qtr.test(textAfterHour))   return { extraMin: 15,  matchStr: textAfterHour.match(qtr)[0] }
  if (mqtr.test(textAfterHour))  return { extraMin: -15, matchStr: textAfterHour.match(mqtr)[0] }
  return null
}

// ── Time extraction ───────────────────────────────────────────────────────────

/**
 * Tries all colloquial time patterns. Returns { h24, min, fullMatch } or null.
 * @param {string} text
 * @param {boolean} isMorning  - context clue: treat ambiguous hours as AM
 */
function extractTime(text, isMorning = false) {
  // Order matters: most specific first.

  // 1. "a las X de la tarde/noche" → PM
  const pmReg = /a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+(tarde|noche)/i
  let m = text.match(pmReg)
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2] || '0')
    const h24 = h === 12 ? 12 : h + 12
    const frac = extractFraction(text.slice(text.indexOf(m[0]) + m[0].length))
    const extraMin = frac ? frac.extraMin : 0
    const fullMatch = m[0] + (frac ? frac.matchStr : '')
    return { h24, min: Math.max(0, min + extraMin), fullMatch }
  }

  // 2. "a las X de la mañana/madrugada" → AM
  const amReg = /a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+(?:ma[ñn]ana|madrugada)/i
  m = text.match(amReg)
  if (m) {
    const h24 = parseInt(m[1]) % 12
    const min = parseInt(m[2] || '0')
    const frac = extractFraction(text.slice(text.indexOf(m[0]) + m[0].length))
    const extraMin = frac ? frac.extraMin : 0
    const fullMatch = m[0] + (frac ? frac.matchStr : '')
    return { h24, min: Math.max(0, min + extraMin), fullMatch }
  }

  // 3. "a eso de las X", "como a las X", "cerca de las X", "por las X"
  const approxReg = /(?:a\s+eso\s+de\s+las?|como\s+a\s+las?|cerca\s+de\s+las?|por\s+las?)\s+(\d{1,2})(?::(\d{2}))?/i
  m = text.match(approxReg)
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2] || '0')
    const h24 = resolveHour(h, min, isMorning)
    const frac = extractFraction(text.slice(text.indexOf(m[0]) + m[0].length))
    const extraMin = frac ? frac.extraMin : 0
    const fullMatch = m[0] + (frac ? frac.matchStr : '')
    return { h24, min: Math.max(0, min + extraMin), fullMatch }
  }

  // 4. "tipo las X:XX", "tipo X:XX", "tipo X"
  const tipoReg = /tipo\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?/i
  m = text.match(tipoReg)
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2] || '0')
    const h24 = resolveHour(h, min, isMorning)
    const frac = extractFraction(text.slice(text.indexOf(m[0]) + m[0].length))
    const extraMin = frac ? frac.extraMin : 0
    const fullMatch = m[0] + (frac ? frac.matchStr : '')
    return { h24, min: Math.max(0, min + extraMin), fullMatch }
  }

  // 5. "al mediodía"
  if (/al?\s+mediod[íi]a/i.test(text)) {
    return { h24: 12, min: 0, fullMatch: text.match(/al?\s+mediod[íi]a/i)[0] }
  }

  // 6. "a la medianoche"
  if (/a\s+la\s+medianoche/i.test(text)) {
    return { h24: 0, min: 0, fullMatch: text.match(/a\s+la\s+medianoche/i)[0] }
  }

  // 7. Plain "a las X" / "a la X"
  const plainReg = /a\s+las?\s+(\d{1,2})(?::(\d{2}))?/i
  m = text.match(plainReg)
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2] || '0')
    const h24 = resolveHour(h, min, isMorning)
    const frac = extractFraction(text.slice(text.indexOf(m[0]) + m[0].length))
    const extraMin = frac ? frac.extraMin : 0
    const fullMatch = m[0] + (frac ? frac.matchStr : '')
    return { h24, min: Math.max(0, min + extraMin), fullMatch }
  }

  return null
}

/**
 * Resolves an ambiguous hour to 24h format.
 * isMorning=true → hours 5-9 stay as AM.
 * Otherwise: 1-6 → PM (afternoon), 7-12 → AM/noon literal.
 */
function resolveHour(h, min, isMorning) {
  if (h === 0) return 0
  if (h >= 13) return h  // already unambiguous 24h
  if (isMorning && h >= 4 && h <= 11) return h  // wake-up / early morning
  // Default heuristic for Spanish:
  // 1-6 → PM (it's rare to say "a las 5" meaning 5 AM)
  // 7-12 → keep literal (7 AM or noon)
  return h >= 1 && h <= 6 ? h + 12 : h
}

// ── Date extraction ───────────────────────────────────────────────────────────

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function extractDate(text) {
  const today = new Date()
  let date = isoDate(today)   // siempre YYYY-MM-DD — nunca "Hoy" ni "Mañana"
  let cleaned = text

  if (/pasado\s+ma[ñn]ana/i.test(cleaned)) {
    const d = new Date(today); d.setDate(today.getDate() + 2)
    date = isoDate(d)
    cleaned = cleaned.replace(/pasado\s+ma[ñn]ana/i, '')
  } else if (/ma[ñn]ana/i.test(cleaned)) {
    const d = new Date(today); d.setDate(today.getDate() + 1)
    date = isoDate(d)
    cleaned = cleaned.replace(/ma[ñn]ana/i, '')
  } else if (/hoy/i.test(cleaned)) {
    cleaned = cleaned.replace(/hoy/i, '')
  }

  return { date, text: cleaned }
}

// ── Title cleanup ─────────────────────────────────────────────────────────────

function cleanTitle(text) {
  let t = text

  // Strip leading articles / indefinite
  t = t.replace(/^(un[ao]?|el|la|los|las)\s+/i, '')

  // Quitar muletillas y frases de relleno ("lo de", "tema de", "cosa de"…).
  t = stripFillerPhrases(t)

  // Strip "para ir a/al/en el/a la" → keep destination
  // e.g. "levantarme para ir al gimnasio" → "levantarme gimnasio"
  t = t.replace(/\s+para\s+ir\s+(?:al?|en\s+el|en\s+la|a\s+la?)\s+/gi, ' ')

  // Strip bare "para" at end
  t = t.replace(/\s+para\s*$/, '')

  // Strip trailing connectors
  t = t.replace(/\s+(con|para|de|a|en)\s*$/, '')

  // Normalize
  return normalizeWhitespace(t)
}

// ── Main export ───────────────────────────────────────────────────────────────

export function prepareEventTranscript(rawText) {
  const normalized = normalizeWhitespace(rawText || '')
  const withoutIntent = stripIntentPrefixes(normalized)
  return capitalizeFirst(withoutIntent || normalized)
}

export function parseEvent(rawText) {
  const normalized = normalizeWhitespace(rawText || '')

  // Detect morning context before stripping intent
  const isMorning = MORNING_CONTEXT_RE.test(normalized)

  // Strip intent prefixes
  const withoutIntent = stripIntentPrefixes(normalized)

  // Extract time
  const timeResult = extractTime(withoutIntent, isMorning)
  let text = withoutIntent
  if (timeResult) {
    text = text.replace(timeResult.fullMatch, '')
  }

  // Duración explícita en el texto ("por 2 horas", "media hora"). La
  // extraemos ANTES de limpiar el título para que no quede colgada en el
  // nombre del evento, y para usarla como fuente canónica si está presente.
  const explicitDuration = extractExplicitDurationMinutes(withoutIntent)
  if (explicitDuration !== null) {
    text = text
      .replace(/(?:por|durante|de)\s+(?:\d+(?:[.,]\d+)?\s+)?(?:horas?|h|min|minutos)(?:\s+y\s+media)?/i, '')
      .replace(/\bmedia\s+hora\b/i, '')
      .replace(/\b(?:un\s+)?cuarto\s+de\s+hora\b/i, '')
  }

  // Extract date
  const { date, text: textAfterDate } = extractDate(text)
  text = textAfterDate

  // Clean title
  text = cleanTitle(text)

  const title = text
    ? capitalizeFirst(text)
    : capitalizeFirst(withoutIntent || rawText)

  // Build result
  const h24 = timeResult?.h24 ?? null
  const min = timeResult?.min ?? 0
  const startTime = h24 !== null ? formatHour(h24, min) : ''

  // Inferencia por tipo de evento — usada sólo cuando no hubo duración
  // explícita. Quien consume el parse decide si confirma con chips o asume
  // el default según la preferencia del usuario.
  const inferred = explicitDuration === null ? inferDurationFromTitle(title) : null

  // El campo `time` que devolvemos siempre incluye el rango cuando hay
  // duración explícita (el usuario fue claro → no preguntamos de nuevo).
  // Cuando solo hay inferencia, devolvemos la hora de inicio sola y dejamos
  // que la UI resuelva con chips.
  const displayTime = explicitDuration && startTime
    ? composeTimeRange(startTime, explicitDuration)
    : startTime

  const section = h24 !== null && h24 >= 14 ? 'evening' : 'focus'
  const icon = guessIcon(title)
  const dotColor = section === 'evening' ? 'bg-secondary-container' : ''

  console.log(`[Focus] 🧠 parseEvent("${rawText}") →`, {
    title,
    displayTime,
    date,
    section,
    icon,
    isMorning,
    timeResult,
    explicitDuration,
    inferred,
  })

  return {
    title,
    time: displayTime,
    startTime,
    date,
    section,
    icon,
    dotColor,
    // Pistas de duración para que QuickAddSheet / Nova decidan el flujo
    durationMinutes: explicitDuration ?? null,
    inferredDurationMinutes: inferred?.minutes ?? null,
    inferredConfidence: inferred?.confidence ?? null,
  }
}

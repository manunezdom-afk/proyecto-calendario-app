/**
 * Extracts { title, time, date, section, icon, dotColor }
 * from informal Spanish text.
 *
 * Examples:
 *   "futbol a las 5"          → { title: "Fútbol", time: "5:00 PM", date: "Hoy" }
 *   "reunión mañana a las 10" → { title: "Reunión", time: "10:00 AM", date: "Mañana" }
 *   "gym a las 6 de la tarde" → { title: "Gym", time: "6:00 PM", date: "Hoy" }
 */

// Guess a Material Symbol icon from the event title
function guessIcon(text) {
  const t = text.toLowerCase()
  if (/f[uú]tbol|deporte|gym|ejercicio|entrena|yoga|correr|nadar|pilates/.test(t)) return 'fitness_center'
  if (/reuni[oó]n|meeting|llamada|call|videollamada|sincro/.test(t)) return 'groups'
  if (/almuerzo|comida|cena|desayuno|caf[eé]|restaurante/.test(t)) return 'restaurant'
  if (/estudio|estudiar|clase|tarea|libro|leer|examen/.test(t)) return 'menu_book'
  if (/trabajo|proyecto|informe|reporte|presentaci[oó]n/.test(t)) return 'work'
  if (/m[eé]dico|doctor|cita|dentista|consulta/.test(t)) return 'local_hospital'
  if (/compras|supermercado|tienda|mercado/.test(t)) return 'shopping_cart'
  if (/cumplea[ñn]os|fiesta|celebraci[oó]n/.test(t)) return 'cake'
  if (/viaje|vuelo|aeropuerto|hotel/.test(t)) return 'flight'
  return 'event'
}

const COMMAND_PREFIXES = [
  'acu[eé]rdame(?:\\s+de)?',
  'recu[eé]rdame(?:\\s+de)?',
  'anota',
  'pon\\s+un\\s+evento\\s+de',
  'quiero',
  'tengo\\s+que',
]

const COMMAND_PREFIX_REGEX = new RegExp(`^(?:${COMMAND_PREFIXES.join('|')})\\s+`, 'i')
const LEADING_CONNECTOR_REGEX = /^(?:que|por\s+favor)\s+/i
const SIMPLE_TIME_REGEX = /a\s+las?\s+\d{1,2}(?::\d{2})?(?:\s+de\s+la\s+(?:ma[ñn]ana|tarde|noche|madrugada))?/i

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function capitalizeFirst(text) {
  if (!text) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function stripIntentPrefixes(text) {
  let cleaned = normalizeWhitespace(text)

  for (let i = 0; i < 4; i++) {
    const before = cleaned
    cleaned = cleaned.replace(COMMAND_PREFIX_REGEX, '').trim()
    cleaned = cleaned.replace(LEADING_CONNECTOR_REGEX, '').trim()
    if (cleaned === before) break
  }

  return normalizeWhitespace(cleaned)
}

export function prepareEventTranscript(rawText) {
  const normalized = normalizeWhitespace(rawText || '')
  const withoutIntent = stripIntentPrefixes(normalized)
  return capitalizeFirst(withoutIntent || normalized)
}

// Convert 24h hour to display string "3:00 PM"
function formatHour(h24, min = 0) {
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(min).padStart(2, '0')} ${period}`
}

export function parseEvent(rawText) {
  const preparedText = prepareEventTranscript(rawText)
  let text = preparedText
  let h24 = null
  let min = 0
  let date = 'Hoy'

  // ── 1. Extract time ────────────────────────────────────────────────────────

  // "al mediodía"
  if (/al?\s+mediod[íi]a/i.test(text)) {
    h24 = 12
    text = text.replace(/al?\s+mediod[íi]a/i, '')
  }
  // "a la medianoche"
  else if (/a\s+la\s+medianoche/i.test(text)) {
    h24 = 0
    text = text.replace(/a\s+la\s+medianoche/i, '')
  }
  // "a las X de la tarde/noche"
  else {
    const pmReg = /a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+(tarde|noche)/i
    const amReg = /a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+(ma[ñn]ana|madrugada)/i
    const plainReg = /a\s+las?\s+(\d{1,2})(?::(\d{2}))?/i

    const pmM = text.match(pmReg)
    const amM = text.match(amReg)
    const plainM = text.match(plainReg)

    if (pmM) {
      const h = parseInt(pmM[1])
      min = parseInt(pmM[2] || '0')
      h24 = h === 12 ? 12 : h + 12
      text = text.replace(pmM[0], '')
    } else if (amM) {
      h24 = parseInt(amM[1]) % 12  // 12 AM = 0
      min = parseInt(amM[2] || '0')
      text = text.replace(amM[0], '')
    } else if (plainM) {
      const h = parseInt(plainM[1])
      min = parseInt(plainM[2] || '0')
      // Heuristic: 1–7 → PM, 8–12 → AM (most natural in Spanish)
      h24 = h >= 1 && h <= 7 ? h + 12 : h
      text = text.replace(plainM[0], '')
    }
  }

  const simpleTimeMatch = preparedText.match(SIMPLE_TIME_REGEX)

  // ── 2. Extract date keywords ───────────────────────────────────────────────
  if (/pasado\s+ma[ñn]ana/i.test(text)) {
    date = 'Pasado mañana'
    text = text.replace(/pasado\s+ma[ñn]ana/i, '')
  } else if (/ma[ñn]ana/i.test(text)) {
    date = 'Mañana'
    text = text.replace(/ma[ñn]ana/i, '')
  } else if (/hoy/i.test(text)) {
    text = text.replace(/hoy/i, '')
  }

  // ── 3. Clean filler words → title ─────────────────────────────────────────
  text = text.replace(/^(un[ao]?|el|la)\s+/i, '').trim()
  text = text.replace(/\s+(con|para|de)\s*$/, '').trim()
  text = normalizeWhitespace(text)

  // Capitalize
  const title = text
    ? capitalizeFirst(text)
    : capitalizeFirst(preparedText || rawText)

  // ── 4. Build result ────────────────────────────────────────────────────────
  const displayTime = h24 !== null ? formatHour(h24, min) : ''
  const section = h24 !== null && h24 >= 14 ? 'evening' : 'focus'
  const icon = guessIcon(title)
  const dotColor = section === 'evening' ? 'bg-secondary-container' : ''

  console.log(`[Sanctuary] 🧠 parseEvent("${rawText}") →`, {
    title,
    displayTime,
    date,
    section,
    icon,
    extractedTime: simpleTimeMatch?.[0] || '',
    preparedText,
  })

  return { title, time: displayTime, date, section, icon, dotColor }
}

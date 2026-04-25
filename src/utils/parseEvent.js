import { stripFillerPhrases } from './titleCleanup'
import {
  extractExplicitDurationMinutes,
  inferDurationFromTitle,
  composeTimeRange,
} from './eventDuration'
import { normalizeColloquial } from './colloquialNormalizer'
import { focusLog } from './debug'

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
  'apunta(?:me)?(?:\\s+un[ao]?)?',
  'me\\s+anot[aá]s?(?:\\s+un[ao]?)?',
  'ag[eé]ndame(?:\\s+un[ao]?)?',
  'agenda(?:me)?(?:\\s+un[ao]?)?',
  'agr[eé]game(?:\\s+(?:a\\s+mi\\s+agenda|un[ao]?\\s+evento)?)?',
  'agrega(?:me)?(?:\\s+(?:a\\s+mi\\s+agenda|un[ao]?\\s+evento)?)?',
  'sum[aá](?:me)?(?:\\s+un[ao]?)?',
  'a[ñn]ade(?:me)?(?:\\s+un[ao]?)?',
  // Poner / meter
  'pon(?:me)?(?:\\s+un[ao]?\\s+evento(?:\\s+de)?|\\s+en\\s+(?:mi\\s+)?(?:agenda|calendario))?',
  'met[eé]me(?:\\s+(?:en\\s+(?:la|mi)\\s+agenda|un[ao]?))?',
  // Querer / necesitar / desear
  'quiero(?:\\s+que\\s+me\\s+(?:acu[eé]rdes|recuerdes|anotes)(?:\\s+de)?)?',
  'quiero\\s+(?:un[ao]?\\s+)?(?:evento|recordatorio)(?:\\s+de|\\s+para)?',
  'me\\s+gustar[ií]a(?:\\s+que\\s+me)?(?:\\s+(?:agendaras|anotaras))?',
  'necesito(?:\\s+recordar)?(?:\\s+que)?',
  'hace?\\s+falta(?:\\s+que)?',
  // Tener / ir / haber
  'tengo(?:\\s+que)?',
  'voy\\s+a(?:\\s+tener)?',
  'hay\\s+que',
  // Programar / crear
  'program[aá]me(?:\\s+un[ao]?)?',
  'cre[aá]me(?:\\s+un[ao]?(?:\\s+evento)?)?',
  'crea(?:\\s+un[ao]?(?:\\s+evento)?)?',
  // Marcadores cortos al inicio de listas tipo "ok," "dale," "listo,"
  'ok',
  'okay',
  'listo',
  'oye',
  'eh',
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

  // -1. Tiempo relativo: "en 5 min", "en 2 horas", "dentro de 30 minutos",
  //     "en una hora y media", "en media hora", "en un cuarto de hora".
  //     Devuelve la hora absoluta resultante de sumar al "ahora" del cliente.
  const rel = extractRelativeTime(text)
  if (rel) return rel

  // 0. Rango "de X a Y" — captura tanto inicio como fin en una sola pasada.
  //    Acepta variantes: "de 8 a 9", "de las 8 a las 9", "de 8:30 a 9:30",
  //    "de 2 a 4 de la tarde", "de 14 a 15". Si hay sufijo de periodo
  //    ("de la tarde/noche/mañana"), aplica a ambas horas. Si no, ambas
  //    heredan el mismo lado del día (si resolveHour mete el inicio en
  //    PM y el fin en 24h sigue siendo menor, se asume que el fin también
  //    es PM).
  const rangeReg = /de\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\s+a(?:l)?\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?(?:\s+de\s+la\s+(tarde|noche|ma[ñn]ana|madrugada))?/i
  const mRange = text.match(rangeReg)
  if (mRange) {
    const hS = parseInt(mRange[1], 10)
    const mS = parseInt(mRange[2] || '0', 10)
    const hE = parseInt(mRange[3], 10)
    const mE = parseInt(mRange[4] || '0', 10)
    const period = (mRange[5] || '').toLowerCase()

    let h24Start, h24End
    if (period === 'tarde' || period === 'noche') {
      h24Start = hS === 12 ? 12 : hS + 12
      h24End   = hE === 12 ? 12 : hE + 12
    } else if (period === 'madrugada' || period === 'mañana' || period === 'manana') {
      h24Start = hS % 12
      h24End   = hE % 12
    } else {
      // Sin sufijo explícito: la hora de inicio pasa por la heurística
      // estándar; la de fin hereda el mismo "lado" del día, corrigiendo
      // hacia PM si el fin quedaría antes del inicio numéricamente.
      h24Start = resolveHour(hS, mS, isMorning)
      h24End = resolveHour(hE, mE, isMorning)
      if (h24End <= h24Start) {
        // "de 8 a 9" resuelto como 8 AM → 9 AM es ok (8 < 9). Pero
        // "de 9 a 10" con inicio 9 AM → fin 10 AM es ok. Caso problemático:
        // "de 11 a 1" (11 AM → 1 PM) — resolveHour(1) devuelve 13 (PM), ok.
        // Caso "de 2 a 4" sin periodo — resolveHour pone ambos en PM (14, 16).
        // Si aun así end ≤ start, forzamos end+12.
        h24End = (h24End + 12) % 24 || 24
      }
    }

    return { h24: h24Start, min: mS, h24End, minEnd: mE, fullMatch: mRange[0] }
  }

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

  // 8. Hora suelta sin "a las" pero seguida de periodo: "5 de la tarde",
  //    "9 de la mañana". También cubre formatos 12h adheridos resueltos por
  //    el normalizador antes de llegar acá.
  const periodReg = /\b(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+(tarde|noche|ma[ñn]ana|madrugada)\b/i
  m = text.match(periodReg)
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2] || '0')
    const period = (m[3] || '').toLowerCase()
    let h24
    if (period === 'tarde' || period === 'noche') h24 = h === 12 ? 12 : h + 12
    else h24 = h % 12
    const frac = extractFraction(text.slice(text.indexOf(m[0]) + m[0].length))
    const extraMin = frac ? frac.extraMin : 0
    const fullMatch = m[0] + (frac ? frac.matchStr : '')
    return { h24, min: Math.max(0, min + extraMin), fullMatch }
  }

  // 9a. Hora numérica con minutos sin "a las": "9:30 dentista", "reunión 14:30".
  const bareReg = /(?:^|\s)(\d{1,2}):(\d{2})\b/i
  m = text.match(bareReg)
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2] || '0')
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      const h24 = h >= 13 ? h : resolveHour(h, min, isMorning)
      // fullMatch incluye el espacio leader (si existe). Lo conservamos para
      // que el reemplazo no junte dos palabras al borrarse del texto.
      return { h24, min, fullMatch: m[0] }
    }
  }

  // 9b. Hora suelta numérica al FINAL de la frase, sin minutos ni AM/PM:
  //    "gym 7", "reunión 9", "fútbol 5". Sólo en posición final para evitar
  //    falsos positivos en medio del título ("informe 4 trimestre").
  const endHourReg = /(?:^|\s)(\d{1,2})\s*$/
  m = text.match(endHourReg)
  if (m) {
    const h = parseInt(m[1], 10)
    if (h >= 1 && h <= 23) {
      const h24 = h >= 13 ? h : resolveHour(h, 0, isMorning)
      return { h24, min: 0, fullMatch: m[0] }
    }
  }

  // 9c. Hora suelta numérica seguida de marcador de día u "horas":
  //    "gym 7 mañana", "reunión 9 jueves", "futbol 8 hrs". Sólo cuando el
  //    número precede inmediatamente al marcador.
  const hourBeforeDayReg = /(?:^|\s)(\d{1,2})\s+(?=(?:hoy|ma[ñn]ana|pasado\s+ma[ñn]ana|domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|el\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|\d)|pr[oó]ximo|este|hr|hrs|horas?)\b)/i
  m = text.match(hourBeforeDayReg)
  if (m) {
    const h = parseInt(m[1], 10)
    if (h >= 1 && h <= 23) {
      const h24 = h >= 13 ? h : resolveHour(h, 0, isMorning)
      return { h24, min: 0, fullMatch: m[0] }
    }
  }

  // 10. Defaults por periodo del día sin hora explícita:
  //     "esta noche" → 21:00, "esta tarde" → 16:00, "esta mañana" → 9:00,
  //     "al atardecer" → 19:00, "media tarde" → 16:00, "media mañana" → 10:30.
  //     Sólo aplican cuando NO hubo hora explícita previa.
  const periodDefaults = [
    { re: /\b(?:esta|hoy\s+a\s+la)\s+noche\b/i,    h24: 21, min: 0 },
    { re: /\bma[ñn]ana\s+(?:a|por|en)\s+la\s+noche\b/i, h24: 21, min: 0 },
    { re: /\bma[ñn]ana\s+(?:a|por|en)\s+la\s+tarde\b/i, h24: 16, min: 0 },
    { re: /\bma[ñn]ana\s+(?:a|por|en)\s+la\s+ma[ñn]ana\b/i, h24: 9, min: 0 },
    { re: /\b(?:esta|hoy\s+a\s+la)\s+tarde\b/i,    h24: 16, min: 0 },
    { re: /\b(?:esta|hoy\s+a\s+la)\s+ma[ñn]ana\b/i, h24: 9,  min: 0 },
    { re: /\bal?\s+atardecer\b/i,                  h24: 19, min: 0 },
    { re: /\bal?\s+anochecer\b/i,                  h24: 20, min: 0 },
    { re: /\bal?\s+amanecer\b/i,                   h24: 6,  min: 30 },
    { re: /\bmedia\s+tarde\b/i,                    h24: 16, min: 0 },
    { re: /\bmedia\s+ma[ñn]ana\b/i,                h24: 10, min: 30 },
  ]
  for (const p of periodDefaults) {
    const mp = text.match(p.re)
    if (mp) return { h24: p.h24, min: p.min, fullMatch: mp[0] }
  }

  return null
}

// ── Tiempo relativo ("en 5 min", "dentro de 2 horas") ────────────────────────

const RELATIVE_TIME_RE =
  /\b(?:en|dentro\s+de|d?en|tras)\s+(?:(?:un[ao]?|una)\s+)?(?:(\d+(?:[.,]\d+)?)\s*)?(minutos?|mins?|horas?|h|cuarto\s+de\s+hora|media\s+hora)\b(?:\s+y\s+(media|cuarto))?/i

function extractRelativeTime(text) {
  const m = text.match(RELATIVE_TIME_RE)
  if (!m) return null

  let base = 0
  const unit = (m[2] || '').toLowerCase()
  const numRaw = m[1]
  // Si el usuario dijo "una hora", "un cuarto de hora", etc., n=1 implícito.
  const n = numRaw ? parseFloat(numRaw.replace(',', '.')) : 1

  if (/^horas?$|^h$/.test(unit))           base = n * 60
  else if (/^minutos?$|^mins?$/.test(unit)) base = n
  else if (/^cuarto\s+de\s+hora$/.test(unit)) base = 15
  else if (/^media\s+hora$/.test(unit))     base = 30

  // "y media" / "y cuarto" suman al final.
  const tail = (m[3] || '').toLowerCase()
  if (tail === 'media') base += 30
  else if (tail === 'cuarto') base += 15

  if (!Number.isFinite(base) || base <= 0) return null
  // Cap razonable: 24 horas. Más allá probablemente es error de parseo.
  if (base > 24 * 60) return null

  const now = new Date()
  const target = new Date(now.getTime() + base * 60 * 1000)
  return {
    h24: target.getHours(),
    min: target.getMinutes(),
    fullMatch: m[0],
    // Pista para el llamador: este timestamp es absoluto y el "date" debe
    // ser el del target (puede cruzar medianoche).
    relativeTargetISO: isoDate(target),
  }
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

// Mapa día → índice (0=domingo). Acepta forma con y sin tilde.
const WEEKDAY_INDEX = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3,
  jueves: 4, viernes: 5, sabado: 6, sábado: 6,
}
const MONTH_INDEX = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
  noviembre: 10, diciembre: 11,
}

// Resuelve un nombre de día al PRÓXIMO día de la semana ≥ hoy. Si modifier
// pide "que viene" / "próximo", siempre salta a la semana siguiente.
function resolveWeekday(today, weekdayName, opts = {}) {
  const target = WEEKDAY_INDEX[weekdayName.toLowerCase()]
  if (target == null) return null
  const todayIdx = today.getDay()
  let delta = (target - todayIdx + 7) % 7
  if (opts.nextWeek) delta = delta === 0 ? 7 : delta + 7
  // "este lunes" cuando hoy ES lunes: el usuario probablemente se refiere a
  // hoy mismo. Sin modifier y delta 0, devolvemos hoy.
  const d = new Date(today); d.setDate(today.getDate() + delta)
  return d
}

function extractDate(text) {
  const today = new Date()
  let date = isoDate(today)   // siempre YYYY-MM-DD — nunca "Hoy" ni "Mañana"
  let cleaned = text

  // "fin de semana" / "el finde" → próximo sábado.
  const findeRe = /\b(?:el\s+)?(?:finde|fin\s+de\s+semana)\b/i
  if (findeRe.test(cleaned)) {
    const d = resolveWeekday(today, 'sabado')
    if (d) {
      date = isoDate(d)
      cleaned = cleaned.replace(findeRe, '')
      return { date, text: cleaned }
    }
  }

  // "pasado mañana" antes que "mañana" para no canibalizarlo.
  if (/pasado\s+ma[ñn]ana/i.test(cleaned)) {
    const d = new Date(today); d.setDate(today.getDate() + 2)
    date = isoDate(d)
    cleaned = cleaned.replace(/pasado\s+ma[ñn]ana/i, '')
    return { date, text: cleaned }
  }

  if (/\bma[ñn]ana\b/i.test(cleaned)) {
    const d = new Date(today); d.setDate(today.getDate() + 1)
    date = isoDate(d)
    cleaned = cleaned.replace(/\bma[ñn]ana\b/i, '')
    return { date, text: cleaned }
  }

  if (/\bhoy\b/i.test(cleaned)) {
    cleaned = cleaned.replace(/\bhoy\b/i, '')
    return { date, text: cleaned }
  }

  // Día de la semana con modificador opcional ("este", "el próximo", "el
  // que viene"). El modifier va antes O después del día.
  const weekdayRe = /\b(?:el\s+|este\s+|pr[oó]ximo\s+|el\s+pr[oó]ximo\s+)?(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)(?:\s+que\s+viene|\s+pr[oó]ximo)?\b/i
  const wm = cleaned.match(weekdayRe)
  if (wm) {
    const dayName = wm[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const fullMatch = wm[0].toLowerCase()
    const isNextWeek = /pr[oó]ximo|que\s+viene/i.test(fullMatch)
    const d = resolveWeekday(today, dayName, { nextWeek: isNextWeek })
    if (d) {
      date = isoDate(d)
      cleaned = cleaned.replace(weekdayRe, '')
      return { date, text: cleaned }
    }
  }

  // Fecha numérica con barra/guion: "15/4", "15-4-2026", "15/04".
  const numericDateRe = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/
  const nm = cleaned.match(numericDateRe)
  if (nm) {
    const day = parseInt(nm[1], 10)
    const month = parseInt(nm[2], 10) - 1
    let year = nm[3] ? parseInt(nm[3], 10) : today.getFullYear()
    if (year < 100) year += 2000
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day)
      // Si la fecha quedó en el pasado y no se especificó año, asumir el
      // año siguiente (ej. hoy es 30/12, "agendar 5/1" → próximo año).
      if (!nm[3] && d < today && (today - d) > 24 * 3600 * 1000) {
        d.setFullYear(today.getFullYear() + 1)
      }
      date = isoDate(d)
      cleaned = cleaned.replace(numericDateRe, '')
      return { date, text: cleaned }
    }
  }

  // "el 15 de abril", "el 15", "15 de abril".
  const namedDateRe = /\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|sept?iembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/i
  const nmm = cleaned.match(namedDateRe)
  if (nmm) {
    const day = parseInt(nmm[1], 10)
    const month = MONTH_INDEX[nmm[2].toLowerCase()]
    let year = nmm[3] ? parseInt(nmm[3], 10) : today.getFullYear()
    if (month != null && day >= 1 && day <= 31) {
      const d = new Date(year, month, day)
      if (!nmm[3] && d < today && (today - d) > 24 * 3600 * 1000) {
        d.setFullYear(today.getFullYear() + 1)
      }
      date = isoDate(d)
      cleaned = cleaned.replace(namedDateRe, '')
      return { date, text: cleaned }
    }
  }

  // "el 15" suelto (sin mes) — sólo si no se reconoció nada antes. Asume
  // mes actual si la fecha aún no pasó, sino mes siguiente.
  const bareDayRe = /\bel\s+(\d{1,2})(?!\s*[:\d])\b/i
  const bd = cleaned.match(bareDayRe)
  if (bd) {
    const day = parseInt(bd[1], 10)
    if (day >= 1 && day <= 31) {
      const d = new Date(today.getFullYear(), today.getMonth(), day)
      if (d < today && (today - d) > 24 * 3600 * 1000) {
        d.setMonth(d.getMonth() + 1)
      }
      date = isoDate(d)
      cleaned = cleaned.replace(bareDayRe, '')
      return { date, text: cleaned }
    }
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
  const normalized = normalizeWhitespace(normalizeColloquial(rawText || ''))
  const withoutIntent = stripIntentPrefixes(normalized)
  return capitalizeFirst(withoutIntent || normalized)
}

export function parseEvent(rawText) {
  // Normalizamos coloquialismos (xq, mñn, voseo imperativo, "5pm" → "a las 5
  // de la tarde", "casi las X" → "tipo las X", repeticiones, etc.) antes
  // que cualquier extractor: así un único pipeline determinista alimenta
  // a todos los regex de hora/fecha/intent que vienen abajo.
  const colloquial = normalizeColloquial(rawText || '')
  const normalized = normalizeWhitespace(colloquial)

  // Detect morning context before stripping intent
  const isMorning = MORNING_CONTEXT_RE.test(normalized)

  // Strip intent prefixes
  const withoutIntent = stripIntentPrefixes(normalized)

  // Extract time
  const timeResult = extractTime(withoutIntent, isMorning)
  let text = withoutIntent
  if (timeResult) {
    // Reemplazamos por espacio (no string vacío) y luego colapsamos: si el
    // fullMatch tenía espacios "leader/trailer" a su alrededor (regex
    // ancorados con \s), borrarlos a secas pegaba dos palabras del título.
    text = normalizeWhitespace(text.replace(timeResult.fullMatch, ' '))
  }

  // Duración explícita: primero chequeamos si el timeResult trae un rango
  // ("de X a Y"). Si sí, ese rango es la fuente canónica y calculamos los
  // minutos directamente. Si no, buscamos patrones tipo "por 2 horas" o
  // "media hora" en el texto original. La regla se aplica ANTES de limpiar
  // el título para que ese fragmento no quede colgando en el nombre.
  let explicitDuration = null
  if (timeResult && Number.isFinite(timeResult.h24End)) {
    const startDec = timeResult.h24 + (timeResult.min || 0) / 60
    const endDec = timeResult.h24End + (timeResult.minEnd || 0) / 60
    const delta = Math.round((endDec - startDec) * 60)
    if (delta > 0 && delta <= 24 * 60) explicitDuration = delta
  }
  if (explicitDuration === null) {
    explicitDuration = extractExplicitDurationMinutes(withoutIntent)
    if (explicitDuration !== null) {
      text = text
        .replace(/(?:por|durante|de)\s+(?:\d+(?:[.,]\d+)?\s+)?(?:horas?|h|min|minutos)(?:\s+y\s+media)?/i, '')
        .replace(/\bmedia\s+hora\b/i, '')
        .replace(/\b(?:un\s+)?cuarto\s+de\s+hora\b/i, '')
    }
  }

  // Extract date. Si el tiempo vino de un patrón relativo ("en 2 horas")
  // y cruza medianoche, el target ya viene calculado en absoluto: usamos
  // ese ISO como verdad y NO corremos extractDate (que devolvería "hoy").
  let date
  let textAfterDate
  if (timeResult?.relativeTargetISO) {
    date = timeResult.relativeTargetISO
    textAfterDate = text
  } else {
    const dateExtraction = extractDate(text)
    date = dateExtraction.date
    textAfterDate = dateExtraction.text
  }
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

  focusLog(`[Focus] 🧠 parseEvent("${rawText}") →`, {
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

/**
 * parseScheduleText(rawText)
 *
 * Parser para texto estructurado de horarios/agendas (extraído por Live Text,
 * Google Lens, o escrito manualmente). Mucho más robusto que parseEvent() para:
 *
 *   - Tiempos 24h:      "9:00", "14:30", "09:00"
 *   - Tiempos 12h:      "9:00 AM", "2:30 PM", "9am", "2pm"
 *   - Formato h:        "9h30", "14h00", "9h"
 *   - Rangos:           "9:00-10:00", "9:00 - 10:00", "9:00–10:00" (usa inicio)
 *   - Coloquial:        "a las 5 de la tarde", "a las 9"
 *   - Encabezados fecha: "Lunes", "Lunes 14 de abril", "14/04", "14 de abril"
 *   - Líneas mixtas:    "14:00 Dentista", "Gym 07:30", "09:00: Revisión semanal"
 *   - Separador |:      "09:00 | Gym" (tablas de horario)
 *   - Línea fecha+evento: "Lunes 9:00 Gym" → fecha=lunes, hora=9:00, título=Gym
 */

import { stripFillerPhrases } from './titleCleanup'

// ── Helpers ──────────────────────────────────────────────────────────────────

function toISO(date) {
  return (
    `${date.getFullYear()}-` +
    `${String(date.getMonth() + 1).padStart(2, '0')}-` +
    `${String(date.getDate()).padStart(2, '0')}`
  )
}

function todayISO() { return toISO(new Date()) }

/** Normaliza texto: minúsculas + sin tildes */
function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Devuelve YYYY-MM-DD para la próxima ocurrencia del día de semana (0=Dom) */
function isoForDow(targetDow) {
  const today = new Date()
  const diff = (targetDow - today.getDay() + 7) % 7
  const d = new Date(today)
  d.setDate(today.getDate() + diff)
  return toISO(d)
}

/** Formatea h24 + min a "3:00 PM" */
function fmt12(h24, min) {
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(min).padStart(2, '0')} ${period}`
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

// ── Iconos ───────────────────────────────────────────────────────────────────

function guessIcon(text) {
  const t = norm(text)
  if (/futbol|deporte|gym|ejercicio|entrena|yoga|correr|nadar|pilates/.test(t)) return 'fitness_center'
  if (/reunion|meeting|llamada|call|videollamada|sincro|junta/.test(t))          return 'groups'
  if (/almuerzo|comida|cena|desayuno|cafe|restaurante|brunch/.test(t))           return 'restaurant'
  if (/estudio|estudiar|clase|tarea|libro|leer|examen|facultad|universidad/.test(t)) return 'menu_book'
  if (/trabajo|proyecto|informe|reporte|presentacion|oficina/.test(t))           return 'work'
  if (/medico|doctor|cita|dentista|consulta|hospital|clinica/.test(t))           return 'local_hospital'
  if (/compras|supermercado|tienda|mercado/.test(t))                             return 'shopping_cart'
  if (/cumpleanos|fiesta|celebracion|boda|evento/.test(t))                       return 'cake'
  if (/viaje|vuelo|aeropuerto|hotel|vacaciones/.test(t))                         return 'flight'
  if (/banco|pago|factura|tramite/.test(t))                                      return 'account_balance'
  return 'event'
}

// ── Mapas de fecha ────────────────────────────────────────────────────────────

const DOW_MAP = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
}

const MONTH_MAP = {
  enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6,
  julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12,
}

// ── Extracción de tiempo ──────────────────────────────────────────────────────

// Rango 24h:  "9:00 - 10:00", "14:30-15:30", "9:00–10:00"
const RE_RANGE   = /\b(\d{1,2}):(\d{2})\s*[-–]\s*\d{1,2}:\d{2}\b/
// Simple 24h: "9:00", "14:30"  (requiere separador antes: inicio de línea, espacio, : o -)
const RE_24H     = /(?:^|[\s:\-–|])(\d{1,2}):(\d{2})(?:\b)/
// 12h: "9:00 AM", "2:30 PM", "9am", "2pm"
const RE_12H     = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
// Formato h: "9h30", "14h00", "9h"
const RE_HFMT    = /\b(\d{1,2})h(\d{2})?\b/i
// Coloquial con qualifier: "a las 5 de la tarde/noche", "a las 9 de la mañana"
const RE_ALAS_PM = /a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+(tarde|noche)/i
const RE_ALAS_AM = /a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+ma[ñn]ana/i
// Coloquial simple: "a las 5", "a las 10"
const RE_ALAS    = /a\s+las?\s+(\d{1,2})(?::(\d{2}))?(?!\s+de\b)/i

/**
 * Extrae el primer tiempo de la línea.
 * Devuelve { h24, min, matchStr, displayStr } o null.
 */
function extractTime(line) {
  let m

  // 1. Rango 24h → toma inicio, elimina rango completo
  m = line.match(RE_RANGE)
  if (m) {
    const inner = m[0].match(/(\d{1,2}):(\d{2})/)
    const h24 = parseInt(inner[1]), min = parseInt(inner[2])
    if (h24 <= 23 && min <= 59) return { h24, min, matchStr: m[0].trim(), displayStr: fmt12(h24, min) }
  }

  // 2. 12h con AM/PM
  m = line.match(RE_12H)
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2] || '0')
    const isPM = norm(m[3]) === 'pm'
    const h24 = isPM ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h)
    return { h24, min, matchStr: m[0], displayStr: fmt12(h24, min) }
  }

  // 3. Formato h (9h30)
  m = line.match(RE_HFMT)
  if (m) {
    const h24 = parseInt(m[1]), min = parseInt(m[2] || '0')
    if (h24 <= 23 && min <= 59) return { h24, min, matchStr: m[0], displayStr: fmt12(h24, min) }
  }

  // 4. Coloquial tarde/noche
  m = line.match(RE_ALAS_PM)
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2] || '0')
    const h24 = h === 12 ? 12 : h + 12
    return { h24, min, matchStr: m[0], displayStr: fmt12(h24, min) }
  }

  // 5. Coloquial mañana
  m = line.match(RE_ALAS_AM)
  if (m) {
    const h24 = parseInt(m[1]) % 12, min = parseInt(m[2] || '0')
    return { h24, min, matchStr: m[0], displayStr: fmt12(h24, min) }
  }

  // 6. Coloquial simple "a las X"
  m = line.match(RE_ALAS)
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2] || '0')
    // Heurística: 1-7 → tarde, 8-23 → literal
    const h24 = h >= 1 && h <= 7 ? h + 12 : h
    return { h24, min, matchStr: m[0], displayStr: fmt12(h24, min) }
  }

  // 7. Tiempo 24h simple (último recurso)
  m = line.match(RE_24H)
  if (m) {
    const h24 = parseInt(m[1]), min = parseInt(m[2])
    if (h24 <= 23 && min <= 59) {
      // matchStr es solo la parte HH:MM
      return { h24, min, matchStr: `${m[1]}:${m[2]}`, displayStr: fmt12(h24, min) }
    }
  }

  return null
}

// ── Detección de encabezado de fecha ─────────────────────────────────────────

// Línea que ES SOLO un nombre de día (opcionalmente + fecha): "Lunes", "Lunes 14 de abril"
// El truco: al final de la regex no puede haber más texto que no sea fecha
const RE_DAY_HEADER = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s*,?\s*(\d{1,2}\s+de\s+[a-záéíóúñ]+(?:\s+de\s+\d{4})?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2})?$/i
// Fecha numérica pura: "14/04", "14-04", "14/04/2026"
const RE_NUM_DATE  = /^(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?$/
// "14 de abril" o "14 de abril de 2026"
const RE_TXT_DATE  = /^(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+\d{4})?$/i

function detectDateHeader(line) {
  // Día de semana (solo o con fecha)
  let m = line.match(RE_DAY_HEADER)
  if (m) {
    const dow = DOW_MAP[norm(m[1])] ?? 1
    let iso = isoForDow(dow)
    // Intentar parsear fecha exacta si viene incluida
    if (m[2]) {
      const td = m[2].match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)/i)
      if (td) {
        const month = MONTH_MAP[norm(td[2])]
        if (month) iso = `${new Date().getFullYear()}-${String(month).padStart(2,'0')}-${String(parseInt(td[1])).padStart(2,'0')}`
      }
    }
    return { iso, label: line }
  }

  // Fecha numérica pura
  m = line.match(RE_NUM_DATE)
  if (m) {
    const d = parseInt(m[1]), mo = parseInt(m[2])
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12)
      return { iso: `${new Date().getFullYear()}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`, label: line }
  }

  // "14 de abril"
  m = line.match(RE_TXT_DATE)
  if (m) {
    const d = parseInt(m[1])
    const month = MONTH_MAP[norm(m[2])]
    if (month) return { iso: `${new Date().getFullYear()}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`, label: line }
  }

  return null
}

// ── Limpieza del título ───────────────────────────────────────────────────────

// Patrones de fecha a eliminar del título
const RE_STRIP_DAY   = /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b[\s,]*/ig
const RE_STRIP_TDATE = /\b\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b[\s,]*/ig
const RE_STRIP_NDATE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b[\s,]*/g
// Fin del rango: "- 10:00" sobrante tras quitar inicio
const RE_STRIP_ENDTIME = /\s*[-–]\s*\d{1,2}:\d{2}/g

function cleanTitle(line, timeResult) {
  let t = line

  // Quitar tiempo encontrado
  if (timeResult?.matchStr) t = t.replace(timeResult.matchStr, '')

  // Quitar fin de rango si quedó
  t = t.replace(RE_STRIP_ENDTIME, '')

  // Quitar patrones de fecha del título
  t = t.replace(RE_STRIP_DAY, '')
  t = t.replace(RE_STRIP_TDATE, '')
  t = t.replace(RE_STRIP_NDATE, '')

  // Quitar separadores sobrantes al inicio/fin
  t = t.replace(/^[\s\-–:•|]+/, '').replace(/[\s\-–:•|]+$/, '').trim()

  // Quitar muletillas y frases de relleno ("lo de", "tema de", "cosa de"…).
  t = stripFillerPhrases(t)

  // Colapsar espacios múltiples
  return t.replace(/\s+/g, ' ').trim()
}

// ── Función principal ─────────────────────────────────────────────────────────

/**
 * @param {string} rawText  Texto completo (puede tener múltiples líneas y fechas)
 * @returns {Array}         Array de objetos evento listos para useEvents
 */
export function parseScheduleText(rawText) {
  // Expandir separador | a saltos de línea (tablas de horario)
  const expanded = rawText.replace(/\|/g, '\n')

  // Dividir en líneas limpias
  const lines = expanded.split(/\n/).map((l) => l.trim()).filter(Boolean)

  const events = []
  let currentDateISO = todayISO()

  // Etiquetas de columna a ignorar
  const SKIP_RE = /^(hora|time|horario|actividad|evento|descripci[oó]n|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i
  // Líneas de solo guiones/puntos → separadores visuales
  const SEP_RE  = /^[-–—·\s]+$/

  for (const line of lines) {
    if (line.length < 2) continue
    if (SEP_RE.test(line))   continue
    if (SKIP_RE.test(line))  continue

    // ¿Encabezado de fecha?
    const dateHeader = detectDateHeader(line)
    if (dateHeader) {
      currentDateISO = dateHeader.iso
      continue
    }

    // Extraer tiempo
    const timeResult = extractTime(line)

    // Limpiar título
    const rawTitle = cleanTitle(line, timeResult)

    // Descartar líneas sin contenido útil
    if (!rawTitle || rawTitle.length < 2) continue
    if (/^\d+$/.test(rawTitle)) continue   // solo número
    if (/^[-–—]+$/.test(rawTitle)) continue

    const h24    = timeResult?.h24 ?? null
    const section = h24 !== null && h24 >= 14 ? 'evening' : 'focus'

    events.push({
      id:          `evt-sch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title:       capitalize(rawTitle),
      time:        timeResult?.displayStr ?? '',
      date:        currentDateISO,
      section,
      featured:    false,
      icon:        guessIcon(rawTitle),
      dotColor:    section === 'evening' ? 'bg-secondary-container' : '',
      description: '',
    })
  }

  return events
}

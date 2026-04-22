// Utilidades para gestionar la DURACIÓN de un evento.
//
// Modelo de datos:
//   · Un evento guarda su hora en el campo `time`, que puede ser:
//       - "3:00 PM"                → solo hora de inicio; sin hora de término.
//       - "3:00 PM - 4:30 PM"      → rango con inicio y fin explícitos.
//   · NO usamos un campo endTime separado: el rango es parte del string `time`
//     por compatibilidad con datos y notificaciones ya existentes. Estas
//     helpers leen y componen ese formato sin tocar el schema.
//
// Reglas de producto:
//   · Un evento nunca debe ser "eterno" por defecto. Cuando no hay duración
//     explícita, el consumidor debe pedir confirmación al usuario (chips) o
//     fallback según la preferencia guardada en settings.
//   · Los recordatorios no tienen duración — este módulo expone helpers para
//     componer/leer duración de eventos, pero quien ensambla el evento final
//     debe omitir la hora de término cuando el item es un recordatorio.

import { parseTimeToDecimal } from './time'
import { isReminderItem } from './reminders'

// Chips de duración que mostramos al usuario cuando no podemos inferir con
// seguridad. El último ("sin hora de término") es la salida explícita para
// cuando el evento no tiene un cierre claro (ej: "estar disponible").
export const DURATION_CHIPS = [
  { value: 15,   label: '15 min' },
  { value: 30,   label: '30 min' },
  { value: 45,   label: '45 min' },
  { value: 60,   label: '1 h' },
  { value: 120,  label: '2 h' },
  { value: null, label: 'Sin hora de término' },
]

// Heurística de inferencia por tipo de evento. Las palabras clave están
// normalizadas sin acentos. Devuelve minutos o null si no hay certeza.
//
// Estos valores representan la duración típica para ese tipo de compromiso
// (no un promedio histórico del usuario). Cuando hay varias coincidencias,
// la primera gana — ordenadas de más específicas a más genéricas.
const INFERENCE_RULES = [
  // Comidas
  { re: /\b(desayuno|brunch)\b/,                               minutes: 45,  confidence: 'medium' },
  { re: /\b(almuerzo|comida\s+familiar|comida\s+con)\b/,       minutes: 60,  confidence: 'medium' },
  { re: /\b(cena|dinner)\b/,                                   minutes: 90,  confidence: 'medium' },
  { re: /\b(cafe|coffee|tomar\s+algo|tomar\s+un\s+cafe)\b/,    minutes: 45,  confidence: 'medium' },
  // Deporte / bienestar
  { re: /\b(gym|gimnasio|pesas|crossfit|pilates|yoga)\b/,      minutes: 60,  confidence: 'high' },
  { re: /\b(correr|running|trote|caminar|nadar|natacion)\b/,   minutes: 45,  confidence: 'medium' },
  { re: /\b(futbol|tenis|padel|basquet|voley)\b/,              minutes: 90,  confidence: 'high' },
  // Trabajo / reuniones
  { re: /\b(standup|daily|sincro|check[- ]?in)\b/,             minutes: 15,  confidence: 'high' },
  { re: /\b(1:1|uno\s+a\s+uno|one\s+on\s+one)\b/,              minutes: 30,  confidence: 'high' },
  { re: /\b(reunion|meeting|llamada|call|junta|videollamada)\b/, minutes: 45, confidence: 'medium' },
  { re: /\b(entrevista|interview)\b/,                          minutes: 60,  confidence: 'high' },
  { re: /\b(presentacion|pitch|demo|review)\b/,                minutes: 45,  confidence: 'medium' },
  // Estudio
  { re: /\b(clase|lecture|catedra)\b/,                         minutes: 90,  confidence: 'medium' },
  { re: /\b(examen|prueba|certamen|test)\b/,                   minutes: 90,  confidence: 'medium' },
  // Salud
  { re: /\b(dentista|doctor|medico|consulta|cita\s+medica)\b/, minutes: 45,  confidence: 'medium' },
  // Personal / social
  { re: /\b(cumpleanos|fiesta|celebracion|boda)\b/,            minutes: 180, confidence: 'low' },
  { re: /\b(cine|pelicula|movie)\b/,                           minutes: 120, confidence: 'high' },
]

function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Devuelve { minutes, confidence } cuando se detecta un tipo conocido, o null.
export function inferDurationFromTitle(title) {
  const t = normTitle(title)
  if (!t) return null
  for (const rule of INFERENCE_RULES) {
    if (rule.re.test(t)) return { minutes: rule.minutes, confidence: rule.confidence }
  }
  return null
}

// Extrae una duración explícita del texto del usuario ("por 2 horas",
// "durante 30 minutos", "1 hora y media", "hasta las 4:30 PM"). Devuelve
// minutos o null si no hay mención clara. No toca "a las X" (hora de inicio).
export function extractExplicitDurationMinutes(text) {
  if (!text) return null
  const t = normTitle(text)

  // "por 2 horas", "durante 1 hora y media", "por hora y media"
  const re1 = /(?:por|durante|de)\s+(?:(\d+(?:[.,]\d+)?)\s+)?(hora|horas|h)\b/
  const m1 = t.match(re1)
  if (m1) {
    const n = m1[1] ? parseFloat(m1[1].replace(',', '.')) : 1
    const halfBoost = /\by\s+media\b/.test(t) ? 30 : 0
    return Math.round(n * 60) + halfBoost
  }

  // "por 30 minutos", "durante 45 min"
  const re2 = /(?:por|durante|de)\s+(\d{1,3})\s*(?:min|minutos)\b/
  const m2 = t.match(re2)
  if (m2) return parseInt(m2[1], 10)

  // "media hora"
  if (/\bmedia\s+hora\b/.test(t)) return 30
  // "un cuarto de hora"
  if (/\b(un\s+)?cuarto\s+de\s+hora\b/.test(t)) return 15

  return null
}

// Dado un string en 24h ("14:30") o 12h ("3:30 PM") devuelve decimal (14.5)
// o null si no parsea.
export function parseAnyTimeToDecimal(timeStr) {
  if (!timeStr) return null
  // 24h "HH:mm"
  const m24 = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const h = parseInt(m24[1], 10), min = parseInt(m24[2], 10)
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return h + min / 60
  }
  return parseTimeToDecimal(timeStr)
}

// Devuelve { startH, endH } en decimales, o null si no hay hora de inicio.
// endH será null cuando el string solo tiene la hora de inicio ("3:00 PM").
export function parseTimeRange(timeStr) {
  if (!timeStr || timeStr === '—') return null
  const parts = String(timeStr).split('-').map((s) => s.trim())
  const startH = parseAnyTimeToDecimal(parts[0])
  if (startH === null) return null
  if (parts.length < 2) return { startH, endH: null }
  // Ignoramos segunda parte si no parsea como hora (puede ser "Parque Cercano")
  const endH = parseAnyTimeToDecimal(parts[1])
  return { startH, endH: endH !== null ? endH : null }
}

// ¿El evento tiene hora de término válida y coherente (> inicio)?
export function hasValidEndTime(event) {
  if (!event) return false
  const range = parseTimeRange(event.time)
  if (!range || range.endH === null) return false
  return range.endH > range.startH
}

// Formato 12h canónico usado en el resto de la app ("3:30 PM").
function formatHour12(h24, min) {
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(min).padStart(2, '0')} ${period}`
}

// Dada una hora de inicio en formato libre ("3:00 PM" o "15:00") y una
// duración en minutos, devuelve el string de rango "3:00 PM - 4:30 PM".
// Si durationMinutes es null o inválida, devuelve solo la hora de inicio
// normalizada a 12h (sin hora de término).
export function composeTimeRange(startStr, durationMinutes) {
  const startH = parseAnyTimeToDecimal(startStr)
  if (startH === null) return String(startStr || '')

  const startH24 = Math.floor(startH)
  const startMin = Math.round((startH - startH24) * 60)
  const startFmt = formatHour12(startH24, startMin)

  if (!durationMinutes || durationMinutes <= 0) return startFmt

  const totalStartMin = startH24 * 60 + startMin
  const totalEndMin = totalStartMin + durationMinutes
  // Si se pasa de 24h, cap a 23:59 — no queremos fechas corridas.
  const cappedEnd = Math.min(totalEndMin, 24 * 60 - 1)
  const endH24 = Math.floor(cappedEnd / 60)
  const endMin = cappedEnd % 60
  const endFmt = formatHour12(endH24, endMin)

  return `${startFmt} - ${endFmt}`
}

// Quita la hora de término de un string "HH:MM AM/PM - HH:MM AM/PM",
// dejando solo el inicio. Útil cuando el usuario decide "sin hora de término".
export function stripEndTime(timeStr) {
  if (!timeStr) return timeStr
  const first = String(timeStr).split('-')[0].trim()
  return first
}

// Copy para UI cuando no hay hora de término.
export const NO_END_TIME_LABEL = 'Sin hora de término'

// ── Estado temporal del evento ─────────────────────────────────────────────
// Clasifica un evento dentro del eje del tiempo en relación a `nowDate`.
// Devuelve uno de:
//   'past'    → ya pasó (día anterior, o mismo día pero la ventana terminó)
//   'active'  → está ocurriendo ahora (dentro del rango o en la ventana de
//               cortesía de 15 min si no hay hora de término)
//   'future'  → aún no empieza (día posterior, o mismo día pero startH > now)
//   'undated' → no tenemos información suficiente para clasificarlo
//
// El caller pasa `nowDate` para que un test (o una vista histórica) pueda
// fijar un instante de referencia distinto a "ahora real".
function isoDateOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function eventStatusAtNow(event, nowDate = new Date()) {
  if (!event) return 'undated'
  const dateISO = event.date
  if (!dateISO) return 'undated'
  const todayStr = isoDateOf(nowDate)
  if (dateISO > todayStr) return 'future'
  if (dateISO < todayStr) return 'past'
  // Mismo día: clasificar por hora.
  const range = parseTimeRange(event.time)
  if (!range || range.startH == null) return 'undated'
  const nowH = nowDate.getHours() + nowDate.getMinutes() / 60
  if (range.endH != null && range.endH > range.startH) {
    if (nowH < range.startH) return 'future'
    if (nowH < range.endH)   return 'active'
    return 'past'
  }
  // Sin hora de término: ventana de cortesía de 15 min para considerarlo
  // "activo", luego pasa a "past". Coherente con PlannerView/activeBlock.
  const GRACE_H = 15 / 60
  if (nowH < range.startH) return 'future'
  if (nowH < range.startH + GRACE_H) return 'active'
  return 'past'
}

export function isEventPast(event, nowDate = new Date()) {
  return eventStatusAtNow(event, nowDate) === 'past'
}

// Regla central: ¿este item puede aparecer como bloque "En curso"?
// Debe tener hora de inicio y de término válidas, y no ser un recordatorio.
export function canShowAsInProgress(event) {
  if (!event) return false
  if (isReminderItem(event)) return false
  return hasValidEndTime(event)
}

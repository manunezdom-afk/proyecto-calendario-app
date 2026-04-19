// Helpers extraídos de PlannerView.jsx para separar la lógica de presentación.
// Todo lo relacionado con formateo de hora/fecha, normalización de títulos,
// detección de recordatorios y similitud jaccard vive aquí.

import { weekdayName, monthName } from '../../utils/dateHelpers'

export function formatToday() {
  const d = new Date()
  const day = weekdayName(d)
  const dayCap = day.charAt(0).toUpperCase() + day.slice(1)
  return `${dayCap}, ${d.getDate()} de ${monthName(d)}`
}

export function currentHour() {
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}

// Parser simple (HH:MM 24h) usado por el grid. Para parseo coloquial completo
// hay parseTimeToDecimal en utils/dateHelpers.js.
export function parseTimeToDecimal(timeStr) {
  if (!timeStr || timeStr === '—') return null
  const [h, m] = timeStr.split(':').map(Number)
  if (isNaN(h)) return null
  return h + m / 60
}

export function formatMinutes(totalMinutes) {
  if (totalMinutes < 1) return 'ahora'
  if (totalMinutes < 60) return `${Math.round(totalMinutes)} min`
  const h = Math.floor(totalMinutes / 60)
  const m = Math.round(totalMinutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// Normaliza un string de hora a "HH:MM" 24h. Acepta 12h/24h.
export function eventTimeToBlockTime(timeStr) {
  if (!timeStr) return '—'
  const first = String(timeStr).split('-')[0].trim()
  // 24h
  const m24 = first.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const hh = Math.max(0, Math.min(23, Number(m24[1])))
    const mm = Math.max(0, Math.min(59, Number(m24[2])))
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  // 12h
  const m12 = first.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (m12) {
    let hh = Number(m12[1])
    const mm = Number(m12[2] ?? '00')
    const ap = m12[3].toUpperCase()
    if (hh === 12) hh = 0
    if (ap === 'PM') hh += 12
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  return '—'
}

export function normalizeTitleKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Detecta si un evento es un recordatorio de otro y devuelve el título padre.
export function extractReminderMeta(title) {
  const t = String(title || '').trim()
  const m1 = t.match(/^recordatorio:\s*(.+)$/i)
  if (m1) return { isReminder: true, parentTitle: m1[1].trim(), label: 'Recordatorio' }

  const m2 = t.match(/^(.+?)\s*(?:—|-)\s*recordatorio\b.*$/i)
  if (m2) return { isReminder: true, parentTitle: m2[1].trim(), label: 'Recordatorio' }

  const m3 = t.match(/^(.+?)\s*\((?:.*\brecordatorio\b.*)\)\s*$/i)
  if (m3) {
    const inside = t.replace(m3[1], '').trim().replace(/^\(|\)$/g, '').trim()
    return { isReminder: true, parentTitle: m3[1].trim(), label: inside || 'Recordatorio' }
  }

  const m4 = t.match(/^(.+?)\s+en\s+(?:10|30|60)\s+minutos\b/i)
  if (m4) return { isReminder: true, parentTitle: m4[1].trim(), label: t.slice(m4[1].length).trim() }

  if (/\b(recordatorio|reminder)\b/i.test(t)) {
    const guessParent = t
      .replace(/\b(recordatorio|reminder)\b/ig, '')
      .replace(/[()—-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return { isReminder: true, parentTitle: guessParent || t, label: 'Recordatorio' }
  }

  return { isReminder: false, parentTitle: '', label: '' }
}

const STOP_WORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'en', 'para', 'por', 'con', 'un', 'una'])

export function titleTokenSet(title) {
  const cleaned = normalizeTitleKey(title)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = cleaned.split(' ').filter(Boolean)
  return new Set(tokens.filter((t) => t.length > 2 && !STOP_WORDS.has(t)))
}

export function jaccard(a, b) {
  if (!a?.size || !b?.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

export function looksLikeReminderTitle(title) {
  const t = normalizeTitleKey(title)
  if (/^(recordar|recuerda|remember|check|revisar|enviar|llamar|pagar|comprar|hacer|preparar|confirmar|agendar)\b/.test(t)) return true
  if (/\b(recordatorio|reminder)\b/.test(t)) return true
  if (/^todo\b/.test(t)) return true
  return false
}

// Detección de recordatorios y su relación con eventos principales.
//
// CONCEPTO CLAVE — tres categorías distintas:
//
//   1. Evento independiente: un compromiso real (reunión, clase, llamada).
//      Cuenta como UNA entidad principal en métricas y listas.
//
//   2. Recordatorio asociado: aviso que pertenece a un evento ya existente
//      (ej: "Recordatorio: Reunión con Juan" a las 14:50 para la reunión
//      de las 15:00). NO es una entidad separada — se agrupa bajo su evento
//      padre y NO debe inflar contadores, progreso ni listas. El render lo
//      muestra como subtarea bajo el bloque padre.
//
//   3. Recordatorio independiente: recordatorio sin evento padre detectable
//      (ej: "Recordar pagar la luz"). SÍ cuenta como entidad principal
//      porque es la única representación del compromiso.
//
// El modelo de datos no guarda un flag explícito `isReminder` ni
// `parentEventId` — se deriva por heurística desde el título y la hora.
// Cualquier consumidor que quiera "entidades principales" debe usar
// `isMainEntity()` para filtrar; esa es la única fuente de verdad.

import { parseTimeToDecimal } from './time'

export function normalizeTitleKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

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

export function titleTokenSet(title) {
  const cleaned = normalizeTitleKey(title)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = cleaned.split(' ').filter(Boolean)
  const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'en', 'para', 'por', 'con', 'un', 'una'])
  return new Set(tokens.filter((tok) => tok.length > 2 && !STOP.has(tok)))
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

// ¿El item (block o event) luce como un recordatorio?
export function isReminderItem(item) {
  if (!item) return false
  const meta = extractReminderMeta(item?.title)
  return meta.isReminder || looksLikeReminderTitle(item?.title)
}

// ¿Este recordatorio pertenece a un evento principal existente?
// Empareja por título explícito ("Recordatorio: X" → busca evento "X")
// o por cercanía temporal (evento dentro de 60 min después del reminder)
// + similitud de título (Jaccard ≥ 0.55).
//
// IMPORTANTE: `siblings` debe contener SOLO eventos/bloques principales
// (no otros recordatorios), para evitar que un reminder se "adopte" a sí
// mismo cuando hay varios reminders cercanos sin evento real.
export function reminderHasParent(reminder, siblings) {
  if (!reminder || !Array.isArray(siblings) || siblings.length === 0) return false
  const meta = extractReminderMeta(reminder?.title)
  if (meta.isReminder && meta.parentTitle) {
    const key = normalizeTitleKey(meta.parentTitle)
    if (siblings.some((e) => normalizeTitleKey(e?.title) === key)) return true
  }
  const rh = parseTimeToDecimal(reminder?.time)
  if (rh === null || rh === undefined) return false
  const rTokens = titleTokenSet(reminder?.title)
  for (const ev of siblings) {
    const eh = parseTimeToDecimal(ev?.time)
    if (eh === null || eh === undefined) continue
    const delta = (eh - rh) * 60
    if (delta < 0 || delta > 60) continue
    if (jaccard(rTokens, titleTokenSet(ev?.title)) >= 0.55) return true
  }
  return false
}

// Decide si un item cuenta como "entidad principal" para contadores y listas.
//
// Devuelve true si:
//   - el item NO es recordatorio (= evento independiente), O
//   - el item es recordatorio pero NO tiene padre (= recordatorio independiente).
//
// Devuelve false sólo para recordatorios asociados, que no deben inflar métricas.
//
// `allItems` es la colección completa (eventos + recordatorios). Internamente
// usamos sólo los NO-recordatorios como candidatos a padre.
export function isMainEntity(item, allItems) {
  if (!isReminderItem(item)) return true
  const parents = (allItems || []).filter((x) => x && x !== item && !isReminderItem(x))
  return !reminderHasParent(item, parents)
}

// Split rápido de una lista mixta en tres buckets. Útil cuando el consumidor
// necesita ambos grupos (métricas + render).
export function splitReminders(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  const events = list.filter((x) => !isReminderItem(x))
  const reminders = list.filter((x) => isReminderItem(x))
  const standaloneReminders = reminders.filter((r) => !reminderHasParent(r, events))
  const associatedReminders = reminders.filter((r) => reminderHasParent(r, events))
  return { events, standaloneReminders, associatedReminders }
}

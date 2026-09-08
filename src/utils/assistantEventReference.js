import { assistantSessionKey } from './assistantSession.js'

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const key = userId => assistantSessionKey('event_reference', userId)
const snapshot = event => Object.fromEntries([
  'id', 'title', 'date', 'time', 'description', 'section', 'icon', 'dotColor', 'featured', 'reminderOffsets', 'timezone',
].map(field => [field, event?.[field] ?? null]))

// These IDs describe a previous verified commit, never permission to mutate it.
// Only the next explicit continuation can consume them; the server still
// validates the new intent and requires review for destructive operations.
export function isEventContinuation(message) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  return /^(?:(?:y|no|entonces|perdon|espera)[,\s]+)*(?:mejor\s+(?:a\s+las?\s+(?:\d{1,2}(?::\d{2})?|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b|(?:para\s+)?(?:manana|hoy)\b|el\s+(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,2})\b|(?:una?|media|\d+)\s+horas?\s+(?:antes|despues)\b)|(?:muevelo|muevela|cambialo|cambiala|pasalo|pasala|reagendalo|reagendala|reprogramalo|reprogramala|anadele|agregale|ponle)\b)/.test(text) ||
    /^y\s+recuerdame\b/.test(text)
}

export function clearEventReference(storage, userId) {
  try { storage.removeItem(key(userId)) } catch {}
}

export function rememberEventReceipt(storage, userId, outcome, kind, now = Date.now()) {
  clearEventReference(storage, userId)
  const receipt = outcome?.receipts?.[0]
  if (!outcome?.ok || kind !== 'execute' || !Array.isArray(outcome.receipts) || outcome.receipts.length !== 1 || !receipt?.ok ||
      !['add_event', 'edit_event'].includes(receipt.action?.type) || !uuid(receipt.value?.id)) return false
  const reference = { event: snapshot(receipt.value), receiptMessage: outcome.message, createdAt: now }
  try { storage.setItem(key(userId), JSON.stringify(reference)); return true } catch { return false }
}

export function consumeEventReference(storage, userId, { message, events = [], history = [], pendingProposal }, now = Date.now()) {
  let reference
  try { reference = JSON.parse(storage.getItem(key(userId)) || 'null') } catch {}
  clearEventReference(storage, userId)
  if (pendingProposal || !isEventContinuation(message) || !uuid(reference?.event?.id) ||
      !Number.isFinite(reference.createdAt) || now < reference.createdAt || now - reference.createdAt > 30 * 60_000 ||
      history.at(-1)?.role !== 'assistant' || history.at(-1)?.content !== reference.receiptMessage) return []
  const current = events.find(event => event.id === reference.event.id)
  if (!current || JSON.stringify(snapshot(current)) !== JSON.stringify(reference.event)) return []
  return [current.id]
}

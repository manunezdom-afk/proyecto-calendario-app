export function assistantSessionKey(kind, userId, surface = '') {
  return `focus_ai_v2_${kind}_${userId || 'guest'}_${surface}`
}

export function readAssistantHistory(storage, userId) {
  try {
    const rows = JSON.parse(storage.getItem(assistantSessionKey('history', userId)) || '[]')
    return Array.isArray(rows) ? rows.filter(row => row && ['user', 'assistant'].includes(row.role) && typeof row.content === 'string').slice(-40) : []
  } catch { return [] }
}

export async function prepareLogicalRequest(storage, userId, surface, text) {
  const key = assistantSessionKey('request', userId, surface)
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.trim()))), value => value.toString(16).padStart(2, '0')).join('')
  let previous
  try { previous = JSON.parse(storage.getItem(key) || 'null') } catch {}
  if (previous?.digest === digest && typeof previous.id === 'string' && Date.now() - previous.createdAt < 86_400_000) return previous
  const request = { id: crypto.randomUUID(), digest, createdAt: Date.now() }
  storage.setItem(key, JSON.stringify(request))
  return request
}

export function clearLogicalRequest(storage, userId, surface) {
  try { storage.removeItem(assistantSessionKey('request', userId, surface)); return true } catch { return false }
}

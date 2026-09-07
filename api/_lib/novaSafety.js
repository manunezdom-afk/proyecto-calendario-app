import { randomUUID } from 'node:crypto'

// One request budget shared by every provider. Only bounded, expected fields
// reach a prompt; diagnostics never contain the user's input or provider body.
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : ''
const list = (value, limit) => Array.isArray(value) ? value.slice(0, limit) : []

export function novaRequestId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value)
    ? value : randomUUID()
}

export function sanitizeNovaRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'invalid_request' }
  if (typeof raw.message !== 'string' || !raw.message.trim()) return { error: 'no_message' }
  if (raw.message.length > 4000) return { error: 'message_too_long' }
  const result = {
    message: raw.message.trim(),
    clientNow: typeof raw.clientNow === 'number' && Number.isFinite(raw.clientNow) ? raw.clientNow : undefined,
    clientTimezone: text(raw.clientTimezone, 80),
    novaPersonality: text(raw.novaPersonality, 20),
    history: list(Array.isArray(raw.history) ? raw.history.slice(-12) : [], 12)
      .filter(h => h && ['user', 'assistant'].includes(h.role) && typeof h.content === 'string')
      .map(h => ({ role: h.role, content: text(h.content, 1000) })),
    events: list(raw.events, 80).filter(e => e && text(e.title, 120)).map(e => ({
      id: text(e.id, 64), title: text(e.title, 120), subtitle: text(e.subtitle, 160),
      time: text(e.time, 20), endTime: text(e.endTime, 20), date: text(e.date, 10), section: text(e.section, 20),
      reminderOffsets: list(e.reminderOffsets, 5).filter(n => Number.isInteger(n) && n >= 0 && n <= 10080),
    })),
    tasks: list(raw.tasks, 50).filter(t => t && text(t.label, 120)).map(t => ({
      id: text(t.id, 64), label: text(t.label, 120), done: t.done === true,
      date: text(t.date, 10), time: text(t.time, 20), priority: text(t.priority, 12), category: text(t.category, 20),
    })),
    userMemories: list(raw.userMemories, 20).map(m => text(m, 200)).filter(Boolean),
    memories: list(raw.memories, 20).filter(m => m && typeof m.content === 'string')
      .map(m => ({ content: text(m.content, 200) })),
    discussedEventIds: list(raw.discussedEventIds, 5).map(id => text(id, 64)).filter(Boolean),
    // Calendar capture does not need the address book or behavioral profile.
    contacts: [], profile: null, behavior: null, location: null,
  }
  return { body: result }
}

export function providerFallbackEnabled() {
  return String(process.env.AI_ENABLE_PROVIDER_FALLBACK || '').trim().toLowerCase() === 'true'
}

// Billing evidence is retained even when a paid response fails JSON validation.
// Awaiting the write prevents a serverless response from abandoning it.
export async function runNovaAttempt({ call, transform, record }) {
  const started = Date.now()
  let data
  let result
  let error
  try {
    data = await call()
    result = await transform(data)
    return result
  } catch (failure) {
    error = failure
    throw failure
  } finally {
    await record({ data, result, error, durationMs: Date.now() - started }).catch(() => {})
  }
}


export function novaOutputTokenLimit(value, fallback = 1024) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(256, Math.min(2048, Math.floor(parsed))) : fallback
}

/**
 * signalsService — logueo silencioso de señales de comportamiento del usuario
 *
 * Cada interacción relevante (tarea completada, sugerencia aprobada/rechazada,
 * evento creado, mensaje a Nova) se loguea como un "signal" en Supabase.
 * analyzeBehavior() las agrega periódicamente en un modelo que Nova usa como
 * contexto implícito. Offline-first: si no hay red o usuario, encola en
 * localStorage y flushea cuando vuelve la conexión.
 */

import { supabase } from '../lib/supabase'

const QUEUE_KEY = 'focus_signals_queue'
const MAX_QUEUE = 500

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}
function setQueue(q) {
  try {
    const trimmed = q.length > MAX_QUEUE ? q.slice(-MAX_QUEUE) : q
    localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed))
  } catch {}
}

// Cached user id — actualizado desde AuthContext via setSignalsUserId()
let _userId = null

export function setSignalsUserId(id) {
  _userId = id || null
  if (_userId) flushSignalsQueue().catch(() => {})
}

/**
 * Loguea una señal. kind es un string corto (ej. 'task_completed'),
 * payload es un objeto con data relevante (ej. { hour, weekday, category }).
 * No-op si falta kind.
 */
export function logSignal(kind, payload = {}) {
  if (!kind) return
  const signal = {
    kind: String(kind).slice(0, 40),
    payload: payload && typeof payload === 'object' ? payload : {},
    created_at: new Date().toISOString(),
  }

  // Sin usuario o sin red → encolamos
  if (!_userId || !supabase || typeof navigator !== 'undefined' && !navigator.onLine) {
    const q = getQueue()
    q.push(signal)
    setQueue(q)
    return
  }

  // Fire-and-forget — si falla, encolamos
  supabase
    .from('user_signals')
    .insert({ user_id: _userId, kind: signal.kind, payload: signal.payload })
    .then(({ error }) => {
      if (error) {
        const q = getQueue()
        q.push(signal)
        setQueue(q)
      }
    })
    .catch(() => {
      const q = getQueue()
      q.push(signal)
      setQueue(q)
    })
}

/**
 * Sube los signals encolados a Supabase. Se llama al login, al recuperar red,
 * o manualmente.
 */
export async function flushSignalsQueue() {
  if (!_userId || !supabase) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  const q = getQueue()
  if (q.length === 0) return

  const rows = q.map(s => ({
    user_id: _userId,
    kind: s.kind,
    payload: s.payload,
    created_at: s.created_at,
  }))

  try {
    const { error } = await supabase.from('user_signals').insert(rows)
    if (!error) setQueue([])
  } catch {
    // queda encolado para el próximo intento
  }
}

/**
 * Lee signals recientes del usuario. Usado por analyzeBehavior() para
 * calcular el modelo. Límite razonable (500) y rango configurable.
 */
export async function fetchRecentSignals({ sinceDays = 30, limit = 500, kind = null } = {}) {
  if (!_userId || !supabase) return []
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString()
  try {
    let q = supabase
      .from('user_signals')
      .select('kind, payload, created_at')
      .eq('user_id', _userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (kind) q = q.eq('kind', kind)
    const { data, error } = await q
    if (error) return []
    return data || []
  } catch {
    return []
  }
}

/**
 * Opcional: borra todas las señales del usuario (para "olvidar" en la UI).
 */
export async function clearAllSignals() {
  if (!_userId || !supabase) return
  try {
    await supabase.from('user_signals').delete().eq('user_id', _userId)
    await supabase.from('user_behavior').delete().eq('user_id', _userId)
  } catch {}
  try { localStorage.removeItem('focus_user_behavior') } catch {}
  setQueue([])
}

// Auto-flush al recuperar conexión
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    flushSignalsQueue().catch(() => {})
  })
}

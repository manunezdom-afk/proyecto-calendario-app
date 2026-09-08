import { supabase } from '../lib/supabase'
import { writeJsonCache } from '../utils/verifiedMutation.js'

// ── Cache helpers ─────────────────────────────────────────────────────────────

function cacheGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function cacheSet(key, value) {
  try { return writeJsonCache(localStorage, key, value) } catch { return false }
}

// ── DB ↔ App shape converters ─────────────────────────────────────────────────

function eventToDb(event, userId) {
  return {
    id: event.id, user_id: userId,
    title: event.title, time: event.time,
    description: event.description ?? '',
    section: event.section ?? 'focus',
    icon: event.icon ?? 'event',
    dot_color: event.dotColor ?? 'bg-secondary-container',
    date: event.date ?? null,
    featured: event.featured ?? false,
    reminder_offsets: Array.isArray(event.reminderOffsets) ? event.reminderOffsets : null,
    timezone: event.timezone ?? null,
  }
}

function eventFromDb(row) {
  return {
    id: row.id, title: row.title, time: row.time,
    description: row.description, section: row.section,
    icon: row.icon, dotColor: row.dot_color,
    date: row.date, featured: row.featured,
    reminderOffsets: row.reminder_offsets ?? null,
    timezone: row.timezone ?? null,
  }
}

function taskToDb(task, userId) {
  return {
    id: task.id, user_id: userId,
    label: task.label, done: task.done,
    priority: task.priority ?? 'Media',
    category: task.category ?? 'hoy',
    done_at: task.doneAt ?? null,
    due_date: task.date ?? null,
    due_time: task.time ?? null,
  }
}

function taskFromDb(row) {
  return {
    id: row.id, label: row.label, done: row.done,
    priority: row.priority, category: row.category,
    doneAt: row.done_at,
    date: row.due_date ?? null,
    time: row.due_time ?? null,
  }
}

function suggestionToDb(s, userId) {
  return {
    id: s.id,
    user_id: userId,
    kind: s.kind,
    payload: s.payload ?? {},
    preview_title: s.previewTitle ?? null,
    preview_body: s.previewBody ?? null,
    preview_icon: s.previewIcon ?? 'auto_awesome',
    reason: s.reason ?? null,
    status: s.status ?? 'pending',
    batch_id: s.batchId ?? null,
    resolved_at: s.resolvedAt ?? null,
  }
}

function suggestionFromDb(row) {
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload ?? {},
    previewTitle: row.preview_title,
    previewBody: row.preview_body,
    previewIcon: row.preview_icon,
    reason: row.reason,
    status: row.status,
    batchId: row.batch_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }
}

function profileToDb(profile, userId) {
  return {
    id: userId,
    chronotype: profile.chronotype, role: profile.role,
    setup_done: profile.setupDone, snoozed_until: profile.snoozedUntil ?? null,
    timezone: profile.timezone || 'UTC',
  }
}

function profileFromDb(row) {
  return {
    chronotype: row.chronotype, role: row.role,
    setupDone: row.setup_done, snoozedUntil: row.snoozed_until,
    timezone: row.timezone || 'UTC',
  }
}

function memoryToDb(m, userId) {
  return {
    id: m.id,
    user_id: userId,
    category: m.category,
    subject: m.subject ?? null,
    content: m.content,
    confidence: m.confidence ?? 'medium',
    source: m.source ?? 'conversation',
    expires_at: m.expiresAt ?? null,
    pinned: m.pinned ?? false,
    last_seen_at: m.lastSeenAt ?? new Date().toISOString(),
  }
}

function memoryFromDb(row) {
  return {
    id: row.id,
    category: row.category,
    subject: row.subject,
    content: row.content,
    confidence: row.confidence,
    source: row.source,
    expiresAt: row.expires_at,
    pinned: row.pinned,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

// ── Offline sync queue ────────────────────────────────────────────────────────

const QUEUE_KEY = 'focus_sync_queue'

function enqueue(op) {
  const q = cacheGet(QUEUE_KEY, [])
  q.push({ ...op, ts: Date.now() })
  cacheSet(QUEUE_KEY, q)
}

async function executeOp({ table, type, data, id, userId }) {
  if (type === 'upsert') {
    const { error } = await supabase.from(table).upsert(data)
    if (error) throw error
  } else if (type === 'delete') {
    const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
  }
}

// ── dataService ───────────────────────────────────────────────────────────────

export const dataService = {

  // ── Events ─────────────────────────────────────────────────────────────────

  // Cache por usuario para evitar que datos de otra cuenta queden "pegados"
  // cuando el mismo dispositivo alterna entre sesiones.
  getCachedEvents(userId) {
    if (userId) return cacheGet(`focus_events_${userId}`, [])
    return cacheGet('focus_events', [])
  },
  setCachedEvents(events, userId) {
    return cacheSet(userId ? `focus_events_${userId}` : 'focus_events', events)
  },

  async fetchEvents(userId) {
    if (!supabase) return this.getCachedEvents()
    const { data, error } = await supabase
      .from('events').select('*').eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data.map(eventFromDb)
  },

  async upsertEvent(event, userId) {
    if (!supabase) return
    const row = eventToDb(event, userId)
    if (!navigator.onLine) { enqueue({ table: 'events', type: 'upsert', data: row }); return }
    const { error } = await supabase.from('events').upsert(row)
    if (error) enqueue({ table: 'events', type: 'upsert', data: row })
  },

  async deleteEvent(id, userId) {
    if (!supabase) return
    if (!navigator.onLine) { enqueue({ table: 'events', type: 'delete', id, userId }); return }
    const { error } = await supabase.from('events').delete().eq('id', id).eq('user_id', userId)
    if (error) enqueue({ table: 'events', type: 'delete', id, userId })
  },

  // ── Tasks ───────────────────────────────────────────────────────────────────

  getCachedTasks(fallback, userId) {
    if (userId) return cacheGet(`focus_tasks_${userId}`, fallback)
    return cacheGet('focus_tasks', fallback)
  },
  setCachedTasks(tasks, userId) {
    return cacheSet(userId ? `focus_tasks_${userId}` : 'focus_tasks', tasks)
  },

  async fetchTasks(userId) {
    if (!supabase) return null
    const { data, error } = await supabase
      .from('tasks').select('*').eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data.map(taskFromDb)
  },

  async upsertTask(task, userId) {
    if (!supabase) return
    const row = taskToDb(task, userId)
    if (!navigator.onLine) { enqueue({ table: 'tasks', type: 'upsert', data: row }); return }
    const { error } = await supabase.from('tasks').upsert(row)
    if (error) enqueue({ table: 'tasks', type: 'upsert', data: row })
  },

  async deleteTask(id, userId) {
    if (!supabase) return
    if (!navigator.onLine) { enqueue({ table: 'tasks', type: 'delete', id, userId }); return }
    const { error } = await supabase.from('tasks').delete().eq('id', id).eq('user_id', userId)
    if (error) enqueue({ table: 'tasks', type: 'delete', id, userId })
  },

  // ── Suggestions (Nova modo propuesta) ──────────────────────────────────────

  getCachedSuggestions(userId) { return cacheGet(`focus_suggestions_v2_${userId || 'guest'}`, []) },
  setCachedSuggestions(suggestions, userId) { return cacheSet(`focus_suggestions_v2_${userId || 'guest'}`, suggestions) },

  async fetchSuggestions(userId) {
    if (!supabase) return this.getCachedSuggestions(userId)
    const { data, error } = await supabase
      .from('suggestions').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data.map(suggestionFromDb)
  },

  async upsertSuggestion(suggestion, userId) {
    if (!supabase) return
    const row = suggestionToDb(suggestion, userId)
    if (!navigator.onLine) { enqueue({ table: 'suggestions', type: 'upsert', data: row }); return }
    const { error } = await supabase.from('suggestions').upsert(row)
    if (error) enqueue({ table: 'suggestions', type: 'upsert', data: row })
  },

  async upsertSuggestions(suggestions, userId) {
    if (!supabase) return
    const rows = suggestions.map(suggestion => suggestionToDb(suggestion, userId))
    // One upsert keeps a replaced batch and its successor together in the queue
    // and in the database transaction; neither is synchronized item by item.
    if (!navigator.onLine) { enqueue({ table: 'suggestions', type: 'upsert', data: rows }); return }
    const { error } = await supabase.from('suggestions').upsert(rows)
    if (error) enqueue({ table: 'suggestions', type: 'upsert', data: rows })
  },

  async deleteSuggestion(id, userId) {
    if (!supabase) return
    if (!navigator.onLine) { enqueue({ table: 'suggestions', type: 'delete', id, userId }); return }
    const { error } = await supabase.from('suggestions').delete().eq('id', id).eq('user_id', userId)
    if (error) enqueue({ table: 'suggestions', type: 'delete', id, userId })
  },

  // ── Profile ─────────────────────────────────────────────────────────────────

  getCachedProfile(fallback) { return cacheGet('focus_user_profile', fallback) },
  setCachedProfile(profile) { cacheSet('focus_user_profile', profile) },

  async fetchProfile(userId) {
    if (!supabase) return null
    const { data, error } = await supabase
      .from('user_profiles').select('*').eq('id', userId).single()
    if (error && error.code !== 'PGRST116') throw error
    return data ? profileFromDb(data) : null
  },

  async upsertProfile(profile, userId) {
    if (!supabase) return
    const row = profileToDb(profile, userId)
    if (!navigator.onLine) { enqueue({ table: 'user_profiles', type: 'upsert', data: row }); return }
    const { error } = await supabase.from('user_profiles').upsert(row)
    if (error) enqueue({ table: 'user_profiles', type: 'upsert', data: row })
  },

  // ── User memories (Nova persistent memory about the user) ──────────────────

  getCachedMemories(userId) { return cacheGet(`focus_user_memories_v2_${userId || 'guest'}`, []) },
  setCachedMemories(memories, userId) { return cacheSet(`focus_user_memories_v2_${userId || 'guest'}`, memories) },

  async fetchMemories(userId) {
    if (!supabase) return this.getCachedMemories(userId)
    const { data, error } = await supabase
      .from('user_memories').select('*').eq('user_id', userId)
      .order('pinned', { ascending: false })
      .order('last_seen_at', { ascending: false })
    if (error) throw error
    const today = new Date().toISOString().slice(0, 10)
    return data
      .filter(r => !r.expires_at || r.expires_at >= today)
      .map(memoryFromDb)
  },

  async upsertMemory(memory, userId) {
    if (!supabase) return
    const row = memoryToDb(memory, userId)
    if (!navigator.onLine) { enqueue({ table: 'user_memories', type: 'upsert', data: row }); return }
    const { error } = await supabase.from('user_memories').upsert(row)
    if (error) enqueue({ table: 'user_memories', type: 'upsert', data: row })
  },

  async deleteMemory(id, userId) {
    if (!supabase) return
    if (!navigator.onLine) { enqueue({ table: 'user_memories', type: 'delete', id, userId }); return }
    const { error } = await supabase.from('user_memories').delete().eq('id', id).eq('user_id', userId)
    if (error) enqueue({ table: 'user_memories', type: 'delete', id, userId })
  },

  // ── Migration (deprecated) ──────────────────────────────────────────────────
  // Antes subía la caché global (focus_events / focus_tasks) al Supabase del
  // usuario en el primer login. Eso hacía que tareas sueltas de sesiones
  // anteriores en el mismo dispositivo aparecieran como "tareas pendientes"
  // reales del usuario. Ahora es no-op: la nube es la única fuente de verdad.
  isMigrated() { return true },
  markMigrated() {},
  async migrateToCloud() { /* no-op: ver comentario arriba */ },

  // Borra las claves globales de caché (sin userId). Se usa al cerrar sesión
  // y al iniciar sesión para que nada del dispositivo se cuele en la cuenta.
  clearGlobalCache() {
    try {
      localStorage.removeItem('focus_events')
      localStorage.removeItem('focus_tasks')
      localStorage.removeItem('focus_suggestions')
      localStorage.removeItem('focus_user_profile')
      localStorage.removeItem('focus_user_memories')
      localStorage.removeItem('focus_user_behavior')
      localStorage.removeItem('focus_migrated')
      localStorage.removeItem('focus_task_links')
    } catch {}
  },

  // Borra TODA la caché privada del dispositivo: globales + por-usuario.
  // Llamado al cerrar sesión para que ningún dato del usuario quede en disk
  // accesible vía DevTools si alguien recoge el dispositivo después.
  // Recorremos localStorage entero buscando prefijos conocidos: la versión
  // anterior solo limpiaba claves globales y dejaba `focus_events_<uuid>`,
  // `focus_tasks_<uuid>`, etc. en disco indefinidamente.
  clearAllLocalCache() {
    try {
      const KNOWN_PREFIXES = [
        'focus_events',         // global + focus_events_<userId>
        'focus_tasks',          // global + focus_tasks_<userId>
        'focus_suggestions',
        'focus_user_profile',
        'focus_user_memories',
        'focus_user_behavior',
        'focus_migrated',
        'focus_task_links',     // global + focus_task_links_<userId>
        'focus_task_parents',   // global + focus_task_parents_<userId>
        'focus_sync_queue',     // cola offline (puede tener writes del user anterior)
        'focus_signals_queue',  // signals encolados sin upload
        'nova_history',         // por compatibilidad si alguna vez se persistió en localStorage
      ]
      const toDelete = []
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i)
        if (!k) continue
        if (KNOWN_PREFIXES.some(p => k === p || k.startsWith(`${p}_`))) {
          toDelete.push(k)
        }
      }
      for (const k of toDelete) localStorage.removeItem(k)
    } catch {}
  },

  // ── Flush offline queue ─────────────────────────────────────────────────────

  async flushQueue() {
    if (!supabase || !navigator.onLine) return
    const q = cacheGet(QUEUE_KEY, [])
    if (q.length === 0) return
    const failed = []
    for (const op of q) {
      try { await executeOp(op) } catch { failed.push(op) }
    }
    cacheSet(QUEUE_KEY, failed)
    if (failed.length === 0) console.log('[Focus] 🔄 Cola offline sincronizada')
  },
}

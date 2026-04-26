import { supabase } from '../lib/supabase'

// ── Cache helpers ─────────────────────────────────────────────────────────────

function cacheGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function cacheSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
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
    // Necesario para backfillear `date` en eventos legacy creados sin fecha:
    // un evento con date=null aparecía como "hoy" para siempre y se arrastraba
    // día tras día. Con createdAt podemos estamparlo en su día real.
    createdAt: row.created_at ?? null,
  }
}

function taskToDb(task, userId) {
  return {
    id: task.id, user_id: userId,
    label: task.label, done: task.done,
    priority: task.priority ?? 'Media',
    category: task.category ?? 'hoy',
    done_at: task.doneAt ?? null,
  }
}

function taskFromDb(row) {
  return {
    id: row.id, label: row.label, done: row.done,
    priority: row.priority, category: row.category,
    doneAt: row.done_at,
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
    if (userId) cacheSet(`focus_events_${userId}`, events)
    else cacheSet('focus_events', events)
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
    if (userId) cacheSet(`focus_tasks_${userId}`, tasks)
    else cacheSet('focus_tasks', tasks)
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

  getCachedSuggestions() { return cacheGet('focus_suggestions', []) },
  setCachedSuggestions(suggestions) { cacheSet('focus_suggestions', suggestions) },

  async fetchSuggestions(userId) {
    if (!supabase) return this.getCachedSuggestions()
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

  getCachedMemories() { return cacheGet('focus_user_memories', []) },
  setCachedMemories(memories) { cacheSet('focus_user_memories', memories) },

  async fetchMemories(userId) {
    if (!supabase) return this.getCachedMemories()
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

import { useState, useEffect, useRef } from 'react'
import { dataService } from '../services/dataService'
import { logSignal } from '../services/signalsService'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useCoalescedRefetch } from './useCoalescedRefetch'
import { getTaskLinks, setTaskLink, clearTaskLink } from '../utils/taskLinks'

// Hidrata tasks con el linkedEventId guardado en localStorage. La columna
// linked_event_id no existe en Supabase (evitamos migrar), así que mantenemos
// la asociación tarea↔evento en un mapa local y la superponemos al volver
// del backend.
function hydrateTasksWithLinks(rawTasks, userId) {
  const links = getTaskLinks(userId)
  if (!rawTasks) return rawTasks
  return rawTasks.map(t => (links[t.id] ? { ...t, linkedEventId: links[t.id] } : t))
}

export function useTasks() {
  const { user } = useAuth()
  // Mismo patrón que useEvents: si el usuario borra y un refetch llega antes
  // de que Supabase confirme el DELETE, ignoramos la tarea "resucitada".
  const pendingDeletesRef = useRef(new Set())

  // Sin usuario arrancamos vacío: la caché global (focus_tasks sin userId)
  // solía dejar "tareas fantasma" de sesiones anteriores flotando al iniciar
  // sesión. Las tareas reales llegan del refetch a Supabase con user.id.
  const [tasks, setTasks] = useState([])

  const refetch = useCoalescedRefetch(async (tag = '') => {
    if (!user) return
    try {
      const cloudTasks = await dataService.fetchTasks(user.id)
      if (!cloudTasks) return
      const pending = pendingDeletesRef.current
      const filtered = pending.size > 0
        ? cloudTasks.filter(t => !pending.has(t.id))
        : cloudTasks
      const hydrated = hydrateTasksWithLinks(filtered, user.id)
      setTasks(hydrated)
      dataService.setCachedTasks(hydrated, user.id)
      console.log(`[Focus] ☁️ ${filtered.length} tareas cargadas ${tag} (user=${user.id.slice(0,8)})`)
    } catch (err) {
      console.warn('[Focus] ⚠️ No se pudo cargar tareas de Supabase', err)
    }
  })

  useEffect(() => {
    if (!user) {
      // Al cerrar sesión limpiamos el estado para que la caché global no
      // quede contaminada con tareas del usuario anterior.
      setTasks([])
      return
    }

    setTasks(hydrateTasksWithLinks(dataService.getCachedTasks([], user.id), user.id))

    refetch('(init)')

    const onVisibility = () => { if (!document.hidden) refetch('(visibilitychange)') }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    const channel = supabase
      .channel(`tasks-${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${user.id}` },
        () => refetch('(realtime)'),
      )
      .subscribe()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
      supabase.removeChannel(channel)
    }
  }, [user?.id, refetch])

  useEffect(() => {
    // Solo persistimos caché cuando hay usuario. Sin sesión no escribimos a
    // la clave global para no dejar residuos que reaparezcan al re-login.
    if (!user?.id) return
    dataService.setCachedTasks(tasks, user.id)
  }, [tasks, user?.id])

  function addTask({ label, priority = 'Media', category = 'hoy', linkedEventId = null }) {
    const t = { id: `tsk-${Date.now()}`, label, done: false, priority, category }
    if (linkedEventId) t.linkedEventId = linkedEventId
    console.log(`[Focus] ➕ addTask: "${label}"${linkedEventId ? ` (ligada a ${linkedEventId})` : ''}`)
    setTasks(prev => [...prev, t])
    if (user) dataService.upsertTask(t, user.id).catch(console.warn)
    if (linkedEventId) setTaskLink(t.id, linkedEventId, user?.id)
    return t
  }

  function toggleTask(id) {
    setTasks(prev => {
      const next = prev.map(t => {
        if (t.id !== id) return t
        return { ...t, done: !t.done, doneAt: !t.done ? Date.now() : null }
      })
      const updated = next.find(t => t.id === id)
      if (updated) {
        if (user) dataService.upsertTask(updated, user.id).catch(console.warn)
        // Señal: solo al marcar como completa (no al desmarcar)
        if (updated.done) {
          const now = new Date()
          logSignal('task_completed', {
            hour: now.getHours(),
            weekday: now.getDay(),
            category: updated.category,
            priority: updated.priority,
          })
        }
      }
      return next
    })
  }

  function deleteTask(id) {
    pendingDeletesRef.current.add(id)
    setTasks(prev => prev.filter(t => t.id !== id))
    clearTaskLink(id, user?.id)
    if (user) {
      dataService.deleteTask(id, user.id)
        .catch(console.warn)
        .finally(() => pendingDeletesRef.current.delete(id))
    } else {
      pendingDeletesRef.current.delete(id)
    }
  }

  function updateTask(id, updates) {
    setTasks(prev => {
      const next = prev.map(t => t.id === id ? { ...t, ...updates } : t)
      if (user) {
        const updated = next.find(t => t.id === id)
        if (updated) dataService.upsertTask(updated, user.id).catch(console.warn)
      }
      return next
    })
  }

  return { tasks, addTask, toggleTask, deleteTask, updateTask }
}

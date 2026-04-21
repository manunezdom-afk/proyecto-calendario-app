import { useState, useEffect, useRef } from 'react'
import { dataService } from '../services/dataService'
import { logSignal } from '../services/signalsService'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useCoalescedRefetch } from './useCoalescedRefetch'

export function useTasks() {
  const { user } = useAuth()
  // Mismo patrón que useEvents: si el usuario borra y un refetch llega antes
  // de que Supabase confirme el DELETE, ignoramos la tarea "resucitada".
  const pendingDeletesRef = useRef(new Set())

  const [tasks, setTasks] = useState(() => dataService.getCachedTasks([]))

  const refetch = useCoalescedRefetch(async (tag = '') => {
    if (!user) return
    try {
      const cloudTasks = await dataService.fetchTasks(user.id)
      if (!cloudTasks) return
      const pending = pendingDeletesRef.current
      const filtered = pending.size > 0
        ? cloudTasks.filter(t => !pending.has(t.id))
        : cloudTasks
      setTasks(filtered)
      dataService.setCachedTasks(filtered, user.id)
      console.log(`[Focus] ☁️ ${filtered.length} tareas cargadas ${tag} (user=${user.id.slice(0,8)})`)
    } catch (err) {
      console.warn('[Focus] ⚠️ No se pudo cargar tareas de Supabase', err)
    }
  })

  useEffect(() => {
    if (!user) return

    setTasks(dataService.getCachedTasks([], user.id))

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
    dataService.setCachedTasks(tasks, user?.id)
  }, [tasks, user?.id])

  function addTask({ label, priority = 'Media', category = 'hoy' }) {
    const t = { id: `tsk-${Date.now()}`, label, done: false, priority, category }
    console.log(`[Focus] ➕ addTask: "${label}"`)
    setTasks(prev => [...prev, t])
    if (user) dataService.upsertTask(t, user.id).catch(console.warn)
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

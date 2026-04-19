import { useState, useEffect } from 'react'
import { dataService } from '../services/dataService'
import { useAuth } from '../context/AuthContext'

export function useTasks() {
  const { user } = useAuth()

  const [tasks, setTasks] = useState(() => dataService.getCachedTasks([]))

  useEffect(() => {
    if (!user) return
    dataService.fetchTasks(user.id)
      .then(cloudTasks => {
        if (!cloudTasks) return
        setTasks(cloudTasks)
        dataService.setCachedTasks(cloudTasks)
      })
      .catch(err => console.warn('[Focus] ⚠️ No se pudo cargar tareas de Supabase', err))
  }, [user?.id])

  useEffect(() => {
    dataService.setCachedTasks(tasks)
  }, [tasks])

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
      if (user) {
        const updated = next.find(t => t.id === id)
        if (updated) dataService.upsertTask(updated, user.id).catch(console.warn)
      }
      return next
    })
  }

  function deleteTask(id) {
    setTasks(prev => prev.filter(t => t.id !== id))
    if (user) dataService.deleteTask(id, user.id).catch(console.warn)
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

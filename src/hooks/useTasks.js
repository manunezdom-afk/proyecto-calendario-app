import { useState, useEffect } from 'react'
import { dataService } from '../services/dataService'
import { logSignal } from '../services/signalsService'
import { useAuth } from '../context/AuthContext'
import { uid } from '../utils/uid'

const DEFAULT_TASKS = [
  { id: 'tsk-001', label: 'Revisar Roadmap del Q4', done: false, priority: 'Alta', category: 'hoy' },
  { id: 'tsk-002', label: 'Preparar diapositivas de presentación', done: false, priority: 'Media', category: 'hoy' },
  { id: 'tsk-003', label: 'Responder emails pendientes', done: false, priority: 'Baja', category: 'hoy' },
  { id: 'tsk-004', label: 'Revisar métricas de producto', done: false, priority: 'Media', category: 'semana' },
  { id: 'tsk-005', label: 'Documentar API nueva', done: false, priority: 'Baja', category: 'algún día' },
]

export function useTasks() {
  const { user } = useAuth()

  const [tasks, setTasks] = useState(() => dataService.getCachedTasks(DEFAULT_TASKS))

  useEffect(() => {
    if (!user) return
    dataService.fetchTasks(user.id)
      .then(cloudTasks => {
        if (!cloudTasks) return
        const result = cloudTasks.length > 0 ? cloudTasks : DEFAULT_TASKS
        setTasks(result)
        dataService.setCachedTasks(result)
      })
      .catch(err => console.warn('[Focus] ⚠️ No se pudo cargar tareas de Supabase', err))
  }, [user?.id])

  useEffect(() => {
    dataService.setCachedTasks(tasks)
  }, [tasks])

  function addTask({ label, priority = 'Media', category = 'hoy' }) {
    const t = { id: uid('tsk'), label, done: false, priority, category }
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

import { useState, useEffect } from 'react'
import { dataService } from '../services/dataService'
import { logSignal } from '../services/signalsService'
import { useAuth } from '../context/AuthContext'

// IDs de las tareas demo viejas. Antes el hook pre-poblaba el estado con 5
// tareas sample ("Revisar Roadmap del Q4", etc.) para que la UI no se viera
// vacía en la primera visita — pero confundía al usuario porque aparecían
// como "pendientes" reales en Mi Día. Ahora arrancamos en blanco. Para los
// usuarios que ya tenían las demo cacheadas, las limpiamos al montar.
const LEGACY_DEMO_IDS = new Set([
  'tsk-001', 'tsk-002', 'tsk-003', 'tsk-004', 'tsk-005',
])

function cleanLegacyDemo(list) {
  if (!Array.isArray(list)) return []
  return list.filter((t) => !LEGACY_DEMO_IDS.has(t.id))
}

export function useTasks() {
  const { user } = useAuth()

  const [tasks, setTasks] = useState(() => cleanLegacyDemo(dataService.getCachedTasks([])))

  useEffect(() => {
    if (!user) return
    dataService.fetchTasks(user.id)
      .then(cloudTasks => {
        if (!cloudTasks) return
        const result = cleanLegacyDemo(cloudTasks)
        setTasks(result)
        dataService.setCachedTasks(result)
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

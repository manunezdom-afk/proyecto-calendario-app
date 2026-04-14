import { useState, useEffect } from 'react'

const STORAGE_KEY = 'focus_tasks'

const DEFAULT_TASKS = [
  { id: 'tsk-001', label: 'Revisar Roadmap del Q4', done: false, priority: 'Alta', category: 'hoy' },
  { id: 'tsk-002', label: 'Preparar diapositivas de presentación', done: false, priority: 'Media', category: 'hoy' },
  { id: 'tsk-003', label: 'Responder emails pendientes', done: false, priority: 'Baja', category: 'hoy' },
  { id: 'tsk-004', label: 'Revisar métricas de producto', done: false, priority: 'Media', category: 'semana' },
  { id: 'tsk-005', label: 'Documentar API nueva', done: false, priority: 'Baja', category: 'algún día' },
]

export function useTasks() {
  const [tasks, setTasks] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored)
    } catch (_) {}
    return DEFAULT_TASKS
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
    } catch (_) {}
  }, [tasks])

  function addTask({ label, priority = 'Media', category = 'hoy' }) {
    const t = { id: `tsk-${Date.now()}`, label, done: false, priority, category }
    console.log(`[Focus] ➕ addTask: "${label}" [${priority}] [${category}]`)
    setTasks((prev) => [...prev, t])
    return t
  }

  function toggleTask(id) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const next = { ...t, done: !t.done }
        console.log(`[Focus] ☑️ Task "${t.label}" → ${next.done ? 'done' : 'pending'}`)
        return next
      }),
    )
  }

  function deleteTask(id) {
    setTasks((prev) => {
      const target = prev.find((t) => t.id === id)
      if (target) console.log(`[Focus] 🗑️ deleteTask: "${target.label}"`)
      return prev.filter((t) => t.id !== id)
    })
  }

  function updateTask(id, updates) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
  }

  return { tasks, addTask, toggleTask, deleteTask, updateTask }
}

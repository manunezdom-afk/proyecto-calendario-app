import { useState, useEffect, useRef } from 'react'
import { dataService } from '../services/dataService'
import { logSignal } from '../services/signalsService'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useCoalescedRefetch } from './useCoalescedRefetch'
import { getTaskLinks, setTaskLink, clearTaskLink } from '../utils/taskLinks'
import { getTaskParents, setTaskParent, clearTaskParent } from '../utils/taskParents'
import { cleanGeneratedTitle } from '../utils/titleCleanup'
import { focusLog } from '../utils/debug'

// Hidrata tasks con relaciones que viven solo en localStorage (no en Supabase):
// · linkedEventId: tarea anclada a un evento concreto (subtarea de una reunión).
// · parentTaskId : tarea anclada a otra tarea (subtarea jerárquica).
// Ambas se superponen al volver del backend para que la UI las renderice
// agrupadas en Mi Día sin requerir migración del schema.
function hydrateTasksWithLinks(rawTasks, userId) {
  if (!rawTasks) return rawTasks
  const links   = getTaskLinks(userId)
  const parents = getTaskParents(userId)
  return rawTasks.map(t => {
    let next = t
    if (links[t.id])   next = { ...next, linkedEventId: links[t.id] }
    if (parents[t.id]) next = { ...next, parentTaskId:  parents[t.id] }
    return next
  })
}

// TTL para preservar una tarea local cuya upsert a Supabase aún puede estar
// viajando. Pasado ese tiempo asumimos que el refetch ya debería reflejarla
// y la soltamos del escudo — evita que tareas zombies queden eternamente si
// Supabase rechazó la escritura.
const PENDING_UPSERT_TTL_MS = 15_000

function createTaskId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `tsk-${crypto.randomUUID()}`
  }
  return `tsk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useTasks() {
  const { user } = useAuth()
  // Mismo patrón que useEvents: si el usuario borra y un refetch llega antes
  // de que Supabase confirme el DELETE, ignoramos la tarea "resucitada".
  const pendingDeletesRef = useRef(new Set())
  // Tareas recién creadas/editadas cuyo upsert puede estar en vuelo. Sin este
  // escudo, un refetch de realtime/visibilitychange puede traer un snapshot
  // anterior y borrar la tarea local unos segundos después de crearla.
  const pendingUpsertsRef = useRef(new Map())

  function markPendingUpsert(task) {
    if (!task?.id) return
    pendingUpsertsRef.current.set(task.id, { task, markedAt: Date.now() })
  }

  function sweepStalePending() {
    const now = Date.now()
    for (const [id, { markedAt }] of pendingUpsertsRef.current) {
      if (now - markedAt > PENDING_UPSERT_TTL_MS) pendingUpsertsRef.current.delete(id)
    }
  }

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
      const cloudFiltered = pending.size > 0
        ? cloudTasks.filter(t => !pending.has(t.id))
        : cloudTasks

      // Preservar upserts pendientes: si el cloud ya trae el id, el escudo
      // cumplió su función y lo soltamos. Si no, mantenemos la tarea local
      // dentro del TTL para que un refetch rápido (realtime, visibility)
      // no borre una tarea recién creada que aún está viajando al backend.
      sweepStalePending()
      const cloudIds = new Set(cloudFiltered.map(t => t.id))
      const pendingToKeep = []
      for (const [id, { task }] of pendingUpsertsRef.current) {
        if (cloudIds.has(id)) {
          pendingUpsertsRef.current.delete(id)
        } else {
          pendingToKeep.push(task)
        }
      }
      const merged = pendingToKeep.length > 0
        ? [...cloudFiltered, ...pendingToKeep]
        : cloudFiltered

      const hydrated = hydrateTasksWithLinks(merged, user.id)
      setTasks(hydrated)
      dataService.setCachedTasks(hydrated, user.id)
      if (pendingToKeep.length > 0) {
        focusLog(`[Focus] ☁️ ${cloudFiltered.length} tareas + ${pendingToKeep.length} pendientes ${tag}`)
      } else {
        focusLog(`[Focus] ☁️ ${cloudFiltered.length} tareas cargadas ${tag} (user=${user.id.slice(0,8)})`)
      }
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

  function addTask({ label, priority = 'Media', category = 'hoy', linkedEventId = null, parentTaskId = null }) {
    const cleanLabel = cleanGeneratedTitle(label) || label
    const t = { id: createTaskId(), label: cleanLabel, done: false, priority, category }
    if (linkedEventId) t.linkedEventId = linkedEventId
    // parentTaskId es la jerarquía tarea↔tarea. linkedEventId tiene prioridad
    // visual: si Nova mandó ambos, mostramos la tarea bajo el evento (más
    // específico) pero igual guardamos parentTaskId por si después el evento
    // desaparece y queda solo el padre tarea.
    if (parentTaskId && parentTaskId !== t.id) t.parentTaskId = parentTaskId
    focusLog(
      `[Focus] ➕ addTask: "${cleanLabel}"`
      + (linkedEventId ? ` (ligada a evento ${linkedEventId})` : '')
      + (parentTaskId ? ` (subtarea de ${parentTaskId})` : ''),
    )
    setTasks(prev => [...prev, t])
    // Proteger contra refetch que llegue antes de que Supabase confirme.
    markPendingUpsert(t)
    if (user) dataService.upsertTask(t, user.id).catch(console.warn)
    if (linkedEventId) setTaskLink(t.id, linkedEventId, user?.id)
    if (t.parentTaskId) setTaskParent(t.id, t.parentTaskId, user?.id)
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
        markPendingUpsert(updated)
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
    pendingUpsertsRef.current.delete(id)
    setTasks(prev => prev.filter(t => t.id !== id))
    clearTaskLink(id, user?.id)
    clearTaskParent(id, user?.id)
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
        if (updated) {
          markPendingUpsert(updated)
          dataService.upsertTask(updated, user.id).catch(console.warn)
        }
      }
      return next
    })
    // Si el update modifica la jerarquía padre, persistimos en localStorage —
    // Supabase no la conoce, así que no viaja por upsertTask.
    if (user && 'parentTaskId' in updates) {
      if (updates.parentTaskId && updates.parentTaskId !== id) {
        setTaskParent(id, updates.parentTaskId, user.id)
      } else {
        clearTaskParent(id, user.id)
      }
    }
  }

  return { tasks, addTask, toggleTask, deleteTask, updateTask }
}

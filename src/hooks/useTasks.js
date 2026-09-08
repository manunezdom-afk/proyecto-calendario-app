import { commitCachedCollection, mergePendingCollection, advanceAccountEpoch } from '../utils/verifiedMutation.js'
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

// Ventana para dedupe defensivo de tareas. Si llega un add_task con misma
// `(label normalizado, category)` dentro de esta ventana, descartamos el
// segundo. Cubre: LLM emitiendo dos add_task accidentalmente, doble click
// en aprobar sugerencia. Mismo patrón que useEvents.
const DEDUPE_WINDOW_MS = 4_000

function normalizeLabelForDedupe(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

function createTaskId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `tsk-${crypto.randomUUID()}`
  }
  return `tsk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useTasks() {
  const { user } = useAuth()
  const accountEpochRef = useRef(null)
  accountEpochRef.current = advanceAccountEpoch(accountEpochRef.current, user?.id)
  const collectionEpochRef = useRef(accountEpochRef.current)
  // Mismo patrón que useEvents: si el usuario borra y un refetch llega antes
  // de que Supabase confirme el DELETE, ignoramos la tarea "resucitada".
  const pendingDeletesRef = useRef(new Set())
  // Tareas recién creadas/editadas cuyo upsert puede estar en vuelo. Sin este
  // escudo, un refetch de realtime/visibilitychange puede traer un snapshot
  // anterior y borrar la tarea local unos segundos después de crearla.
  const pendingUpsertsRef = useRef(new Map())
  // Tracker de creaciones recientes para dedupe — ver comentario en useEvents.
  const recentCreationsRef = useRef(new Map())

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
  const [tasks, setTasksState] = useState([])
  const tasksRef = useRef(tasks)
  const setTasks = (next) => {
    const value = typeof next === 'function' ? next(tasksRef.current) : next
    tasksRef.current = value
    setTasksState(value)
  }
  const commitTasks = (next) => collectionEpochRef.current === accountEpochRef.current && commitCachedCollection(next,
    value => dataService.setCachedTasks(value, user?.id), setTasks)

  const refetch = useCoalescedRefetch(async (tag = '') => {
    if (!user) return
    const epoch = accountEpochRef.current
    try {
      const cloudTasks = await dataService.fetchTasks(user.id)
      if (accountEpochRef.current !== epoch || !Array.isArray(cloudTasks)) return
      if (!cloudTasks) return
      const pending = pendingDeletesRef.current
      const cloudFiltered = pending.size > 0
        ? cloudTasks.filter(t => !pending.has(t.id))
        : cloudTasks

      const { merged, pendingToKeep } = mergePendingCollection(cloudFiltered, pendingUpsertsRef.current,
        'task', ['label', 'done', 'priority', 'category', 'date', 'time'])
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
      throw err
    }
  })

  // Reintentos con backoff cuando el (init) falla: si el usuario abre el
  // dispositivo y Supabase tarda o la red está jitterosa, sin reintento la UI
  // queda mostrando la caché del día anterior hasta que el usuario vuelva a
  // foreground. Tres intentos (0.8s, 2s, 5s) cubren red intermitente sin
  // golpear infinito en outage real.
  const refetchWithRetry = useRef(null)
  refetchWithRetry.current = async (tag) => {
    const delays = [800, 2000, 5000]
    for (let i = 0; i <= delays.length; i++) {
      try {
        await refetch(tag)
        return
      } catch {
        if (i === delays.length) return
        await new Promise(r => setTimeout(r, delays[i]))
      }
    }
  }

  useEffect(() => {
    pendingDeletesRef.current.clear()
    pendingUpsertsRef.current.clear()
    recentCreationsRef.current.clear()
    collectionEpochRef.current = accountEpochRef.current
    if (!user) {
      // Al cerrar sesión limpiamos el estado para que la caché global no
      // quede contaminada con tareas del usuario anterior.
      setTasks([])
      return
    }

    setTasks(hydrateTasksWithLinks(dataService.getCachedTasks([], user.id), user.id))

    refetchWithRetry.current('(init)')

    const onVisibility = () => { if (!document.hidden) refetch('(visibilitychange)') }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    // pageshow: iOS PWA + BFCache restauran la página sin disparar
    // visibilitychange — sin este listener el usuario veía la caché del día
    // anterior hasta tocar la pantalla.
    const onPageShow = () => refetch('(pageshow)')
    window.addEventListener('pageshow', onPageShow)

    // online: si el dispositivo recuperó red (modo avión, túnel, etc),
    // forzamos resync para traer cambios hechos en otro device mientras
    // estábamos offline.
    const onOnline = () => refetch('(online)')
    window.addEventListener('online', onOnline)

    // El canal realtime puede morir en background (Safari iOS suspende el
    // WebSocket). Cuando se resuscribe, los cambios que ocurrieron mientras
    // estaba caído NO se replayan — por eso forzamos un refetch en cada
    // SUBSCRIBED para hacer catch-up. El init ya disparó uno, pero el
    // coalesced refetch dedupea la ráfaga.
    const channel = supabase
      .channel(`tasks-${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${user.id}` },
        () => refetch('(realtime)'),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refetch('(realtime-subscribed)')
      })

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
      supabase.removeChannel(channel)
    }
  }, [user?.id, refetch])


  function addTask({ id: proposedId, label, priority = 'Media', category = 'hoy', linkedEventId = null, parentTaskId = null, date = null, time = null }) {
    const cleanLabel = cleanGeneratedTitle(label) || label
    if (typeof cleanLabel !== 'string' || !cleanLabel.trim()) return null
    if (proposedId && tasksRef.current.some(task => task.id === proposedId)) return tasksRef.current.find(task => task.id === proposedId)

    // Dedupe defensivo: si la misma `(label|category)` llegó hace menos de
    // DEDUPE_WINDOW_MS, devolvemos la tarea anterior. Cubre LLM duplicado y
    // doble-tap en aprobar sugerencia.
    const dedupeKey = `${normalizeLabelForDedupe(cleanLabel)}|${category}|${date || ''}|${time || ''}`
    const now = Date.now()
    const recent = recentCreationsRef.current.get(dedupeKey)
    if (!proposedId && recent && now - recent.at < DEDUPE_WINDOW_MS && tasksRef.current.some(item => item.id === recent.task.id)) {
      focusLog(`[Focus] 🛡️ addTask dedupe: "${cleanLabel}" (${dedupeKey}) — ignorada`)
      return tasksRef.current.find(item => item.id === recent.task.id)
    }

    const t = { id: proposedId || createTaskId(), label: cleanLabel, done: false, priority, category, date, time }
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
    if (!commitTasks([...tasksRef.current, t])) return null
    recentCreationsRef.current.set(dedupeKey, { at: now, task: t })
    if (recentCreationsRef.current.size > 64) {
      for (const [k, v] of recentCreationsRef.current) {
        if (now - v.at > DEDUPE_WINDOW_MS * 2) recentCreationsRef.current.delete(k)
      }
    }
    // Proteger contra refetch que llegue antes de que Supabase confirme.
    markPendingUpsert(t)
    if (user) dataService.upsertTask(t, user.id).catch(console.warn)
    if (linkedEventId) setTaskLink(t.id, linkedEventId, user?.id)
    if (t.parentTaskId) setTaskParent(t.id, t.parentTaskId, user?.id)
    return t
  }

  function toggleTask(id) {
    const target = tasksRef.current.find(task => task.id === id)
    if (!target) return null
    return updateTask(id, { done: !target.done, doneAt: !target.done ? Date.now() : null })
  }

  function deleteTask(id) {
    if (!tasksRef.current.some(task => task.id === id)) return false
    if (!commitTasks(tasksRef.current.filter(task => task.id !== id))) return false
    pendingDeletesRef.current.add(id)
    pendingUpsertsRef.current.delete(id)
    clearTaskLink(id, user?.id)
    clearTaskParent(id, user?.id)
    if (user) {
      dataService.deleteTask(id, user.id)
        .catch(console.warn)
        .finally(() => pendingDeletesRef.current.delete(id))
    } else {
      pendingDeletesRef.current.delete(id)
    }
    return true
  }

  function updateTask(id, updates) {
    const target = tasksRef.current.find(task => task.id === id)
    if (!target || !updates || typeof updates !== 'object') return null
    const updated = { ...target, ...updates, id }
    if (typeof updated.label !== 'string' || !updated.label.trim()) return null
    if ('done' in updates) updated.doneAt = updated.done ? (target.doneAt || Date.now()) : null
    if (!commitTasks(tasksRef.current.map(task => task.id === id ? updated : task))) return null
    markPendingUpsert(updated)
    if (user) dataService.upsertTask(updated, user.id).catch(console.warn)
    if (!target.done && updated.done) {
      const now = new Date()
      logSignal('task_completed', { hour: now.getHours(), weekday: now.getDay(), category: updated.category, priority: updated.priority })
    }
    // Si el update modifica la jerarquía padre, persistimos en localStorage —
    // Supabase no la conoce, así que no viaja por upsertTask.
    if (user && 'parentTaskId' in updates) {
      if (updates.parentTaskId && updates.parentTaskId !== id) {
        setTaskParent(id, updates.parentTaskId, user.id)
      } else {
        clearTaskParent(id, user.id)
      }
    }
    return updated
  }

  return { tasks: collectionEpochRef.current === accountEpochRef.current ? tasks : [], addTask, toggleTask, deleteTask, updateTask }
}

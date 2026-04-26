import { useState, useEffect, useRef, useCallback } from 'react'
import { dataService } from '../services/dataService'
import { logSignal } from '../services/signalsService'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useCoalescedRefetch } from './useCoalescedRefetch'
import { cleanGeneratedTitle } from '../utils/titleCleanup'
import { composeTimeRange, parseTimeRange } from '../utils/eventDuration'
import { isReminderItem } from '../utils/reminders'
import { focusLog } from '../utils/debug'

// Extrae la hora (0-23) de un string "HH:MM" o "HH:MM – HH:MM"
function parseEventHour(time) {
  if (!time) return null
  const m = String(time).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  return h >= 0 && h <= 23 ? h : null
}

// Normaliza el campo `time` que se guarda en DB a partir de time + endTime
// (posiblemente separados, como los emite Nova). Ver comentarios en addEvent
// para las reglas. Devuelve el string final o '' si no hay hora.
function normalizeTimeField({ time, endTime, isReminder }) {
  if (!time) return ''
  // Recordatorios no tienen duración. Si viene un rango, nos quedamos con
  // el inicio; si viene endTime separado, lo ignoramos.
  if (isReminder) return String(time).split('-')[0].trim()
  // Si `time` ya es un rango válido, respetarlo.
  const existingRange = parseTimeRange(time)
  if (existingRange && existingRange.endH != null && existingRange.endH > existingRange.startH) {
    return time
  }
  // Si llega un endTime separado y coherente, componer el rango.
  if (endTime) {
    const startH = existingRange?.startH ?? null
    const endRange = parseTimeRange(endTime)
    const endH = endRange?.startH ?? null // el endTime viene como string de hora simple
    if (startH != null && endH != null && endH > startH) {
      const startMinutes = Math.round(startH * 60)
      const endMinutes = Math.round(endH * 60)
      return composeTimeRange(time, endMinutes - startMinutes)
    }
  }
  // Sin end → dejamos la hora de inicio tal cual.
  return time
}

// Ventana para considerar un upsert "en vuelo": si el refetch llega antes de
// que Supabase confirme el INSERT/UPDATE, preservamos el evento local durante
// este tiempo. Sin este escudo, Nova creaba un recordatorio y el realtime
// subsiguiente disparaba un refetch que traía un snapshot de Supabase todavía
// sin commitear — y el `setEvents(cloudEvents)` borraba tanto el recordatorio
// como cualquier otro evento con upsert en curso. Resultado: "desapareció de
// la nada".
const PENDING_UPSERT_TTL_MS = 60_000

export function useEvents() {
  const { user } = useAuth()
  // IDs de eventos cuyo DELETE está en vuelo — evita que un refetch previo a la
  // confirmación de Supabase restaure el evento en el estado local (race condition
  // especialmente común en iOS donde visibilitychange dispara refetch en cada tap).
  const pendingDeletesRef = useRef(new Set())

  // Eventos recién agregados/editados cuyo upsert a Supabase puede estar en
  // vuelo. Guardamos el evento completo + timestamp: si cloudEvents todavía
  // no los trae, los preservamos hasta TTL o hasta que el backend confirme.
  // Map<id, { event, markedAt }>
  const pendingUpsertsRef = useRef(new Map())

  const markPendingUpsert = useCallback((event) => {
    if (!event?.id) return
    pendingUpsertsRef.current.set(event.id, { event, markedAt: Date.now() })
  }, [])

  const sweepStalePending = useCallback(() => {
    const now = Date.now()
    for (const [id, { markedAt }] of pendingUpsertsRef.current) {
      if (now - markedAt > PENDING_UPSERT_TTL_MS) {
        pendingUpsertsRef.current.delete(id)
      }
    }
  }, [])

  // Sin usuario arrancamos vacío: la caché global (focus_events sin userId)
  // solía mostrar eventos de una sesión anterior al iniciar sesión otra vez.
  // La fuente real al login es la tabla events de Supabase.
  const [events, setEvents] = useState([])

  const refetch = useCoalescedRefetch(async (tag = '') => {
    if (!user) return
    try {
      const cloudEvents = await dataService.fetchEvents(user.id)
      const pendingDeletes = pendingDeletesRef.current
      const cloudFiltered = pendingDeletes.size > 0
        ? cloudEvents.filter(e => !pendingDeletes.has(e.id))
        : cloudEvents
      const cloudIds = new Set(cloudFiltered.map(e => e.id))

      // Preservar upserts en vuelo: si el cloud ya trae el id, el pending
      // cumplió su propósito y lo soltamos. Si no, mantenemos el evento local
      // (dentro del TTL) para que un refetch acelerado por realtime no borre
      // un evento que todavía está viajando al backend.
      sweepStalePending()
      const pendingToKeep = []
      for (const [id, { event }] of pendingUpsertsRef.current) {
        if (cloudIds.has(id)) {
          pendingUpsertsRef.current.delete(id)
        } else {
          pendingToKeep.push(event)
        }
      }

      const merged = pendingToKeep.length > 0
        ? [...cloudFiltered, ...pendingToKeep]
        : cloudFiltered
      setEvents(merged)
      dataService.setCachedEvents(merged, user.id)
      if (pendingToKeep.length > 0) {
        focusLog(`[Focus] ☁️ ${cloudFiltered.length} en nube + ${pendingToKeep.length} pendientes ${tag}`)
      } else {
        focusLog(`[Focus] ☁️ ${merged.length} eventos cargados ${tag} (user=${user.id.slice(0,8)})`)
      }
    } catch (err) {
      console.warn('[Focus] ⚠️ No se pudo cargar eventos de Supabase', err)
      throw err
    }
  })

  // Reintentos con backoff cuando el (init) falla: si Supabase tarda o la red
  // está jitterosa al abrir el dispositivo, sin reintento la UI queda mostrando
  // la caché del día anterior. Ver useTasks.js para el mismo patrón.
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

  // Carga desde Supabase cuando el usuario inicia sesión
  useEffect(() => {
    if (!user) {
      // Al cerrar sesión, limpiamos el estado para que no quede contaminando
      // la próxima sesión (antes los eventos se escribían a la caché global).
      setEvents([])
      return
    }

    // Al cambiar de usuario, partimos del cache propio (no del global compartido)
    setEvents(dataService.getCachedEvents(user.id))

    refetchWithRetry.current('(init)')

    // Sync al volver a la pestaña. visibilitychange y focus suelen disparar a
    // la vez en iOS: el helper coalesced dedupea la ráfaga.
    const onVisibility = () => { if (!document.hidden) refetch('(visibilitychange)') }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    // pageshow: iOS PWA + BFCache restauran la página sin disparar
    // visibilitychange. Sin esto, al cambiar de dispositivo y volver a la app
    // el usuario veía sólo la caché del día anterior.
    const onPageShow = () => refetch('(pageshow)')
    window.addEventListener('pageshow', onPageShow)

    // online: forzar resync cuando el dispositivo recupera red para traer
    // cambios hechos en otro device mientras estábamos offline.
    const onOnline = () => refetch('(online)')
    window.addEventListener('online', onOnline)

    // Realtime: el WebSocket puede morir en background (Safari iOS lo
    // suspende). Cuando se resuscribe, los cambios que ocurrieron mientras
    // estaba caído NO se replayan — por eso forzamos un refetch en cada
    // SUBSCRIBED para hacer catch-up.
    const channel = supabase
      .channel(`events-${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `user_id=eq.${user.id}` },
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

  // Mantiene el cache local sincronizado (scoped por user)
  useEffect(() => {
    // Solo persistimos caché cuando hay usuario. Sin sesión no escribimos a
    // la clave global para no dejar residuos que reaparezcan al re-login.
    if (!user?.id) return
    dataService.setCachedEvents(events, user.id)
  }, [events, user?.id])

  function addEvent({ title, time, endTime = null, description = '', section = 'focus', icon = 'event', dotColor = 'bg-secondary-container', date = null, reminderOffsets = null, timezone = null }) {
    let tz = timezone
    if (!tz) {
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { tz = null }
    }

    // Normalización del campo time:
    //   · Los recordatorios nunca llevan hora de término — el aviso es
    //     puntual, no un bloque con duración.
    //   · Si time ya viene como rango "HH:MM AM/PM - HH:MM AM/PM", lo dejamos.
    //   · Si viene endTime separado (como los emite Nova), lo componemos en
    //     el string `time` — así el resto de la app (time grids, Mi Día,
    //     export ICS) lee un único campo como lo ha hecho siempre.
    //   · Sin endTime: dejamos solo la hora de inicio.
    const finalTime = normalizeTimeField({
      time,
      endTime,
      isReminder: isReminderItem({ title }),
    })

    // Anclamos `date` a un YYYY-MM-DD concreto SIEMPRE. Antes, los callers que
    // no pasaban `date` (Nova foto, AddEventModal viejo, eventos de Nova sin
    // fecha explícita) terminaban guardando date=null en Supabase. Como el
    // filtro de "Mi Día" hacía `!e.date || e.date === todayISO`, ese evento
    // se mostraba como del día actual TODOS los días — un evento fantasma
    // que no se podía sacar marcándolo HECHO. Defaulting a hoy fija el bug
    // de raíz: el evento existe en una fecha real y sigue las reglas normales.
    const resolvedDate = (() => {
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()

    const newEvent = {
      // Sufijo aleatorio para garantizar unicidad cuando se disparan varios
      // addEvent en el mismo tick (ej: al crear 12 repeticiones de una
      // reunión semanal). Sin él, Date.now() repetía ID y Supabase upsert
      // colapsaba todas las filas en una.
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: cleanGeneratedTitle(title) || title,
      time: finalTime,
      description, section, featured: false, icon, dotColor,
      date: resolvedDate,
      reminderOffsets,
      timezone: tz,
    }
    focusLog(`[Focus] ➕ addEvent: "${newEvent.title}"`)
    setEvents(prev => [...prev, newEvent])
    // Marcamos el evento como "upsert pendiente" ANTES del setEvents para
    // que si el realtime de Supabase dispara un refetch entre este punto y
    // el commit del upsert, el escudo lo preserve.
    markPendingUpsert(newEvent)
    if (user) {
      dataService.upsertEvent(newEvent, user.id).catch((err) => {
        console.warn('[Focus] ⚠️ upsertEvent falló, quedará en cola offline:', err)
      })
    }
    logSignal('event_created', {
      hour: parseEventHour(finalTime),
      section,
      date,
      weekday: new Date().getDay(),
    })
    return newEvent
  }

  function deleteEvent(id) {
    focusLog(`[Focus] 🗑️ deleteEvent: "${id}"`)
    pendingDeletesRef.current.add(id)
    // Si el evento que estamos borrando estaba marcado como upsert pendiente,
    // lo sacamos — si no, el refetch lo resucitaría desde pendingUpsertsRef.
    pendingUpsertsRef.current.delete(id)
    setEvents(prev => {
      const removed = prev.find(e => e.id === id)
      if (removed) {
        logSignal('event_deleted', { section: removed.section, hour: parseEventHour(removed.time) })
      }
      return prev.filter(e => e.id !== id)
    })
    if (user) {
      dataService.deleteEvent(id, user.id)
        .catch(console.warn)
        .finally(() => pendingDeletesRef.current.delete(id))
    } else {
      pendingDeletesRef.current.delete(id)
    }
  }

  function editEvent(id, updates) {
    focusLog(`[Focus] ✏️ editEvent: "${id}"`, updates)
    setEvents(prev => {
      const next = prev.map(e => {
        if (e.id !== id) return e
        const merged = { ...e, ...updates }
        // Si el update trae endTime separado o cambia el time, renormalizamos
        // a la forma canónica del string (rango o solo inicio). Así evitamos
        // guardar un endTime suelto en el campo del evento — el resto de la
        // app siempre lee `time`.
        if ('endTime' in updates || 'time' in updates) {
          merged.time = normalizeTimeField({
            time: merged.time,
            endTime: updates.endTime ?? null,
            isReminder: isReminderItem({ title: merged.title }),
          })
          delete merged.endTime
        }
        return merged
      })
      const updated = next.find(e => e.id === id)
      if (updated) {
        // Un edit también puede ser pisado por un refetch si el realtime
        // notifica antes de que el UPDATE commitee. Lo marcamos igual.
        markPendingUpsert(updated)
        if (user) {
          dataService.upsertEvent(updated, user.id).catch((err) => {
            console.warn('[Focus] ⚠️ upsertEvent (edit) falló, quedará en cola offline:', err)
          })
        }
      }
      return next
    })
    // Señalamos si es un cambio de hora (útil para aprender cuándo reprograma)
    if (updates.time) {
      logSignal('event_moved', { to_hour: parseEventHour(updates.time) })
    }
  }

  return { events, addEvent, deleteEvent, editEvent }
}

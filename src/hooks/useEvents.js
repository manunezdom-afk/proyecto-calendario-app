import { commitCachedCollection, mergePendingCollection, advanceAccountEpoch } from '../utils/verifiedMutation.js'
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

// Ventana para deduplicación defensiva. Si Nova emite dos add_event idénticos
// (bug del LLM, doble pulsación al aceptar una sugerencia, o un retry que se
// aplica dos veces), el segundo dentro de esta ventana se descarta. Más alto
// que el TTL típico de propose-accept; suficientemente bajo para que crear
// dos veces el mismo "Almuerzo a las 14:00" en otro día siga funcionando.
const DEDUPE_WINDOW_MS = 4_000

function normalizeTitleForDedupe(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

export function useEvents() {
  const { user } = useAuth()
  const accountEpochRef = useRef(null)
  accountEpochRef.current = advanceAccountEpoch(accountEpochRef.current, user?.id)
  const collectionEpochRef = useRef(accountEpochRef.current)
  // IDs de eventos cuyo DELETE está en vuelo — evita que un refetch previo a la
  // confirmación de Supabase restaure el evento en el estado local (race condition
  // especialmente común en iOS donde visibilitychange dispara refetch en cada tap).
  const pendingDeletesRef = useRef(new Set())

  // Tracker de creaciones recientes para deduplicación defensiva. Mapea
  // `${title}|${time}|${date}` → timestamp. Sirve para casos donde Nova emite
  // dos add_event idénticos (bug del LLM) o el usuario aplica una sugerencia
  // dos veces antes de que la lista se actualice. La regla #9 del system
  // prompt previene la mayoría, pero este es el último filtro antes de Supabase.
  const recentCreationsRef = useRef(new Map())

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
  const [events, setEventsState] = useState([])
  const eventsRef = useRef(events)
  const setEvents = (next) => {
    const value = typeof next === 'function' ? next(eventsRef.current) : next
    eventsRef.current = value
    setEventsState(value)
  }
  const commitEvents = (next) => collectionEpochRef.current === accountEpochRef.current && commitCachedCollection(next,
    value => dataService.setCachedEvents(value, user?.id), setEvents)

  const refetch = useCoalescedRefetch(async (tag = '') => {
    if (!user) return
    const epoch = accountEpochRef.current
    try {
      const cloudEvents = await dataService.fetchEvents(user.id)
      if (accountEpochRef.current !== epoch || !Array.isArray(cloudEvents)) return
      const pendingDeletes = pendingDeletesRef.current
      const cloudFiltered = pendingDeletes.size > 0
        ? cloudEvents.filter(e => !pendingDeletes.has(e.id))
        : cloudEvents
      const { merged, pendingToKeep } = mergePendingCollection(cloudFiltered, pendingUpsertsRef.current,
        'event', ['title', 'time', 'date', 'description', 'section', 'icon', 'dotColor', 'featured', 'reminderOffsets', 'timezone'])
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
    pendingDeletesRef.current.clear()
    pendingUpsertsRef.current.clear()
    recentCreationsRef.current.clear()
    collectionEpochRef.current = accountEpochRef.current
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

  function addEvent({ id: proposedId, title, time, endTime = null, description = '', subtitle = null, section = 'focus', icon = 'event', dotColor = 'bg-secondary-container', date = null, reminderOffsets = null, timezone = null }) {
    if (proposedId && eventsRef.current.some(event => event.id === proposedId)) return eventsRef.current.find(event => event.id === proposedId)
    let tz = timezone
    if (!tz) {
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { tz = null }
    }

    // Nova (backend compartido con iOS) emite el detalle del evento en el
    // campo `subtitle`; en web ese campo se renderiza y persiste como
    // `description`. Sin este mapeo, el subtítulo de Nova se perdía en silencio
    // (la tabla `events` no tiene columna subtitle) — review 2026-06-11.
    if ((!description || !description.trim()) && typeof subtitle === 'string' && subtitle.trim()) {
      description = subtitle.trim()
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

    const cleanedTitle = cleanGeneratedTitle(title) || title

    // Dedupe defensivo: si el mismo (titulo|hora|fecha) llegó hace menos de
    // DEDUPE_WINDOW_MS, retornamos el evento ya creado en vez de duplicar.
    // Cubre: LLM emitiendo add_event dos veces, doble click en aceptar
    // sugerencia, retry de network que se aplicó dos veces.
    const dedupeKey = `${normalizeTitleForDedupe(cleanedTitle)}|${finalTime}|${resolvedDate}`
    const now = Date.now()
    const recent = recentCreationsRef.current.get(dedupeKey)
    if (!proposedId && recent && now - recent.at < DEDUPE_WINDOW_MS && eventsRef.current.some(item => item.id === recent.event.id)) {
      focusLog(`[Focus] 🛡️ addEvent dedupe: "${cleanedTitle}" (${dedupeKey}) — ignorado`)
      // Devolvemos el evento previo para que callers (applySuggestion) que
      // dependen del id devuelto sigan funcionando sin romper undo.
      return eventsRef.current.find(item => item.id === recent.event.id)
    }

    const newEvent = {
      // Sufijo aleatorio para garantizar unicidad cuando se disparan varios
      // addEvent en el mismo tick (ej: al crear 12 repeticiones de una
      // reunión semanal). Sin él, Date.now() repetía ID y Supabase upsert
      // colapsaba todas las filas en una.
      id: proposedId || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: cleanedTitle,
      time: finalTime,
      description, section, featured: false, icon, dotColor,
      date: resolvedDate,
      reminderOffsets,
      timezone: tz,
    }
    if (!commitEvents([...eventsRef.current, newEvent])) return null
    recentCreationsRef.current.set(dedupeKey, { at: now, event: newEvent })
    // Limpieza periódica para no acumular keys viejos sin cota.
    if (recentCreationsRef.current.size > 64) {
      for (const [k, v] of recentCreationsRef.current) {
        if (now - v.at > DEDUPE_WINDOW_MS * 2) recentCreationsRef.current.delete(k)
      }
    }
    focusLog(`[Focus] ➕ addEvent: "${newEvent.title}"`)
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
    const removed = eventsRef.current.find(event => event.id === id)
    if (!removed || !commitEvents(eventsRef.current.filter(event => event.id !== id))) return false
    pendingDeletesRef.current.add(id)
    pendingUpsertsRef.current.delete(id)
    logSignal('event_deleted', { section: removed.section, hour: parseEventHour(removed.time) })
    if (user) {
      dataService.deleteEvent(id, user.id)
        .catch(console.warn)
        .finally(() => pendingDeletesRef.current.delete(id))
    } else {
      pendingDeletesRef.current.delete(id)
    }
    return true
  }

  function editEvent(id, updates) {
    if (!eventsRef.current.some(event => event.id === id) || !updates || typeof updates !== 'object') return null
      const next = eventsRef.current.map(e => {
        if (e.id !== id) return e
        const merged = { ...e, ...updates }
        // Nova edita el detalle del evento vía `updates.subtitle`; en web eso
        // es la `description`. Convención compartida con iOS: ""  = quitar,
        // "X" = fijar (review 2026-06-11). Sin esto, "ponle pierna al gym"
        // confirmaba en el chat pero no cambiaba nada visible en web.
        if (typeof updates.subtitle === 'string') {
          merged.description = updates.subtitle.trim()
          delete merged.subtitle
        }
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
    const updated = next.find(event => event.id === id)
    if (!updated?.title || !commitEvents(next)) return null
    markPendingUpsert(updated)
    if (user) dataService.upsertEvent(updated, user.id).catch(console.warn)
    // Señalamos si es un cambio de hora (útil para aprender cuándo reprograma)
    if (updates.time) {
      logSignal('event_moved', { to_hour: parseEventHour(updates.time) })
    }
    return updated
  }

  return { events: collectionEpochRef.current === accountEpochRef.current ? events : [], addEvent, deleteEvent, editEvent }
}

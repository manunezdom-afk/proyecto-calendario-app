import { useState, useEffect, useRef } from 'react'
import { dataService } from '../services/dataService'
import { logSignal } from '../services/signalsService'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useCoalescedRefetch } from './useCoalescedRefetch'
import { cleanGeneratedTitle } from '../utils/titleCleanup'
import { composeTimeRange, parseTimeRange } from '../utils/eventDuration'
import { isReminderItem } from '../utils/reminders'

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

export function useEvents() {
  const { user } = useAuth()
  // IDs de eventos cuyo DELETE está en vuelo — evita que un refetch previo a la
  // confirmación de Supabase restaure el evento en el estado local (race condition
  // especialmente común en iOS donde visibilitychange dispara refetch en cada tap).
  const pendingDeletesRef = useRef(new Set())

  // Sin usuario arrancamos vacío: la caché global (focus_events sin userId)
  // solía mostrar eventos de una sesión anterior al iniciar sesión otra vez.
  // La fuente real al login es la tabla events de Supabase.
  const [events, setEvents] = useState([])

  const refetch = useCoalescedRefetch(async (tag = '') => {
    if (!user) return
    try {
      const cloudEvents = await dataService.fetchEvents(user.id)
      const pending = pendingDeletesRef.current
      const filtered = pending.size > 0
        ? cloudEvents.filter(e => !pending.has(e.id))
        : cloudEvents
      setEvents(filtered)
      dataService.setCachedEvents(filtered, user.id)
      console.log(`[Focus] ☁️ ${filtered.length} eventos cargados ${tag} (user=${user.id.slice(0,8)})`)
    } catch (err) {
      console.warn('[Focus] ⚠️ No se pudo cargar eventos de Supabase', err)
    }
  })

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

    refetch('(init)')

    // Sync al volver a la pestaña. visibilitychange y focus suelen disparar a
    // la vez en iOS: el helper coalesced dedupea la ráfaga.
    const onVisibility = () => { if (!document.hidden) refetch('(visibilitychange)') }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    // Realtime: cualquier cambio en la tabla events del user dispara refetch
    const channel = supabase
      .channel(`events-${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `user_id=eq.${user.id}` },
        () => refetch('(realtime)'),
      )
      .subscribe()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
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

    const newEvent = {
      id: `evt-${Date.now()}`,
      title: cleanGeneratedTitle(title) || title,
      time: finalTime,
      description, section, featured: false, icon, dotColor, date,
      reminderOffsets,
      timezone: tz,
    }
    console.log(`[Focus] ➕ addEvent: "${newEvent.title}"`)
    setEvents(prev => [...prev, newEvent])
    if (user) dataService.upsertEvent(newEvent, user.id).catch(console.warn)
    logSignal('event_created', {
      hour: parseEventHour(finalTime),
      section,
      date,
      weekday: new Date().getDay(),
    })
    return newEvent
  }

  function deleteEvent(id) {
    console.log(`[Focus] 🗑️ deleteEvent: "${id}"`)
    pendingDeletesRef.current.add(id)
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
    console.log(`[Focus] ✏️ editEvent: "${id}"`, updates)
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
      if (user) {
        const updated = next.find(e => e.id === id)
        if (updated) dataService.upsertEvent(updated, user.id).catch(console.warn)
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

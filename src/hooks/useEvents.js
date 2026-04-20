import { useState, useEffect } from 'react'
import { dataService } from '../services/dataService'
import { logSignal } from '../services/signalsService'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

// Extrae la hora (0-23) de un string "HH:MM" o "HH:MM – HH:MM"
function parseEventHour(time) {
  if (!time) return null
  const m = String(time).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  return h >= 0 && h <= 23 ? h : null
}

const LEGACY_KEY = 'sanctuary_events'

export function useEvents() {
  const { user } = useAuth()

  const [events, setEvents] = useState(() => {
    try {
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (legacy) {
        localStorage.setItem('focus_events', legacy)
        localStorage.removeItem(LEGACY_KEY)
        console.log('[Focus] 🔄 Migrated events: sanctuary_events → focus_events')
      }
    } catch {}
    return dataService.getCachedEvents()
  })

  // Carga desde Supabase cuando el usuario inicia sesión
  useEffect(() => {
    if (!user) return

    // Al cambiar de usuario, partimos de cache propio (no del global compartido)
    setEvents(dataService.getCachedEvents(user.id))

    const refetch = (tag = '') => {
      dataService.fetchEvents(user.id)
        .then(cloudEvents => {
          setEvents(cloudEvents)
          dataService.setCachedEvents(cloudEvents, user.id)
          console.log(`[Focus] ☁️ ${cloudEvents.length} eventos cargados desde Supabase ${tag} (user=${user.id.slice(0,8)})`)
        })
        .catch(err => console.warn('[Focus] ⚠️ No se pudo cargar eventos de Supabase', err))
    }

    refetch('(init)')

    // Sync al volver a la pestaña
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
  }, [user?.id])

  // Mantiene el cache local sincronizado (scoped por user)
  useEffect(() => {
    dataService.setCachedEvents(events, user?.id)
  }, [events, user?.id])

  function addEvent({ title, time, description = '', section = 'focus', icon = 'event', dotColor = 'bg-secondary-container', date = null }) {
    const newEvent = {
      id: `evt-${Date.now()}`,
      title, time, description, section, featured: false, icon, dotColor, date,
    }
    console.log(`[Focus] ➕ addEvent: "${newEvent.title}"`)
    setEvents(prev => [...prev, newEvent])
    if (user) dataService.upsertEvent(newEvent, user.id).catch(console.warn)
    logSignal('event_created', {
      hour: parseEventHour(time),
      section,
      date,
      weekday: new Date().getDay(),
    })
    return newEvent
  }

  function deleteEvent(id) {
    console.log(`[Focus] 🗑️ deleteEvent: "${id}"`)
    setEvents(prev => {
      const removed = prev.find(e => e.id === id)
      if (removed) {
        logSignal('event_deleted', { section: removed.section, hour: parseEventHour(removed.time) })
      }
      return prev.filter(e => e.id !== id)
    })
    if (user) dataService.deleteEvent(id, user.id).catch(console.warn)
  }

  function editEvent(id, updates) {
    console.log(`[Focus] ✏️ editEvent: "${id}"`, updates)
    setEvents(prev => {
      const next = prev.map(e => e.id === id ? { ...e, ...updates } : e)
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

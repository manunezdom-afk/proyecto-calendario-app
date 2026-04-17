import { useState, useEffect } from 'react'
import { dataService } from '../services/dataService'
import { useAuth } from '../context/AuthContext'

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
    dataService.fetchEvents(user.id)
      .then(cloudEvents => {
        setEvents(cloudEvents)
        dataService.setCachedEvents(cloudEvents)
        console.log(`[Focus] ☁️ ${cloudEvents.length} eventos cargados desde Supabase`)
      })
      .catch(err => console.warn('[Focus] ⚠️ No se pudo cargar eventos de Supabase', err))
  }, [user?.id])

  // Mantiene el cache local sincronizado
  useEffect(() => {
    dataService.setCachedEvents(events)
  }, [events])

  function addEvent({ title, time, description = '', section = 'focus', icon = 'event', dotColor = 'bg-secondary-container', date = null }) {
    const newEvent = {
      id: `evt-${Date.now()}`,
      title, time, description, section, featured: false, icon, dotColor, date,
    }
    console.log(`[Focus] ➕ addEvent: "${newEvent.title}"`)
    setEvents(prev => [...prev, newEvent])
    if (user) dataService.upsertEvent(newEvent, user.id).catch(console.warn)
    return newEvent
  }

  function deleteEvent(id) {
    console.log(`[Focus] 🗑️ deleteEvent: "${id}"`)
    setEvents(prev => prev.filter(e => e.id !== id))
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
  }

  return { events, addEvent, deleteEvent, editEvent }
}

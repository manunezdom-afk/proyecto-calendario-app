import { useState, useEffect } from 'react'

const STORAGE_KEY     = 'focus_events'
const LEGACY_KEY      = 'sanctuary_events'

export function useEvents() {
  const [events, setEvents] = useState(() => {
    // Migración: si existe la key vieja, moverla a la nueva y borrarla
    try {
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (legacy) {
        localStorage.setItem(STORAGE_KEY, legacy)
        localStorage.removeItem(LEGACY_KEY)
        console.log('[Focus] 🔄 Migrated events from sanctuary_events → focus_events')
      }
    } catch {}

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        console.log(
          `[Focus] ✅ Events loaded from localStorage: ${parsed.length} event(s)`,
          parsed,
        )
        return parsed
      }
    } catch (err) {
      console.warn('[Focus] ⚠️ Could not parse localStorage — starting with empty events.', err)
    }
    console.log('[Focus] 📋 No saved events found. Starting with empty events.')
    return []
  })

  // Persist every change to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
      console.log(`[Focus] 💾 Events saved to localStorage: ${events.length} event(s)`)
    } catch (err) {
      console.error('[Focus] ❌ Failed to save events to localStorage.', err)
    }
  }, [events])

  /** Add a new event. Returns the created event (with auto-generated id). */
  function addEvent({ title, time, description = '', section = 'focus', icon = 'event', dotColor = 'bg-secondary-container', date = null }) {
    const newEvent = {
      id: `evt-${Date.now()}`,
      title,
      time,
      description,
      section,
      featured: false,
      icon,
      dotColor,
      date, // YYYY-MM-DD or null (null = treat as today's event)
    }
    console.log(`[Focus] ➕ addEvent — id: "${newEvent.id}" | title: "${newEvent.title}" | section: "${newEvent.section}"`)
    setEvents((prev) => [...prev, newEvent])
    return newEvent
  }

  /** Delete an event by id. Logs a warning if the id is not found. */
  function deleteEvent(id) {
    setEvents((prev) => {
      const target = prev.find((e) => e.id === id)
      if (!target) {
        console.warn(`[Focus] ⚠️ deleteEvent — id "${id}" not found in events list. Nothing deleted.`)
        return prev
      }
      console.log(`[Focus] 🗑️ deleteEvent — id: "${id}" | title: "${target.title}"`)
      const next = prev.filter((e) => e.id !== id)
      console.log(`[Focus] ✅ After deletion: ${next.length} event(s) remaining.`)
      return next
    })
  }

  /** Edit an event by id. Only the provided fields are updated. */
  function editEvent(id, updates) {
    console.log(`[Focus] ✏️ editEvent — id: "${id}" | updates:`, updates)
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    )
  }

  return { events, addEvent, deleteEvent, editEvent }
}

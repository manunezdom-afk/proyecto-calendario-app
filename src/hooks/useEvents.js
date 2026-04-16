import { useState, useEffect } from 'react'

const STORAGE_KEY = 'sanctuary_events'

export function useEvents() {
  const [events, setEvents] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        console.log(
          `[Sanctuary] ✅ Events loaded from localStorage: ${parsed.length} event(s)`,
          parsed,
        )
        return parsed
      }
    } catch (err) {
      console.warn('[Sanctuary] ⚠️ Could not parse localStorage — starting with empty events.', err)
    }
    console.log('[Sanctuary] 📋 No saved events found. Starting with empty events.')
    return []
  })

  // Persist every change to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
      console.log(`[Sanctuary] 💾 Events saved to localStorage: ${events.length} event(s)`)
    } catch (err) {
      console.error('[Sanctuary] ❌ Failed to save events to localStorage.', err)
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
    console.log(`[Sanctuary] ➕ addEvent — id: "${newEvent.id}" | title: "${newEvent.title}" | section: "${newEvent.section}"`)
    setEvents((prev) => [...prev, newEvent])
    return newEvent
  }

  /** Delete an event by id. Logs a warning if the id is not found. */
  function deleteEvent(id) {
    setEvents((prev) => {
      const target = prev.find((e) => e.id === id)
      if (!target) {
        console.warn(`[Sanctuary] ⚠️ deleteEvent — id "${id}" not found in events list. Nothing deleted.`)
        return prev
      }
      console.log(`[Sanctuary] 🗑️ deleteEvent — id: "${id}" | title: "${target.title}"`)
      const next = prev.filter((e) => e.id !== id)
      console.log(`[Sanctuary] ✅ After deletion: ${next.length} event(s) remaining.`)
      return next
    })
  }

  /** Edit an event by id. Only the provided fields are updated. */
  function editEvent(id, updates) {
    console.log(`[Sanctuary] ✏️ editEvent — id: "${id}" | updates:`, updates)
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    )
  }

  return { events, addEvent, deleteEvent, editEvent }
}

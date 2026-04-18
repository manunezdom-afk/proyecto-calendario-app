import { useState, useEffect, useRef, useCallback } from 'react'
import { parseEventTime } from '../utils/parseEventTime'
import { subscribeToPush, unsubscribeFromPush, getPushStatus } from '../lib/pushSubscription'

const LOG_KEY    = 'focus_notif_log'
const FIRED_KEY  = 'focus_notif_fired'
const DISMISS_KEY = 'focus_notif_dismissed'

// Minutes before event to fire each reminder
const OFFSETS = [10, 30, 60]

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch (_) {}
  return fallback
}

export function useNotifications({ events = [] } = {}) {
  const [notifLog, setNotifLog] = useState(() => loadJSON(LOG_KEY, []))
  const [permissionState, setPermissionState] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  )
  const [permissionDismissed, setPermissionDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1',
  )

  // Track already-fired notifications across sessions
  const firedRef = useRef(loadJSON(FIRED_KEY, {}))

  // Persist log
  useEffect(() => {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(notifLog)) } catch (_) {}
  }, [notifLog])

  // Prune log entries older than 7 days on mount
  useEffect(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    setNotifLog((prev) => prev.filter((n) => n.timestamp > cutoff))
  }, [])

  // ── Request permission + suscribir a Web Push ────────────────────────────
  // Si el permiso se otorga, intentamos suscribirnos al push server para
  // recibir notificaciones aunque la app esté cerrada. Es fire-and-forget:
  // si la suscripción falla (p.ej. sin VAPID key), la notif local sigue
  // andando para cuando la pestaña esté visible.
  const [pushSubscribed, setPushSubscribed] = useState(false)

  useEffect(() => {
    getPushStatus().then(s => setPushSubscribed(!!s.subscribed)).catch(() => {})
  }, [])

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermissionState(result)
    if (result === 'granted') {
      const r = await subscribeToPush()
      setPushSubscribed(!!r.ok)
      if (!r.ok) console.warn('[Focus] push subscribe failed:', r.reason)
    }
  }, [])

  const disablePush = useCallback(async () => {
    await unsubscribeFromPush()
    setPushSubscribed(false)
  }, [])

  const dismissPermissionCard = useCallback(() => {
    setPermissionDismissed(true)
    localStorage.setItem(DISMISS_KEY, '1')
  }, [])

  // ── Notification scanner ──────────────────────────────────────────────────
  const scan = useCallback(() => {
    // Only fire when the tab is visible (avoid duplicate-tab issues)
    if (document.visibilityState !== 'visible') return

    const now     = new Date()
    const nowMs   = now.getTime()
    const today   = todayISO()

    events.forEach((event) => {
      if (!event.time) return

      // Resolve event date (null = today)
      const eventDate = event.date ?? today

      // Only process events for today (or in the future if you extend later)
      if (eventDate !== today) return

      const eventTime = parseEventTime(event.time, eventDate)
      if (!eventTime) return

      OFFSETS.forEach((offsetMin) => {
        const fireAt  = new Date(eventTime.getTime() - offsetMin * 60 * 1000)
        const firedKey = `${event.id}-${offsetMin}m`

        // Already fired?
        if (firedRef.current[firedKey]) return

        // Within 60-second firing window?
        const delta = nowMs - fireAt.getTime()
        if (delta < 0 || delta > 60_000) return

        // Mark fired
        firedRef.current[firedKey] = true
        try { localStorage.setItem(FIRED_KEY, JSON.stringify(firedRef.current)) } catch (_) {}

        // Build notification content
        const label = offsetMin === 60
          ? 'en 1 hora'
          : offsetMin === 30
          ? 'en 30 minutos'
          : 'en 10 minutos'
        const title = `${event.title} ${label}`
        const body  = event.time ? `Comienza a las ${event.time.split(' - ')[0]}` : ''

        // Append to in-app log
        const entry = {
          id: `notif-${Date.now()}-${event.id}`,
          eventId: event.id,
          title,
          body,
          icon: event.icon || 'event',
          timestamp: Date.now(),
          read: false,
        }
        setNotifLog((prev) => [entry, ...prev].slice(0, 50)) // cap at 50

        // Fire native notification if permitted
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification(title, {
              body,
              icon: '/icons/icon-192.png',
              badge: '/icons/icon-192.png',
              tag: firedKey, // deduplicates across same-event notifications
            })
          } catch (_) {}
        }

        console.log(`[Focus] 🔔 Notification fired: "${title}"`)
      })
    })
  }, [events])

  // Run scanner immediately and every 60 seconds
  useEffect(() => {
    scan()
    const id = setInterval(scan, 60_000)
    return () => clearInterval(id)
  }, [scan])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const markRead = useCallback((id) => {
    setNotifLog((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }, [])

  const markAllRead = useCallback(() => {
    setNotifLog((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  const dismiss = useCallback((id) => {
    setNotifLog((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const unreadCount = notifLog.filter((n) => !n.read).length

  return {
    notifLog,
    unreadCount,
    permissionState,
    permissionDismissed,
    requestPermission,
    dismissPermissionCard,
    markRead,
    markAllRead,
    dismiss,
    pushSubscribed,
    disablePush,
  }
}

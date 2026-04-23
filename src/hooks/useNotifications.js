import { useState, useEffect, useRef, useCallback } from 'react'
import { parseEventTime } from '../utils/parseEventTime'
import {
  subscribeToPush,
  unsubscribeFromPush,
  getPushStatus,
  checkSubscriptionHealth,
  forceResubscribe,
} from '../lib/pushSubscription'

const LOG_KEY    = 'focus_notif_log'
const FIRED_KEY  = 'focus_notif_fired'
const DISMISS_KEY = 'focus_notif_dismissed'

// Default minutes before event to fire each reminder (if event has no custom offsets)
const DEFAULT_OFFSETS = [10, 30, 60]

function offsetLabel(min) {
  if (min >= 1440) {
    const d = Math.round(min / 1440)
    return d === 1 ? 'mañana' : `en ${d} días`
  }
  if (min >= 60) {
    const h = Math.round(min / 60)
    return h === 1 ? 'en 1 hora' : `en ${h} horas`
  }
  return `en ${min} minutos`
}

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
    // Esperar a que el SW esté listo antes de verificar/crear suscripción push,
    // especialmente importante en iOS PWA donde el SW puede tardar en activarse.
    //
    // Este efecto es el "auto-healer" de push:
    //   1. Si no hay suscripción local pero permiso concedido → crear suscripción.
    //   2. Si hay suscripción local, consultar al backend si conoce nuestro
    //      endpoint. Si el backend reporta 0 suscripciones (el cron las purgó
    //      por 410 de APNs) o nuestro endpoint no está en la lista, forzamos
    //      una re-suscripción con endpoint fresco para que las pushes vuelvan
    //      a llegar. Esto cubre el caso en que iOS/APNs invalida la
    //      suscripción sin disparar pushsubscriptionchange y la app "creía"
    //      que tenía push funcionando.
    const check = async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready.catch(() => {})
      }
      const s = await getPushStatus().catch(() => null)
      if (!s) return
      setPushSubscribed(!!s.subscribed)

      if (!s.supported) return
      if (s.permission !== 'granted') return

      if (!s.subscribed) {
        // Caso 1: no hay suscripción local pero sí permiso. Crearla.
        const r = await subscribeToPush().catch(() => null)
        if (r?.ok) setPushSubscribed(true)
        return
      }

      // Caso 2: hay suscripción local. Confirmar con backend.
      const h = await checkSubscriptionHealth().catch(() => null)
      if (!h || !h.ok) return

      if (h.subscriptionCount === 0 || h.currentPresent === false) {
        // Backend no nos tiene (o no tiene nuestro endpoint específico).
        // Forzamos re-suscribir desde cero — APNs puede haber invalidado el
        // endpoint viejo silenciosamente.
        console.warn('[Focus] 🔁 push suscripción huérfana — resuscribing')
        const r = await forceResubscribe().catch(() => null)
        if (r?.ok) setPushSubscribed(true)
      }
    }
    check()
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

      // Per-event offsets: null/undefined → use defaults; [] = silenced; array = custom
      const rawOffsets = event.reminderOffsets
      const offsets = Array.isArray(rawOffsets) ? rawOffsets : DEFAULT_OFFSETS
      if (offsets.length === 0) return

      offsets.forEach((offsetMin) => {
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
        const label = offsetLabel(offsetMin)
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

        // Fire native notification if permitted.
        // iOS Safari no soporta `new Notification()` — se debe usar
        // registration.showNotification() via el Service Worker.
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notifOptions = {
            body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: firedKey,
          }
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready
              .then(reg => reg.showNotification(title, notifOptions))
              .catch(() => {
                try { new Notification(title, notifOptions) } catch (_) {}
              })
          } else {
            try { new Notification(title, notifOptions) } catch (_) {}
          }
        }

        console.log(`[Focus] 🔔 Notification fired: "${title}"`)
      })
    })
  }, [events])

  // Run scanner immediately and every 60 seconds.
  //
  // El primer scan() se difiere fuera del paint crítico: con muchos eventos
  // en cache, el loop síncrono (parseEventTime + localStorage.setItem por
  // cada offset) podía congelar el main thread unos cientos de ms en el
  // primer render — lo que el usuario percibía como "pantalla en blanco".
  // requestIdleCallback (con fallback a setTimeout) asegura que React pinta
  // la UI antes, y el scan corre en el primer hueco de idle.
  useEffect(() => {
    const deferred = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(scan, { timeout: 1500 })
      : setTimeout(scan, 0)
    const id = setInterval(scan, 60_000)
    return () => {
      if (typeof cancelIdleCallback === 'function' && typeof deferred === 'number') {
        cancelIdleCallback(deferred)
      } else {
        clearTimeout(deferred)
      }
      clearInterval(id)
    }
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

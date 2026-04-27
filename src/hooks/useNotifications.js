import { useState, useEffect, useRef, useCallback } from 'react'
import { parseEventTime } from '../utils/parseEventTime'
import {
  subscribeToPush,
  unsubscribeFromPush,
  getPushStatus,
  checkSubscriptionHealth,
  forceResubscribe,
} from '../lib/pushSubscription'
import {
  getNativePushStatus,
  isNativePushSupported,
  registerNativePush,
  unregisterNativePush,
} from '../lib/nativePush'
import {
  DEFAULT_REMINDER_OFFSETS,
  buildSmartNotificationPayload,
  normalizeReminderOffsets,
} from '../utils/smartNotifications'
import { focusLog } from '../utils/debug'
import { readPreferenceSync } from './useAppPreferences'

const LOG_KEY    = 'focus_notif_log'
const FIRED_KEY  = 'focus_notif_fired'
const DISMISS_KEY = 'focus_notif_dismissed'

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

function normalizeNativePermission(value) {
  if (value === 'granted' || value === 'denied') return value
  return 'default'
}

export function useNotifications({ events = [] } = {}) {
  const [notifLog, setNotifLog] = useState(() => loadJSON(LOG_KEY, []))
  const [permissionState, setPermissionState] = useState(() =>
    isNativePushSupported()
      ? 'default'
      : (typeof Notification !== 'undefined' ? Notification.permission : 'denied'),
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
  // pushDisconnected: permiso OK pero las notifs NO están llegando (sin sub
  // local, o backend no la conoce). Distinto de `permission !== 'granted'`:
  // acá el usuario cree que tiene notifs porque "ya aceptó", pero en realidad
  // la pipa está rota. La UI muestra un banner para reconectar.
  const [pushDisconnected, setPushDisconnected] = useState(false)
  const [pushHealing, setPushHealing] = useState(false)
  // lastDelivery: última notificación reportada por el backend. Null si nunca,
  // o si la tabla notification_deliveries no está migrada.
  const [lastDelivery, setLastDelivery] = useState(null)

  const runHealthCheck = useCallback(async () => {
    if (isNativePushSupported()) {
      const s = await getNativePushStatus().catch(() => null)
      if (!s) return
      setPermissionState(normalizeNativePermission(s.permission))
      setPushSubscribed(!!s.subscribed)

      if (!s.supported) { setPushDisconnected(false); return }
      if (s.permission !== 'granted') { setPushDisconnected(false); return }

      if (!s.subscribed) {
        const r = await registerNativePush({ prompt: false }).catch(() => null)
        if (r?.ok && r.reason !== 'saved_locally_no_session') {
          setPushSubscribed(true)
          setPushDisconnected(false)
        } else {
          setPushDisconnected(true)
        }
        return
      }

      const h = await checkSubscriptionHealth({ nativeToken: s.token }).catch(() => null)
      if (!h || !h.ok) { setPushDisconnected(false); return }
      if (h.lastDelivery !== undefined) setLastDelivery(h.lastDelivery)

      if (h.nativeTokenCount === 0 || h.currentNativePresent === false) {
        console.warn('[Focus] 🔁 token APNs huérfano — registrando de nuevo')
        setPushHealing(true)
        const r = await registerNativePush({ prompt: false }).catch(() => null)
        setPushHealing(false)
        if (r?.ok && r.reason !== 'saved_locally_no_session') {
          setPushSubscribed(true)
          setPushDisconnected(false)
        } else {
          setPushDisconnected(true)
        }
      } else {
        setPushDisconnected(false)
      }
      return
    }

    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.ready.catch(() => {})
    }
    const s = await getPushStatus().catch(() => null)
    if (!s) return
    setPushSubscribed(!!s.subscribed)

    if (!s.supported) { setPushDisconnected(false); return }
    if (s.permission !== 'granted') { setPushDisconnected(false); return }

    if (!s.subscribed) {
      // Sin sub local: intento auto-crearla (silent). Si falla, marcamos
      // disconnected para que la UI pida reconexión explícita.
      const r = await subscribeToPush().catch(() => null)
      if (r?.ok && r.reason !== 'saved_locally_no_session') {
        setPushSubscribed(true)
        setPushDisconnected(false)
      } else {
        setPushDisconnected(true)
      }
      return
    }

    // Con sub local: confirmar con backend + traer lastDelivery.
    const h = await checkSubscriptionHealth().catch(() => null)
    if (!h || !h.ok) { setPushDisconnected(false); return }

    if (h.lastDelivery !== undefined) setLastDelivery(h.lastDelivery)

    if (h.subscriptionCount === 0 || h.currentPresent === false) {
      // Backend no nos tiene — huérfana. Probamos auto-healing primero; si
      // no pinta, marcamos disconnected para banner explícito.
      console.warn('[Focus] 🔁 push suscripción huérfana — resuscribing')
      setPushHealing(true)
      const r = await forceResubscribe().catch(() => null)
      setPushHealing(false)
      if (r?.ok && r.reason !== 'saved_locally_no_session') {
        setPushSubscribed(true)
        setPushDisconnected(false)
      } else {
        setPushDisconnected(true)
      }
    } else {
      setPushDisconnected(false)
    }
  }, [])

  useEffect(() => {
    runHealthCheck()
    // Re-chequear cuando el tab vuelve a visible. Caso real: el usuario deja
    // la PWA en background por días, APNs invalida la sub, al volver a abrir
    // queremos detectar eso aunque la sesión no se recargue.
    const onVis = () => {
      if (document.visibilityState === 'visible') runHealthCheck()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [runHealthCheck])

  // Acción explícita desde la UI para reconectar (usada por el banner).
  const reconnectPush = useCallback(async () => {
    setPushHealing(true)
    try {
      if (isNativePushSupported()) {
        const r = await registerNativePush({ prompt: true })
        if (r?.ok) {
          setPushSubscribed(true)
          setPushDisconnected(false)
          setPermissionState('granted')
          return { ok: true }
        }
        return { ok: false, reason: r?.reason, error: r?.error }
      }

      const r = await forceResubscribe()
      if (r?.ok) {
        setPushSubscribed(true)
        setPushDisconnected(false)
        return { ok: true }
      }
      return { ok: false, reason: r?.reason, error: r?.error }
    } finally {
      setPushHealing(false)
    }
  }, [])

  const requestPermission = useCallback(async () => {
    // Antes: rechazos del API de push (sin VAPID, quota, denied) propagaban
    // como excepción al caller (NovaHint.handleAction), que no las capturaba
    // y la UI quedaba en estado inconsistente. Ahora cualquier fallo se
    // captura y se loggea — el spinner de la burbuja vuelve a su estado
    // base aunque el subscribe haya fallado.
    try {
      if (isNativePushSupported()) {
        const r = await registerNativePush({ prompt: true })
        const s = await getNativePushStatus().catch(() => null)
        if (s?.permission) setPermissionState(normalizeNativePermission(s.permission))
        setPushSubscribed(!!r?.ok)
        if (!r?.ok) console.warn('[Focus] native push subscribe failed:', r?.reason)
        return
      }

      if (typeof Notification === 'undefined') return
      const result = await Notification.requestPermission()
      setPermissionState(result)
      if (result === 'granted') {
        const r = await subscribeToPush()
        setPushSubscribed(!!r.ok)
        if (!r.ok) console.warn('[Focus] push subscribe failed:', r.reason)
      }
    } catch (err) {
      console.warn('[Focus] requestPermission falló:', err?.message || err)
    }
  }, [])

  const disablePush = useCallback(async () => {
    // Si la des-suscripción falla en backend o en SW, no queremos arrastrar
    // la excepción al caller — el switch UI debe quedar consistente con el
    // estado local aunque el cleanup remoto haya fallado.
    try {
      if (isNativePushSupported()) {
        await unregisterNativePush()
        setPushSubscribed(false)
        setPushDisconnected(false)
        return
      }

      await unsubscribeFromPush()
      setPushSubscribed(false)
    } catch (err) {
      console.warn('[Focus] disablePush falló:', err?.message || err)
      setPushSubscribed(false)
    }
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

      // Per-event offsets: null/undefined -> defaults; [] = silenced; array = custom.
      const offsets = normalizeReminderOffsets(event.reminderOffsets, DEFAULT_REMINDER_OFFSETS)
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

        const minsLeft = Math.max(0, Math.round((eventTime.getTime() - nowMs) / 60_000))
        const payload = buildSmartNotificationPayload(event, {
          offset: offsetMin,
          minsLeft,
          startsAt: eventTime,
          personality: readPreferenceSync('novaPersonality'),
        })

        // Append to in-app log
        const entry = {
          id: `notif-${Date.now()}-${event.id}`,
          eventId: event.id,
          title: payload.title,
          body: payload.body,
          icon: payload.appIcon || event.icon || 'event',
          kind: payload.data?.kind || 'event_reminder',
          offset: offsetMin,
          timestamp: Date.now(),
          read: false,
        }
        setNotifLog((prev) => [entry, ...prev].slice(0, 50)) // cap at 50

        // Fire native notification if permitted.
        // iOS Safari no soporta `new Notification()` — se debe usar
        // registration.showNotification() via el Service Worker.
        //
        // TAG UNIFICADO con backend (`reminder-${eventId}-${offset}`): el
        // sistema de notificaciones colapsa por tag, así que si el push del
        // cron llega al mismo tiempo que el scanner local dispara, el usuario
        // ve UNA sola notificación. Antes los tags eran distintos y aparecían
        // duplicadas en desktop cuando la tab estaba visible.
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notifOptions = {
            body: payload.body,
            icon: payload.icon || '/icons/icon-192.png',
            badge: payload.badge || payload.icon || '/icons/icon-192.png',
            tag: payload.tag || `reminder-${event.id}-${offsetMin}`,
            renotify: payload.renotify ?? true,
            requireInteraction: Boolean(payload.requireInteraction),
            timestamp: payload.timestamp || Date.now(),
            data: { url: payload.url, ...payload.data },
            actions: payload.actions,
          }
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready
              .then(reg => reg.showNotification(payload.title, notifOptions))
              .catch(() => {
                try { new Notification(payload.title, notifOptions) } catch (_) {}
              })
          } else {
            try { new Notification(payload.title, notifOptions) } catch (_) {}
          }
        }

        focusLog(`[Focus] 🔔 Notification fired: "${payload.title}"`)
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
    pushDisconnected,
    pushHealing,
    lastDelivery,
    reconnectPush,
    disablePush,
  }
}

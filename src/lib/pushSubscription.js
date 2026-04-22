/**
 * pushSubscription — cliente para suscribirse/desuscribirse a Web Push
 *
 * El flujo:
 * 1. El usuario otorga permiso de notificaciones (browser API)
 * 2. Registramos al service worker en /sw.js si no está
 * 3. Subscribimos al pushManager con la VAPID_PUBLIC_KEY
 * 4. POST /api/push { action: 'subscribe', ... } (guarda en Supabase)
 *
 * El backend después puede mandarle push a ese endpoint cuando haga falta.
 */

import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = typeof window !== 'undefined' ? window.atob(b) : Buffer.from(b, 'base64').toString('binary')
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator?.standalone === true
}

export function isPushSupported() {
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator)) return false
  if (!('PushManager' in window)) return false
  if (!('Notification' in window)) return false
  // En iOS, Web Push solo funciona cuando la app está instalada (standalone)
  if (isIOS() && !isStandalone()) return false
  return true
}

/** Devuelve true si estamos en iOS pero NO instalada — para mostrar aviso */
export function isIOSNotInstalled() {
  return isIOS() && !isStandalone()
}

/** Lee el estado actual: permission + subscription local */
export async function getPushStatus() {
  if (!isPushSupported()) {
    return { supported: false, permission: 'denied', subscribed: false }
  }
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: !!sub,
    endpoint: sub?.endpoint || null,
  }
}

/**
 * Pide permiso, suscribe, y guarda en Supabase.
 * Retorna { ok, reason, subscription }.
 */
export async function subscribeToPush() {
  if (!isPushSupported()) {
    return { ok: false, reason: 'unsupported' }
  }
  if (!VAPID_PUBLIC_KEY) {
    console.warn('[Focus] VITE_VAPID_PUBLIC_KEY no configurada — push desactivado')
    return { ok: false, reason: 'no_vapid_key' }
  }

  // 1. Permiso
  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') {
    return { ok: false, reason: 'permission_denied' }
  }

  // 2. SW registrado
  let reg = await navigator.serviceWorker.getRegistration()
  if (!reg) {
    try {
      reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    } catch (err) {
      return { ok: false, reason: 'sw_register_failed', error: String(err) }
    }
  }
  // Asegurarse de que esté active
  await navigator.serviceWorker.ready

  // 3. Suscripción
  let subscription
  try {
    subscription = await reg.pushManager.getSubscription()
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }
  } catch (err) {
    return { ok: false, reason: 'subscribe_failed', error: String(err) }
  }

  // 4. Sync al backend (si hay usuario logueado)
  const subJson = subscription.toJSON()
  try {
    const token = (await supabase?.auth.getSession())?.data?.session?.access_token
    if (!token) {
      console.warn('[Focus] push subscription sin sesión — guardada localmente, se subirá al hacer login')
      localStorage.setItem('focus_pending_push_sub', JSON.stringify(subJson))
      return { ok: true, subscription: subJson, reason: 'saved_locally_no_session' }
    }

    const res = await fetch('/api/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: 'subscribe',
        subscription: subJson,
        user_agent: navigator.userAgent.slice(0, 200),
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      console.error('[Focus] push subscribe failed:', res.status, data)
      return { ok: false, reason: 'backend_error', error: data.error || `status ${res.status}` }
    }
    console.log('[Focus] ✅ push subscription guardada en Supabase, endpoint:', subJson.endpoint?.slice(0, 60))
    localStorage.removeItem('focus_pending_push_sub')
    return { ok: true, subscription: subJson }
  } catch (err) {
    console.error('[Focus] push subscribe network error:', err)
    return { ok: false, reason: 'sync_failed', error: String(err) }
  }
}

/** Desuscribe del navegador y borra del backend */
export async function unsubscribeFromPush() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return { ok: true, reason: 'already_unsubscribed' }
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return { ok: true, reason: 'already_unsubscribed' }

  const endpoint = sub.endpoint

  try {
    await sub.unsubscribe()
  } catch {}

  try {
    const token = (await supabase?.auth.getSession())?.data?.session?.access_token
    if (token) {
      await fetch('/api/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'unsubscribe', endpoint }),
      })
    }
  } catch {}

  return { ok: true }
}

/**
 * Chequea con el backend si el usuario tiene suscripciones registradas.
 * Devuelve { ok, subscriptionCount, currentPresent }.
 *   · subscriptionCount: cuántas rows tiene el user en push_subscriptions.
 *   · currentPresent:    true si el endpoint local está registrado en el
 *                        backend; false si no; null si no hay sub local.
 * Sirve para detectar el caso "APNs revocó mi suscripción, el cron la borró
 * por 410, pero yo localmente todavía creo que está viva".
 */
export async function checkSubscriptionHealth() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    const endpoint = sub?.endpoint ?? null

    const token = (await supabase?.auth.getSession())?.data?.session?.access_token
    if (!token) return { ok: false, reason: 'no_session' }

    const res = await fetch('/api/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'health', endpoint }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, reason: 'backend_error', error: data.error || `status ${res.status}` }
    }
    const data = await res.json()
    return {
      ok: true,
      subscriptionCount: data.subscriptionCount ?? 0,
      currentPresent: data.currentPresent,
      localEndpoint: endpoint,
    }
  } catch (err) {
    return { ok: false, reason: 'network_error', error: String(err) }
  }
}

/**
 * Fuerza una re-suscripción desde cero: desuscribe la suscripción actual del
 * navegador (si la hay) y crea una nueva. Último recurso cuando APNs invalidó
 * la suscripción silenciosamente y la UI local no lo detectó.
 * Devuelve el mismo shape que subscribeToPush().
 */
export async function forceResubscribe() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg) {
      const old = await reg.pushManager.getSubscription()
      if (old) {
        try { await old.unsubscribe() } catch {}
      }
    }
  } catch {}
  return subscribeToPush()
}

/** Si había una suscripción pendiente (hecha antes de loguearse), subirla ahora */
export async function flushPendingSubscription() {
  const raw = localStorage.getItem('focus_pending_push_sub')
  if (!raw) return
  try {
    const subJson = JSON.parse(raw)
    const token = (await supabase?.auth.getSession())?.data?.session?.access_token
    if (!token) return
    const res = await fetch('/api/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: 'subscribe',
        subscription: subJson,
        user_agent: navigator.userAgent.slice(0, 200),
      }),
    })
    if (res.ok) localStorage.removeItem('focus_pending_push_sub')
  } catch {}
}

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
import { focusLog } from '../utils/debug'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

// withTimeout — resuelve con la promesa dada, o rechaza con Error(label) si no
// completa antes de `ms`. Blindamos las llamadas a navigator.serviceWorker y
// fetch porque en iOS PWA pueden quedar colgadas indefinidamente si el SW
// murió, perdió el worker thread, o la red cayó sin cerrar el socket. Sin esto
// la UI se queda en "Verificando…" para siempre.
function withTimeout(promise, ms, label = 'timeout') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms)
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

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

/** Lee el estado actual: permission + subscription local.
 * Envuelve las llamadas al SW en timeouts — si el worker murió o se trabó,
 * devolvemos { error } en lugar de colgar al caller. */
export async function getPushStatus() {
  if (!isPushSupported()) {
    return { supported: false, permission: 'denied', subscribed: false }
  }
  try {
    const reg = await withTimeout(
      navigator.serviceWorker.getRegistration(),
      3000,
      'sw_getRegistration_timeout',
    )
    const sub = reg
      ? await withTimeout(reg.pushManager.getSubscription(), 3000, 'sub_getSubscription_timeout')
      : null
    return {
      supported: true,
      permission: Notification.permission,
      subscribed: !!sub,
      endpoint: sub?.endpoint || null,
    }
  } catch (err) {
    return {
      supported: true,
      permission: Notification.permission,
      subscribed: false,
      endpoint: null,
      error: String(err?.message || err),
    }
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
  let reg
  try {
    reg = await withTimeout(
      navigator.serviceWorker.getRegistration(),
      3000,
      'sw_getRegistration_timeout',
    )
  } catch (err) {
    return { ok: false, reason: 'sw_register_failed', error: String(err?.message || err) }
  }
  if (!reg) {
    try {
      reg = await withTimeout(
        navigator.serviceWorker.register('/sw.js', { scope: '/' }),
        5000,
        'sw_register_timeout',
      )
    } catch (err) {
      return { ok: false, reason: 'sw_register_failed', error: String(err?.message || err) }
    }
  }
  // Asegurarse de que esté active — con timeout: en iOS PWA .ready puede
  // no resolver nunca si el worker quedó zombie.
  try {
    await withTimeout(navigator.serviceWorker.ready, 5000, 'sw_ready_timeout')
  } catch (err) {
    return { ok: false, reason: 'sw_register_failed', error: String(err?.message || err) }
  }

  // 3. Suscripción
  let subscription
  try {
    subscription = await withTimeout(
      reg.pushManager.getSubscription(),
      3000,
      'sub_getSubscription_timeout',
    )
    if (!subscription) {
      subscription = await withTimeout(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }),
        10000,
        'sub_subscribe_timeout',
      )
    }
  } catch (err) {
    return { ok: false, reason: 'subscribe_failed', error: String(err?.message || err) }
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

    const res = await withTimeout(
      fetch('/api/push', {
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
      }),
      10000,
      'backend_timeout',
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      console.error('[Focus] push subscribe failed:', res.status, data)
      return { ok: false, reason: 'backend_error', error: data.error || `status ${res.status}` }
    }
    focusLog('[Focus] ✅ push subscription guardada en Supabase, endpoint:', subJson.endpoint?.slice(0, 60))
    localStorage.removeItem('focus_pending_push_sub')
    return { ok: true, subscription: subJson }
  } catch (err) {
    console.error('[Focus] push subscribe network error:', err)
    return { ok: false, reason: 'sync_failed', error: String(err?.message || err) }
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
    let endpoint = null
    try {
      const reg = await withTimeout(
        navigator.serviceWorker.getRegistration(),
        3000,
        'sw_getRegistration_timeout',
      )
      const sub = reg
        ? await withTimeout(reg.pushManager.getSubscription(), 3000, 'sub_getSubscription_timeout')
        : null
      endpoint = sub?.endpoint ?? null
    } catch {
      // Si el SW no responde seguimos consultando al backend con endpoint=null
      // — el backend sabe responder con subscriptionCount aunque no le pases
      // endpoint específico.
    }

    const token = (await supabase?.auth.getSession())?.data?.session?.access_token
    if (!token) return { ok: false, reason: 'no_session' }

    const res = await withTimeout(
      fetch('/api/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'health', endpoint }),
      }),
      8000,
      'health_timeout',
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, reason: 'backend_error', error: data.error || `status ${res.status}` }
    }
    const data = await res.json()
    return {
      ok: true,
      subscriptionCount: data.subscriptionCount ?? 0,
      currentPresent: data.currentPresent,
      lastDelivery: data.lastDelivery ?? null,
      localEndpoint: endpoint,
    }
  } catch (err) {
    return { ok: false, reason: 'network_error', error: String(err?.message || err) }
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
    const reg = await withTimeout(
      navigator.serviceWorker.getRegistration(),
      3000,
      'sw_getRegistration_timeout',
    )
    if (reg) {
      const old = await withTimeout(
        reg.pushManager.getSubscription(),
        3000,
        'sub_getSubscription_timeout',
      )
      if (old) {
        try { await withTimeout(old.unsubscribe(), 3000, 'unsubscribe_timeout') } catch {}
      }
    }
  } catch {}
  return subscribeToPush()
}

/**
 * sendTestPush — gatilla una notificación de prueba end-to-end: pide al backend
 * que envíe una push real a todas las suscripciones del user logueado.
 *
 * Requisitos en el server:
 *   · VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en Vercel
 *   · El user tiene al menos 1 suscripción en push_subscriptions
 *
 * Retorna { ok, sent, failed, subscriptions, reason?, details? }.
 * Reasons posibles cuando ok=false: no_session, no_subscriptions_for_user,
 * vapid_not_configured, unauthorized, backend_error, timeout, unsupported.
 */
export async function sendTestPush() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }
  try {
    const token = (await supabase?.auth.getSession())?.data?.session?.access_token
    if (!token) return { ok: false, reason: 'no_session' }

    const res = await withTimeout(
      fetch('/api/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'test' }),
      }),
      12000,
      'test_timeout',
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        ok: false,
        reason: data.error || `status_${res.status}`,
        details: data,
      }
    }
    return {
      ok: !!data.ok,
      sent: data.sent ?? 0,
      failed: data.failed ?? 0,
      subscriptions: data.subscriptions ?? 0,
      reason: data.ok ? undefined : 'no_delivery',
    }
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) }
  }
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

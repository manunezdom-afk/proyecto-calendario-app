/**
 * pushSubscription — cliente para suscribirse/desuscribirse a Web Push
 *
 * El flujo:
 * 1. El usuario otorga permiso de notificaciones (browser API)
 * 2. Registramos al service worker en /sw.js si no está
 * 3. Subscribimos al pushManager con la VAPID_PUBLIC_KEY
 * 4. POST /api/push-subscribe con la subscription JSON (guarda en Supabase)
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

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
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
      // Sin sesión, guardamos local para reintentar al loguearse
      localStorage.setItem('focus_pending_push_sub', JSON.stringify(subJson))
      return { ok: true, subscription: subJson, reason: 'saved_locally_no_session' }
    }

    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        subscription: subJson,
        user_agent: navigator.userAgent.slice(0, 200),
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, reason: 'backend_error', error: data.error || `status ${res.status}` }
    }
    localStorage.removeItem('focus_pending_push_sub')
    return { ok: true, subscription: subJson }
  } catch (err) {
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
      await fetch('/api/push-unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ endpoint }),
      })
    }
  } catch {}

  return { ok: true }
}

/** Si había una suscripción pendiente (hecha antes de loguearse), subirla ahora */
export async function flushPendingSubscription() {
  const raw = localStorage.getItem('focus_pending_push_sub')
  if (!raw) return
  try {
    const subJson = JSON.parse(raw)
    const token = (await supabase?.auth.getSession())?.data?.session?.access_token
    if (!token) return
    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        subscription: subJson,
        user_agent: navigator.userAgent.slice(0, 200),
      }),
    })
    if (res.ok) localStorage.removeItem('focus_pending_push_sub')
  } catch {}
}

import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { apiFetch } from './apiClient'
import { supabase } from './supabase'

const TOKEN_KEY = 'focus_native_push_token'
const PENDING_TOKEN_KEY = 'focus_pending_native_push_token'

let registrationListener = null
let registrationErrorListener = null

function withTimeout(promise, ms, label = 'timeout') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms)
    Promise.resolve(promise).then(
      (value) => { clearTimeout(t); resolve(value) },
      (err) => { clearTimeout(t); reject(err) },
    )
  })
}

export function isNativePushSupported() {
  return Capacitor.isNativePlatform?.() && Capacitor.getPlatform?.() === 'ios'
}

function normalizeToken(value) {
  const token = String(value || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase()
  return token.length >= 8 && token.length % 2 === 0 ? token : null
}

function nativeEnvironment() {
  return import.meta.env.VITE_APNS_ENV || (import.meta.env.DEV ? 'development' : 'production')
}

async function postNativeToken(token) {
  const accessToken = (await supabase?.auth.getSession())?.data?.session?.access_token
  if (!accessToken) {
    localStorage.setItem(PENDING_TOKEN_KEY, token)
    return { ok: true, reason: 'saved_locally_no_session', token }
  }

  const res = await withTimeout(
    apiFetch('/api/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action: 'native_subscribe',
        token,
        platform: Capacitor.getPlatform?.() || 'ios',
        environment: nativeEnvironment(),
        user_agent: navigator.userAgent.slice(0, 200),
      }),
    }),
    10000,
    'native_backend_timeout',
  )

  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, reason: data.error || `status_${res.status}`, error: data.message }
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.removeItem(PENDING_TOKEN_KEY)
  return { ok: true, token }
}

export async function getNativePushStatus() {
  if (!isNativePushSupported()) {
    return { supported: false, permission: 'unsupported', subscribed: false }
  }

  try {
    const perm = await PushNotifications.checkPermissions()
    const token = localStorage.getItem(TOKEN_KEY)
    return {
      supported: true,
      permission: perm.receive || 'prompt',
      subscribed: Boolean(token),
      token,
    }
  } catch (err) {
    return {
      supported: true,
      permission: 'unknown',
      subscribed: false,
      error: String(err?.message || err),
    }
  }
}

export async function registerNativePush({ prompt = true } = {}) {
  if (!isNativePushSupported()) return { ok: false, reason: 'unsupported' }

  let perm = await PushNotifications.checkPermissions()
  if (perm.receive !== 'granted') {
    if (!prompt) return { ok: false, reason: 'permission_not_granted' }
    perm = await PushNotifications.requestPermissions()
  }
  if (perm.receive !== 'granted') return { ok: false, reason: 'permission_denied' }

  return new Promise(async (resolve) => {
    let settled = false
    const finish = async (result) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      resolve(result)
    }

    const timeout = window.setTimeout(() => {
      finish({ ok: false, reason: 'native_registration_timeout' })
    }, 15000)

    try {
      await registrationListener?.remove?.()
      await registrationErrorListener?.remove?.()
      registrationListener = await PushNotifications.addListener('registration', async ({ value }) => {
        const token = normalizeToken(value)
        if (!token) {
          await finish({ ok: false, reason: 'invalid_native_token' })
          return
        }
        const saved = await postNativeToken(token).catch((err) => ({
          ok: false,
          reason: String(err?.message || err),
        }))
        await finish(saved)
      })
      registrationErrorListener = await PushNotifications.addListener('registrationError', async (error) => {
        await finish({
          ok: false,
          reason: 'native_registration_failed',
          error: String(error?.error || error?.message || error),
        })
      })
      await PushNotifications.register()
    } catch (err) {
      await finish({
        ok: false,
        reason: 'native_registration_failed',
        error: String(err?.message || err),
      })
    }
  })
}

export async function flushPendingNativeToken() {
  const pending = normalizeToken(localStorage.getItem(PENDING_TOKEN_KEY))
  if (!pending) return { ok: true, reason: 'none' }
  return postNativeToken(pending)
}

export async function unregisterNativePush() {
  if (!isNativePushSupported()) return { ok: false, reason: 'unsupported' }
  const token = normalizeToken(localStorage.getItem(TOKEN_KEY) || localStorage.getItem(PENDING_TOKEN_KEY))
  if (!token) return { ok: true, reason: 'already_unregistered' }

  try {
    const accessToken = (await supabase?.auth.getSession())?.data?.session?.access_token
    if (accessToken) {
      await apiFetch('/api/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'native_unsubscribe', token }),
      })
    }
  } catch {}

  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(PENDING_TOKEN_KEY)
  return { ok: true }
}

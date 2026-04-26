import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

const DEFAULT_API_ORIGIN = 'https://www.usefocus.me'

function apiOrigin() {
  return String(
    import.meta.env.VITE_API_ORIGIN ||
    import.meta.env.VITE_APP_URL ||
    DEFAULT_API_ORIGIN,
  ).replace(/\/$/, '')
}

export function apiUrl(path) {
  const value = String(path || '')
  if (/^https?:\/\//i.test(value)) return value
  if (!value.startsWith('/api/')) return value
  if (!Capacitor.isNativePlatform?.()) return value
  return `${apiOrigin()}${value}`
}

// Inyecta automáticamente el Bearer token de la sesión Supabase actual cuando
// el caller no setea Authorization manualmente. Necesario para endpoints que
// identifican al usuario (focus-assistant, analyze-photo, push, calendar-feeds)
// y para proteger costos: sin token el backend rechaza con 401, así un atacante
// que descubra la URL no puede agotar la cuota de Anthropic. Los callers que ya
// pasaban Authorization a mano siguen funcionando — preservamos su valor.
export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (!headers.has('Authorization') && !headers.has('authorization')) {
    try {
      const session = (await supabase?.auth.getSession())?.data?.session
      const token = session?.access_token
      if (token) headers.set('Authorization', `Bearer ${token}`)
    } catch {
      // Sin sesión válida: el endpoint responderá 401 si requiere auth.
      // Para endpoints públicos (auth/email/send-otp) la ausencia de header
      // es esperada y no rompe nada.
    }
  }
  return fetch(apiUrl(path), { ...options, headers })
}

import { Capacitor } from '@capacitor/core'

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

export function apiFetch(path, options) {
  return fetch(apiUrl(path), options)
}

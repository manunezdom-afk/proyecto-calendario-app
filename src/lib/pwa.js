// ── Registro del Service Worker ─────────────────────────────────────────────
// Solo registra en producción (Vite dev server no sirve bien el SW)

export function registerServiceWorker() {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[Focus] 🛰️ Service Worker registrado', reg.scope)

        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing
          if (!newSW) return
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('focus:sw-update-available'))
            }
          })
        })
      })
      .catch((err) => console.warn('[Focus] ⚠️ SW registration failed', err))

    // El SW avisa cuando activó una nueva versión → recargamos para aplicarla
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SW_UPDATED') {
        window.location.reload()
      }
    })
  })
}

// ── Install prompt (BeforeInstallPromptEvent) ──────────────────────────────
// Guarda el evento para dispararlo cuando el usuario quiera instalar.

let deferredPrompt = null
const listeners = new Set()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    listeners.forEach((fn) => fn(true))
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    listeners.forEach((fn) => fn(false))
  })
}

export function canInstall() {
  return !!deferredPrompt
}

export function onInstallAvailable(fn) {
  listeners.add(fn)
  // Disparar inmediatamente con el estado actual
  fn(canInstall())
  return () => listeners.delete(fn)
}

export async function promptInstall() {
  if (!deferredPrompt) return { outcome: 'unavailable' }
  deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  deferredPrompt = null
  listeners.forEach((fn) => fn(false))
  return choice
}

// Detecta si ya está corriendo como PWA instalada (iOS + desktop + Android)
export function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator?.standalone === true
  )
}

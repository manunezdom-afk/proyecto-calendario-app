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

        // Si ya hay un SW esperando al cargar (instalado pero no activo), actívalo YA
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })

        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing
          if (!newSW) return
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              // Auto-skip para que la nueva versión tome control sin intervención del usuario
              newSW.postMessage({ type: 'SKIP_WAITING' })
              window.dispatchEvent(new CustomEvent('focus:sw-update-available'))
            }
          })
        })

        // Chequeo periódico de updates (clave para PWA instalada donde la pestaña nunca se cierra)
        const checkForUpdates = () => reg.update().catch(() => {})
        setInterval(checkForUpdates, 60_000)
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) checkForUpdates()
        })
        window.addEventListener('focus', checkForUpdates)
      })
      .catch((err) => console.warn('[Focus] ⚠️ SW registration failed', err))

    // El SW avisa cuando activó una nueva versión → recargamos para aplicarla
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SW_UPDATED') {
        window.location.reload()
      }
    })

    // Si el controller cambia (nuevo SW tomó el mando), recargar para usar los assets nuevos
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
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

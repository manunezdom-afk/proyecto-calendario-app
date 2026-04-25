// ── Registro del Service Worker ─────────────────────────────────────────────
// Solo registra en producción (Vite dev server no sirve bien el SW).
//
// Flujo de actualización:
//   1. El browser detecta un sw.js distinto (Cache-Control no-store en Vercel).
//   2. El SW nuevo pasa a estado "installed" y queda en waiting.
//   3. Despachamos `focus:sw-update-available` por si la UI quiere reaccionar.
//   4. Auto-apply: si la app está en background, mandamos SKIP_WAITING altiro.
//      Si está visible, esperamos un delay corto y recargamos una sola vez.
//      Esto evita que una PWA instalada quede pegada días en una build vieja.
//   5. El SW nuevo se activa y toma control → `controllerchange` dispara un
//      único reload para reflejar el bundle fresco.
//
// Guard clave: solo recargamos si nosotros pedimos el skipWaiting. Evita el
// reload espurio del primer install (cuando el SW toma control por primera
// vez sin que haya un update real).

export function registerServiceWorker() {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return

  let refreshing = false
  let updateApplied = false
  const VISIBLE_UPDATE_APPLY_DELAY_MS = 1200

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    if (!updateApplied) return
    refreshing = true
    window.location.reload()
  })

  const applyUpdate = (reg) => {
    const waiting = reg?.waiting
    if (!waiting || updateApplied) return
    updateApplied = true
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  // Registro del SW sin esperar al evento `load`. En iPhone PWA standalone
  // a veces `load` se dispara antes de que adjuntemos el listener (la evaluación
  // del module puede ir después del parseo de todos los recursos) y el listener
  // nunca corre → el SW no se registra → al siguiente cold start se repite el
  // problema. Registramos directo: si el navegador soporta SW, esto es seguro
  // desde cualquier punto post-parse.
  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        console.log('[Focus] 🛰️ Service Worker registrado', reg.scope)

        const onUpdateReady = () => {
          if (updateApplied) return
          // Despachamos para que la UI pueda mostrar un aviso opcional.
          window.dispatchEvent(new CustomEvent('focus:sw-update-available'))

          // Si la pestaña ya está oculta, aplicá ya: la próxima vez que el
          // usuario abra la PWA va a ver la versión nueva directamente.
          if (document.hidden) {
            applyUpdate(reg)
            return
          }
          // Si está visible, aplicamos igual después de un delay corto. En
          // piloto nos importa más no dejar a nadie atrapado en una build
          // vieja que preservar una sesión antigua indefinidamente.
          let visibleUpdateTimer
          const applyVisibleUpdate = () => {
            document.removeEventListener('visibilitychange', onVisible)
            window.clearTimeout(visibleUpdateTimer)
            applyUpdate(reg)
          }
          const onVisible = () => {
            if (!document.hidden) applyVisibleUpdate()
          }
          visibleUpdateTimer = window.setTimeout(
            applyVisibleUpdate,
            VISIBLE_UPDATE_APPLY_DELAY_MS,
          )
          document.addEventListener('visibilitychange', onVisible)
        }

        // Caso 1: al registrar ya había un SW en waiting (usuario reabre
        // la PWA después de una publicación reciente).
        if (reg.waiting && navigator.serviceWorker.controller) {
          onUpdateReady()
        }

        // Caso 2: el update aparece mientras la app ya está abierta.
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing
          if (!newSW) return
          newSW.addEventListener('statechange', () => {
            if (
              newSW.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              onUpdateReady()
            }
          })
        })

        // Chequeo proactivo de updates — crítico para PWA instalada en iOS,
        // donde la pestaña puede vivir durante días sin que el browser
        // revise el SW por su cuenta.
        const checkForUpdates = () => reg.update().catch(() => {})
        setInterval(checkForUpdates, 60_000)
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) checkForUpdates()
        })
        window.addEventListener('focus', checkForUpdates)
        window.addEventListener('online', checkForUpdates)

        // Mensajes desde el SW (por ejemplo SW_ACTIVATED al terminar un
        // activate). No forzamos reload aquí: el controllerchange ya lo hace.
        navigator.serviceWorker.addEventListener('message', (ev) => {
          if (ev.data?.type === 'SW_ACTIVATED') {
            console.log('[Focus] SW activado', ev.data.version)
          }
        })
      })
      .catch((err) => console.warn('[Focus] ⚠️ SW registration failed', err))
  }

  // Si ya terminó de cargar, registramos ya. Si no, esperamos a load para
  // no competir por recursos con la primera pintura de la app. iOS es quien
  // se beneficia del path directo: el load a veces ya pasó para cuando corre.
  if (document.readyState === 'complete') {
    register()
  } else {
    window.addEventListener('load', register, { once: true })
  }
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

// ── Registro del Service Worker ─────────────────────────────────────────────
// Solo registra en producción (Vite dev server no sirve bien el SW).
//
// Flujo de actualización:
//   1. El browser detecta un sw.js distinto (Cache-Control no-store en Vercel).
//   2. El SW nuevo pasa a estado "installed" y queda en waiting.
//   3. Despachamos `focus:sw-update-available` por si la UI quiere reaccionar.
//   4. Auto-apply: cuando el usuario vuelve a la app (visibilitychange →
//      visible) o ya está en background, mandamos SKIP_WAITING. Es la ventana
//      más segura — no está escribiendo.
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

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    if (!updateApplied) return
    refreshing = true
    window.location.reload()
  })

  const applyUpdate = (reg) => {
    const waiting = reg?.waiting
    if (!waiting) return
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
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[Focus] 🛰️ Service Worker registrado', reg.scope)

        const onUpdateReady = () => {
          // Despachamos para que la UI pueda mostrar un aviso opcional.
          window.dispatchEvent(new CustomEvent('focus:sw-update-available'))

          // Si la pestaña ya está oculta, aplicá ya: la próxima vez que el
          // usuario abra la PWA va a ver la versión nueva directamente.
          if (document.hidden) {
            applyUpdate(reg)
            return
          }
          // Si está visible, aplicamos cuando pase a background. Antes el
          // listener se disparaba al volver a visible — el reload caía justo
          // cuando el usuario reabría la PWA, y en iPhone eso se veía como
          // "me cerró la sesión" porque el cold start re-hidrataba Supabase
          // mientras el SW ya estaba cambiando el controller. Ahora el
          // reload ocurre mientras la app está oculta: al reabrir ya está
          // la versión nueva, sin flash y sin race con el refresh del token.
          const onHidden = () => {
            if (!document.hidden) return
            document.removeEventListener('visibilitychange', onHidden)
            applyUpdate(reg)
          }
          document.addEventListener('visibilitychange', onHidden)
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

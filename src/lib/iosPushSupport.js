// Detección de compatibilidad iOS para Web Push.
//
// iOS es especial: solo puede recibir Web Push si (a) el sistema es iOS 16.4
// o superior, y (b) la app está instalada en el home screen ("Añadir a
// pantalla de inicio"). Safari plano NUNCA recibe push, da igual el permiso.
//
// Este módulo centraliza toda esa lógica para que la UI muestre mensajes
// precisos ("primero instala", "actualiza iOS", etc.) en lugar de un
// silencioso "permission_denied".

const UA = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const PLATFORM = typeof navigator !== 'undefined' ? navigator.platform || '' : ''

// Detecta iPhone, iPad y iPod. Incluye el caso iPadOS 13+ que reporta
// "MacIntel" como platform pero tiene maxTouchPoints > 1.
export function isIOS() {
  if (typeof window === 'undefined') return false
  if (/iPhone|iPad|iPod/.test(UA)) return true
  // iPadOS 13+ se disfraza de macOS
  if (PLATFORM === 'MacIntel' && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) {
    return true
  }
  return false
}

// Devuelve { major, minor } del iOS/iPadOS detectado, o null si no se puede.
export function iosVersion() {
  if (!isIOS()) return null
  // Formato típico: "... OS 16_4_1 ..." o "Version/16.4 Mobile/..."
  const m = UA.match(/OS (\d+)[_.](\d+)(?:[_.](\d+))?/)
  if (m) return { major: +m[1], minor: +m[2], patch: +(m[3] || 0) }
  // iPadOS disfrazado: "Version/16.4" es un fallback razonable
  const v = UA.match(/Version\/(\d+)\.(\d+)/)
  if (v) return { major: +v[1], minor: +v[2], patch: 0 }
  return null
}

// iOS agregó Web Push para PWAs instaladas en 16.4. Antes de esa versión,
// directamente no existe la API.
export function iosVersionSupportsPush(ver = iosVersion()) {
  if (!ver) return false
  if (ver.major > 16) return true
  if (ver.major === 16 && ver.minor >= 4) return true
  return false
}

// Matchea el matchMedia standalone + el flag legacy de iOS.
export function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator?.standalone === true
  )
}

// Estado agregado para que la UI decida qué mostrar.
//
// reason:
//   'ok'           — listo para suscribir
//   'not_ios'      — otra plataforma (no aplica este flujo especial)
//   'ios_too_old'  — iOS < 16.4, no hay Web Push disponible
//   'not_installed'— iOS OK pero el usuario está en Safari, no en la PWA
//   'no_api'       — ni Notification ni PushManager existen (muy raro)
export function getIOSPushStatus() {
  const hasNotificationAPI =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window

  const iosFlag = isIOS()
  const ver = iosVersion()
  const standalone = isStandalone()

  if (!iosFlag) {
    return {
      isIOS: false,
      version: null,
      standalone,
      canReceivePush: hasNotificationAPI,
      reason: hasNotificationAPI ? 'ok' : 'no_api',
    }
  }

  if (!iosVersionSupportsPush(ver)) {
    return {
      isIOS: true,
      version: ver,
      standalone,
      canReceivePush: false,
      reason: 'ios_too_old',
    }
  }

  if (!standalone) {
    return {
      isIOS: true,
      version: ver,
      standalone: false,
      canReceivePush: false,
      reason: 'not_installed',
    }
  }

  if (!hasNotificationAPI) {
    return { isIOS: true, version: ver, standalone: true, canReceivePush: false, reason: 'no_api' }
  }

  return { isIOS: true, version: ver, standalone: true, canReceivePush: true, reason: 'ok' }
}

/**
 * permissions — estado y solicitud de permisos del dispositivo (micrófono,
 * cámara, notificaciones) con cobertura especial de Safari/iOS.
 *
 * Estados posibles que devuelven las funciones get*Permission():
 *   · 'granted'          — permiso concedido
 *   · 'denied'           — permiso denegado (el navegador ya no volverá a
 *                          preguntar; el usuario debe ir a Ajustes del sistema)
 *   · 'prompt'           — el navegador puede volver a preguntar
 *   · 'unknown'          — el navegador no expone la consulta (típico en
 *                          Safari viejo). Se resuelve haciendo una solicitud
 *                          real que devolverá granted o denied.
 *   · 'unsupported'      — el navegador no soporta el permiso
 *   · 'requires_install' — en iOS, notificaciones push solo funcionan con la
 *                          app instalada en la pantalla de inicio
 *
 * Safari/iOS no expone siempre navigator.permissions.query para micrófono y
 * cámara. Por eso, si la consulta falla, devolvemos 'unknown' y la UI puede
 * ofrecer "Probar permiso" para averiguar el estado real.
 */

export function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator?.standalone === true
}

export function isSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/chrome|crios|edg|opr|firefox|fxios/i.test(ua)) return false
  return /safari/i.test(ua) || isIOS()
}

function hasMediaDevices() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

function hasSpeechRecognition() {
  if (typeof window === 'undefined') return false
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

// Safari en iPhone/iPad expone webkitSpeechRecognition desde iOS 14.5, pero la
// implementación es inestable: aunque el permiso de micrófono esté concedido,
// .start() a menudo emite 'not-allowed' o 'service-not-allowed' por razones
// estructurales (PWA standalone, requiere Dictado del sistema activado, origen,
// etc.). Tratarlo como "sin soporte" evita el falso "Permiso denegado" y nos
// lleva al dictado nativo del teclado iOS, que siempre funciona.
export function isIOSSafari() {
  if (typeof navigator === 'undefined') return false
  if (!isIOS()) return false
  const ua = navigator.userAgent
  if (/crios|fxios|edgios|opios/i.test(ua)) return false
  return true
}

export function hasWorkingSpeechRecognition() {
  if (!hasSpeechRecognition()) return false
  if (isIOSSafari()) return false
  return true
}

async function queryPermission(name) {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown'
  try {
    const res = await navigator.permissions.query({ name })
    return res.state || 'unknown'
  } catch {
    return 'unknown'
  }
}

// ── Micrófono ──────────────────────────────────────────────────────────────

export async function getMicrophonePermission() {
  if (!hasMediaDevices() && !hasSpeechRecognition()) return 'unsupported'
  // Safari iOS raramente expone 'microphone' en permissions.query. Por eso
  // el fallback 'unknown' — la UI puede ofrecer probar el permiso.
  const state = await queryPermission('microphone')
  return state
}

export async function requestMicrophonePermission() {
  if (!hasMediaDevices()) {
    // Sin getUserMedia no podemos solicitar explícitamente. En iOS <14 el
    // único trigger es iniciar webkitSpeechRecognition.
    return { ok: false, reason: 'unsupported' }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // Soltamos los tracks inmediatamente — solo queríamos el prompt.
    stream.getTracks().forEach(t => t.stop())
    return { ok: true }
  } catch (e) {
    const name = e?.name || ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { ok: false, reason: 'denied' }
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { ok: false, reason: 'no_device' }
    }
    return { ok: false, reason: 'unknown', error: String(e?.message || e) }
  }
}

// ── Cámara ─────────────────────────────────────────────────────────────────

export async function getCameraPermission() {
  if (!hasMediaDevices()) return 'unsupported'
  const state = await queryPermission('camera')
  return state
}

export async function requestCameraPermission() {
  if (!hasMediaDevices()) return { ok: false, reason: 'unsupported' }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    stream.getTracks().forEach(t => t.stop())
    return { ok: true }
  } catch (e) {
    const name = e?.name || ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { ok: false, reason: 'denied' }
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { ok: false, reason: 'no_device' }
    }
    return { ok: false, reason: 'unknown', error: String(e?.message || e) }
  }
}

// ── Notificaciones ─────────────────────────────────────────────────────────

export function getNotificationsPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (isIOS() && !isStandalone()) return 'requires_install'
  const p = Notification.permission
  if (p === 'default') return 'prompt'
  return p // 'granted' o 'denied'
}

export async function requestNotificationsPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { ok: false, reason: 'unsupported' }
  }
  if (isIOS() && !isStandalone()) {
    return { ok: false, reason: 'requires_install' }
  }
  try {
    const result = await Notification.requestPermission()
    if (result === 'granted') return { ok: true }
    return { ok: false, reason: result === 'denied' ? 'denied' : 'dismissed' }
  } catch (e) {
    return { ok: false, reason: 'unknown', error: String(e?.message || e) }
  }
}

// ── Suscripción reactiva ───────────────────────────────────────────────────

/**
 * Llama a cb() cuando cambie el estado del permiso. Devuelve una función
 * para cancelar la suscripción. Útil para refrescar la UI cuando el usuario
 * cambia el permiso desde Ajustes del sistema y vuelve a la app.
 */
export async function watchPermission(name, cb) {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return () => {}
  try {
    const res = await navigator.permissions.query({ name })
    const handler = () => cb(res.state)
    res.addEventListener?.('change', handler)
    return () => res.removeEventListener?.('change', handler)
  } catch {
    return () => {}
  }
}

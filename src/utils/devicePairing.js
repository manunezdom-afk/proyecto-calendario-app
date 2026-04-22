// Utilidades compartidas para el flujo de vinculación de dispositivos.
//
// El user_code que genera /api/auth/device/start viene del alfabeto:
//   ABCDEFGHJKLMNPQRSTUVWXYZ23456789
// (sin 0/O/1/I/L para evitar ambigüedad visual). Largo esperado: 8.
//
// El QR que mostramos al nuevo dispositivo codifica una URL completa:
//   https://<origin>/?pair=<USER_CODE>
// Eso tiene dos ventajas:
//   1) La cámara nativa de iOS/Android la reconoce como link y ofrece abrir
//      la app directamente → el `?pair=...` lo levanta App.jsx.
//   2) Nuestro escáner in-app acepta URLs o texto plano: normalizamos ambos.

const USER_CODE_RE = /^[A-HJKMNP-Z2-9]{8}$/

export function isValidUserCode(raw) {
  if (!raw) return false
  return USER_CODE_RE.test(String(raw).toUpperCase().replace(/[^A-Z0-9]/g, ''))
}

// Limpia un user_code para uso interno (mayúsculas, sin separadores). Devuelve
// '' si no cumple el formato para que el caller pueda detectar inválido.
export function normalizeUserCode(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return clean.length === 8 ? clean : ''
}

// Acepta URL "https://...?pair=XXX" o 8 chars sueltos; devuelve el user_code
// normalizado o ''. Otros formatos → ''.
export function extractUserCodeFromScanned(scanned) {
  if (!scanned) return ''
  const raw = String(scanned).trim()
  // 1) URL con query ?pair=...
  try {
    const u = new URL(raw)
    const fromQuery = u.searchParams.get('pair') || u.searchParams.get('code')
    if (fromQuery) return normalizeUserCode(fromQuery)
  } catch {
    // No era URL, seguimos.
  }
  // 2) Texto plano — asumimos que es el código directo.
  return normalizeUserCode(raw)
}

// Construye el payload del QR que verá el otro dispositivo. Si hay `origin`
// (window.location.origin) lo usamos; si no, caemos al código pelado.
export function buildQRValue(userCode, origin) {
  const clean = normalizeUserCode(userCode)
  if (!clean) return ''
  if (origin) return `${origin}/?pair=${clean}`
  return clean
}

// Clave donde guardamos un code entrante (desde la URL ?pair=XXX) a la espera
// de que el AuthModal lo consuma. sessionStorage → sobrevive a reabrir modal
// pero no a cerrar la pestaña.
export const INCOMING_PAIR_CODE_KEY = 'focus_device_incoming_code'

export function readIncomingPairCode() {
  try {
    const raw = sessionStorage.getItem(INCOMING_PAIR_CODE_KEY)
    if (!raw) return ''
    return normalizeUserCode(raw)
  } catch {
    return ''
  }
}

export function writeIncomingPairCode(code) {
  const clean = normalizeUserCode(code)
  if (!clean) return false
  try {
    sessionStorage.setItem(INCOMING_PAIR_CODE_KEY, clean)
    return true
  } catch {
    return false
  }
}

export function clearIncomingPairCode() {
  try { sessionStorage.removeItem(INCOMING_PAIR_CODE_KEY) } catch {}
}

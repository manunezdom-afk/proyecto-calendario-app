// Mapea errores de Supabase Auth a mensajes en español humanizados.
// Nunca mostramos el texto crudo del provider. Matching por substring
// en message/code porque Supabase no garantiza un esquema de error estable.

// Patrón único para rate-limit — se exporta para que la UI aplique un
// cooldown largo cuando el backend rechaza por límite de emails.
const RATE_LIMIT_RE = /rate limit|too many requests|email rate|for security purposes|only request this after/i

const PATTERNS = [
  // Rate limiting
  { match: RATE_LIMIT_RE,
    msg: 'Demasiados intentos. Espera unos minutos antes de pedir otro código.' },

  // OTP inválido o expirado
  { match: /token has expired|otp.*expired|invalid.*token|invalid.*otp/i,
    msg: 'El código es incorrecto o expiró. Pide uno nuevo.' },

  // Email inválido
  { match: /invalid.*email|email.*invalid|unable to validate email/i,
    msg: 'El email no es válido. Revisa que esté bien escrito.' },

  // Red / offline
  { match: /network|failed to fetch|load failed|fetch.*failed/i,
    msg: 'No hay conexión. Revisa tu internet y vuelve a intentar.' },

  // Signups disabled
  { match: /signups.*disabled|signup.*disabled/i,
    msg: 'El registro está deshabilitado temporalmente. Vuelve a intentar más tarde.' },

  // User banned / locked
  { match: /banned|locked|disabled user/i,
    msg: 'Esta cuenta está deshabilitada. Contáctanos si crees que es un error.' },

  // Configuración rota
  { match: /supabase no configurado|not configured/i,
    msg: 'La app no está conectada al servidor. Recarga la página.' },

  // 5xx genérico
  { match: /internal server error|5\d\d|server error/i,
    msg: 'Error del servidor. Prueba de nuevo en un minuto.' },
]

export function isRateLimitError(err) {
  if (!err) return false
  const raw = String(err?.message || err?.error_description || err || '').trim()
  if (!raw) return false
  // Supabase también expone status 429 en `err.status`
  if (Number(err?.status) === 429) return true
  return RATE_LIMIT_RE.test(raw)
}

// Intenta extraer segundos de espera de un error tipo
// "For security purposes, you can only request this after 47 seconds."
export function extractRetryAfterSec(err) {
  const raw = String(err?.message || err?.error_description || err || '')
  const m = raw.match(/after\s+(\d+)\s*seconds?/i)
  if (m) return Math.min(3600, Math.max(1, parseInt(m[1], 10)))
  return null
}

export function humanizeAuthError(err) {
  if (!err) return 'Algo salió mal. Intenta de nuevo.'
  const raw = String(err?.message || err?.error_description || err || '').trim()
  if (!raw) return 'Algo salió mal. Intenta de nuevo.'
  for (const { match, msg } of PATTERNS) {
    if (match.test(raw)) return msg
  }
  // Fallback — no filtramos el mensaje crudo al usuario
  return 'No pudimos completar la acción. Vuelve a intentar.'
}

// Validación de email estricta — no solo "contiene @".
// RFC 5322 simplificado: local@domain.tld con TLD >= 2 chars.
const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

export function isValidEmail(value) {
  if (!value) return false
  const v = String(value).trim()
  if (v.length > 254) return false
  return EMAIL_RE.test(v)
}

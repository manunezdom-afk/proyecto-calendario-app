// Mapea errores de Supabase Auth a mensajes en español humanizados.
// Nunca mostramos el texto crudo del provider. Matching por substring
// en message/code porque Supabase no garantiza un esquema de error estable.

const PATTERNS = [
  // Rate limiting
  { match: /rate limit|too many requests|email rate/i,
    msg: 'Demasiados intentos. Esperá unos minutos antes de pedir otro código.' },

  // OTP inválido o expirado
  { match: /token has expired|otp.*expired|invalid.*token|invalid.*otp/i,
    msg: 'El código es incorrecto o expiró. Pedí uno nuevo.' },

  // Email inválido
  { match: /invalid.*email|email.*invalid|unable to validate email/i,
    msg: 'El email no es válido. Revisá que esté bien escrito.' },

  // Red / offline
  { match: /network|failed to fetch|load failed|fetch.*failed/i,
    msg: 'No hay conexión. Revisá tu internet y volvé a intentar.' },

  // Signups disabled
  { match: /signups.*disabled|signup.*disabled/i,
    msg: 'El registro está deshabilitado temporalmente. Volvé a intentar más tarde.' },

  // User banned / locked
  { match: /banned|locked|disabled user/i,
    msg: 'Esta cuenta está deshabilitada. Contactanos si creés que es un error.' },

  // Configuración rota
  { match: /supabase no configurado|not configured/i,
    msg: 'La app no está conectada al servidor. Recargá la página.' },

  // 5xx genérico
  { match: /internal server error|5\d\d|server error/i,
    msg: 'Error del servidor. Probá de nuevo en un minuto.' },
]

export function humanizeAuthError(err) {
  if (!err) return 'Algo salió mal. Intentá de nuevo.'
  const raw = String(err?.message || err?.error_description || err || '').trim()
  if (!raw) return 'Algo salió mal. Intentá de nuevo.'
  for (const { match, msg } of PATTERNS) {
    if (match.test(raw)) return msg
  }
  // Fallback — no filtramos el mensaje crudo al usuario
  return 'No pudimos completar la acción. Volvé a intentar.'
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

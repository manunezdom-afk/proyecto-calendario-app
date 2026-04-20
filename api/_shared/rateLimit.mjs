// Rate limiter global respaldado por Supabase (reemplaza el contador
// in-memory que no escalaba entre instancias serverless).
//
// La tabla `api_rate_limits` + RPC `increment_rate_limit` están definidas
// en supabase/schema.sql + migraciones. El RPC hace un INSERT atómico con
// ON CONFLICT, así que no hay races entre instancias paralelas.

import { getSupabaseAdmin } from '../_supabaseAdmin.js'

export class RateLimitError extends Error {
  constructor({ key, resetAt }) {
    super('rate_limit')
    this.code = 'rate_limit'
    this.status = 429
    this.key = key
    this.resetAt = resetAt
  }
}

// Uso:
//   await enforceRateLimit({
//     key: `analyze-photo:ip-${clientIP(req)}`,
//     windowSeconds: 60,
//     maxCount: 20,
//   })
//
// Lanza RateLimitError si se excede. Si Supabase no está configurado
// (ej. preview deploy sin SERVICE_ROLE_KEY), deja pasar — el tope lo
// cubre Vercel/Anthropic upstream igual.
export async function enforceRateLimit({ key, windowSeconds, maxCount }) {
  const admin = getSupabaseAdmin()
  if (!admin) return { skipped: true }

  const { data, error } = await admin.rpc('increment_rate_limit', {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max_count: maxCount,
  })

  if (error) {
    // No bloqueamos por un error de infra — degradamos al modo permisivo.
    console.warn('[rateLimit] RPC failed, allowing:', error.message)
    return { allowed: true, degraded: true }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.allowed) {
    throw new RateLimitError({ key, resetAt: row?.reset_at })
  }
  return { allowed: true, remaining: row.remaining, resetAt: row.reset_at }
}

// IP del cliente detrás de Vercel/Netlify proxies. Prefiere X-Forwarded-For
// (primer entry = cliente real), cae a remoteAddress o "unknown".
export function clientIP(req) {
  const xff = req.headers?.['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.socket?.remoteAddress || req.headers?.['x-real-ip'] || 'unknown'
}

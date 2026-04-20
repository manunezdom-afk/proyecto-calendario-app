// Token HMAC para autorizar /api/push-snooze sin depender del JWT Supabase
// (que expira en 1h y se pierde entre restarts del SW en iOS).
//
// El cron firma un token corto por notificación con CRON_SECRET y lo embebe
// en el push payload. Cuando el usuario toca "Posponer", el SW devuelve el
// token y el endpoint verifica la firma + user_id + evento. Scope mínimo:
// ese token solo sirve para snoozear esa combinación (user_id, event_id).

import crypto from 'node:crypto'

const SECRET = process.env.SNOOZE_SECRET || process.env.CRON_SECRET

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 2 ? '==' : str.length % 4 === 3 ? '=' : ''
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

// Firma un token con ttlSeconds (default 25h — notif puede esperar hasta 24h
// snoozeada y seguimos aceptando el siguiente snooze encima).
export function signSnoozeToken({ userId, eventId, ttlSeconds = 25 * 3600 }) {
  if (!SECRET) throw new Error('snooze_secret_missing')
  const payload = { u: userId, e: eventId, x: Date.now() + ttlSeconds * 1000 }
  const body = b64urlEncode(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest()
  return `${body}.${b64urlEncode(sig)}`
}

// Verifica. Devuelve { userId, eventId } si es válido, null si no.
export function verifySnoozeToken(token) {
  if (!SECRET || !token || typeof token !== 'string') return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null

  const expected = crypto.createHmac('sha256', SECRET).update(body).digest()
  const given = b64urlDecode(sig)
  if (given.length !== expected.length) return null
  // timingSafeEqual requiere buffers del mismo tamaño, ya chequeado arriba.
  if (!crypto.timingSafeEqual(given, expected)) return null

  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'))
    if (!payload?.u || !payload?.e) return null
    if (payload.x && payload.x < Date.now()) return null
    return { userId: payload.u, eventId: payload.e }
  } catch { return null }
}

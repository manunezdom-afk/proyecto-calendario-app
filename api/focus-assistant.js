// Handler Vercel — delega la lógica a api/_shared/focusAssistantCore.mjs.

import { runFocusAssistant, FocusAssistantError } from './_shared/focusAssistantCore.mjs'

// Rate limit in-memory (30 req/min por IP). Nota: no es global entre
// instancias serverless — para producción real migrar a Redis/Upstash.
const _rl = new Map()
function rateLimited(ip) {
  const now = Date.now()
  const e = _rl.get(ip)
  if (!e || now > e.reset) { _rl.set(ip, { count: 1, reset: now + 60_000 }); return false }
  if (e.count >= 30) return true
  e.count++
  return false
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'rate_limit', message: 'Demasiadas solicitudes. Espera un momento.' })
  }

  try {
    const result = await runFocusAssistant({
      apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
      ...(req.body || {}),
    })
    return res.status(200).json(result)
  } catch (err) {
    if (err instanceof FocusAssistantError) {
      return res.status(err.status).json({ error: err.code, ...(err.detail ? { detail: err.detail } : {}) })
    }
    console.error('[focus-assistant] Error:', err)
    return res.status(500).json({ error: 'internal_error', message: err.message })
  }
}

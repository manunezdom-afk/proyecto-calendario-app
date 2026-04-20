// Handler Vercel — delega la lógica a api/_shared/focusAssistantCore.mjs.

import { runFocusAssistant, FocusAssistantError } from './_shared/focusAssistantCore.mjs'
import { enforceRateLimit, RateLimitError, clientIP } from './_shared/rateLimit.mjs'
import { getUserIdFromAuth } from './_supabaseAdmin.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // Rate limit global via Supabase. Si el user está autenticado usamos su
  // user_id (limita el abuso de cuentas compartiendo IP); si no, IP a secas.
  const userId = await getUserIdFromAuth(req).catch(() => null)
  const limitKey = userId
    ? `focus-assistant:user-${userId}`
    : `focus-assistant:ip-${clientIP(req)}`
  try {
    await enforceRateLimit({
      key: limitKey,
      windowSeconds: 60,
      maxCount: 30,
    })
  } catch (err) {
    if (err instanceof RateLimitError) {
      return res.status(429).json({
        error: 'rate_limit',
        message: 'Demasiadas solicitudes. Espera un momento.',
        resetAt: err.resetAt,
      })
    }
    throw err
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

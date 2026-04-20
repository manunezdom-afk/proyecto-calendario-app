// POST /api/tts
// Text-to-Speech usando OpenAI (voz "nova"). Requiere OPENAI_API_KEY en
// server env. El cliente autenticado recibe audio/mpeg.
//
// Seguridad:
// - Requiere Bearer <JWT Supabase>. Sin login, 401 → el cliente cae a
//   Web Speech API (gratis, local). Esto evita abuso anónimo.
// - Tope diario por usuario (TTS_DAILY_CHAR_LIMIT) respaldado por la
//   tabla public.tts_usage + RPC increment_tts_usage. A $0.015/1K chars
//   (pricing tts-1) 25000 chars/día ≈ $0.375 max por usuario.
// - Ya no aceptamos `x-openai-key` en el header (antes era BYOK, riesgo
//   de leak en logs/proxies).
// - Rate limit 20 req/min por usuario via increment_rate_limit.

import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'
import { enforceRateLimit, RateLimitError } from './_shared/rateLimit.mjs'

const TTS_DAILY_CHAR_LIMIT = parseInt(process.env.TTS_DAILY_CHAR_LIMIT || '25000', 10)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'auth_required' })

  const apiKey = (process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim()
  if (!apiKey) return res.status(503).json({ error: 'no_key' })

  let body = {}
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  } catch { body = {} }

  const text = body.text
  if (!text?.trim()) return res.status(400).json({ error: 'no_text' })

  const chars = Math.min(text.length, 1000) // match slice abajo
  const requestedVoice = body.voice || 'nova'
  const voice = String(requestedVoice).toLowerCase()
  const ALLOWED = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])
  const selectedVoice = ALLOWED.has(voice) ? voice : 'nova'

  // Rate limit corto (evita loops o clicks repetidos).
  try {
    await enforceRateLimit({
      key: `tts:user-${userId}`,
      windowSeconds: 60,
      maxCount: 20,
    })
  } catch (err) {
    if (err instanceof RateLimitError) {
      return res.status(429).json({ error: 'rate_limit', resetAt: err.resetAt })
    }
    throw err
  }

  // Tope diario de caracteres por usuario.
  const admin = getSupabaseAdmin()
  if (admin) {
    const { data, error } = await admin.rpc('increment_tts_usage', {
      p_user_id: userId,
      p_chars: chars,
      p_daily_limit: TTS_DAILY_CHAR_LIMIT,
    })
    if (error) {
      console.warn('[tts] usage RPC failed', error.message)
    } else {
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.allowed) {
        return res.status(429).json({
          error: 'daily_quota_exceeded',
          used: row?.used,
          limit: TTS_DAILY_CHAR_LIMIT,
          message: 'Alcanzaste el tope diario de TTS. Vuelve mañana — mientras tanto, la lectura usará la voz nativa del sistema.',
        })
      }
    }
  }

  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: selectedVoice,
        input: text.slice(0, 1000),
        speed: 1.0,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[tts] OpenAI error:', response.status)
      return res.status(response.status).json({
        error: 'tts_failed',
        upstream_status: response.status,
        upstream_body: err?.slice?.(0, 800) || String(err),
      })
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    return res.send(buffer)
  } catch (err) {
    console.error('[tts] error:', err?.message)
    return res.status(500).json({ error: 'internal_error' })
  }
}

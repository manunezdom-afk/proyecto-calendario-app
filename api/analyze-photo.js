// Handler Vercel — delega la lógica a api/_shared/analyzePhotoCore.mjs.

import { analyzePhotoCore, AnalyzePhotoError } from './_shared/analyzePhotoCore.mjs'
import { enforceRateLimit, RateLimitError, clientIP } from './_shared/rateLimit.mjs'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // Rate limit global (respaldado por Supabase) en reemplazo del Map in-memory
  // que no escalaba entre instancias serverless. 20 req/min por IP.
  try {
    await enforceRateLimit({
      key: `analyze-photo:ip-${clientIP(req)}`,
      windowSeconds: 60,
      maxCount: 20,
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
    const events = await analyzePhotoCore({
      images: req.body?.images,
      apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
    })
    return res.status(200).json({ events })
  } catch (err) {
    if (err instanceof AnalyzePhotoError) {
      return res.status(err.status).json({ error: err.code, ...(err.detail ? { detail: err.detail } : {}) })
    }
    console.error('[analyze-photo] Error:', err)
    return res.status(500).json({ error: 'internal_error', message: err.message })
  }
}

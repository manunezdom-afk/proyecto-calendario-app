// Adapter Vercel — la lógica vive en api/_shared/analyzePhotoCore.mjs
// (misma base usada por /netlify/functions/analyze-photo.js para mantener
// ambas plataformas sincronizadas).

import { analyzePhotoCore, AnalyzePhotoError } from './_shared/analyzePhotoCore.mjs'

// Rate limit in-memory (20 req/min por IP). Nota: no es global entre
// instancias serverless — para producción real ver api/_shared/rateLimit.mjs
// o migrar a Redis/Upstash.
const _rl = new Map()
function rateLimited(ip) {
  const now = Date.now()
  const e = _rl.get(ip)
  if (!e || now > e.reset) { _rl.set(ip, { count: 1, reset: now + 60_000 }); return false }
  if (e.count >= 20) return true
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

/**
 * Vercel Serverless Function: tts
 *
 * Text-to-Speech usando OpenAI TTS (voz "nova" — la misma que ChatGPT).
 * Requiere OPENAI_API_KEY en variables de entorno del servidor.
 * (Antes se aceptaba un header x-openai-key desde el cliente — retirado por
 * seguridad: cualquiera podía inyectar una key arbitraria.)
 *
 * Si no hay key → 503, el cliente hace fallback a Web Speech API.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const apiKey = (process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim()
  if (!apiKey) return res.status(503).json({ error: 'no_key' })

  /** @type {{ text?: string, voice?: string }} */
  let body = {}
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  } catch {
    body = {}
  }

  const text = body.text
  const requestedVoice = (body.voice || 'nova')
  const voice = String(requestedVoice).toLowerCase()
  const ALLOWED = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])
  const selectedVoice = ALLOWED.has(voice) ? voice : 'nova'

  if (!text?.trim()) return res.status(400).json({ error: 'no_text' })

  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: selectedVoice,           // alloy | echo | fable | onyx | nova | shimmer
        input: text.slice(0, 1000),
        speed: 1.0,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[tts] OpenAI error:', response.status, err)
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
    console.error('[tts] error:', err)
    return res.status(500).json({ error: 'internal_error' })
  }
}

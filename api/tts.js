/**
 * Vercel Serverless Function: tts
 *
 * Text-to-Speech usando OpenAI TTS (voz "nova" — la misma que ChatGPT).
 * Requiere OPENAI_API_KEY en variables de entorno de Vercel,
 * o el header x-openai-key enviado desde el cliente.
 *
 * Si no hay key → 503, el cliente hace fallback a Web Speech API.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-openai-key')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const apiKey = process.env.OPENAI_API_KEY || req.headers['x-openai-key']
  if (!apiKey) return res.status(503).json({ error: 'no_key' })

  const { text, voice = 'nova' } = req.body || {}
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
        voice,                          // nova | alloy | shimmer | echo | fable | onyx
        input: text.slice(0, 1000),
        speed: 1.0,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[tts] OpenAI error:', response.status, err)
      return res.status(502).json({ error: 'tts_failed' })
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

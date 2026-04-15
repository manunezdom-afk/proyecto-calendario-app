/**
 * Vercel Serverless Function: analyze-photo
 *
 * Proxy CORS para llamar a Claude con visión.
 * La API key se acepta de dos fuentes (en orden de prioridad):
 *   1. Variable de entorno ANTHROPIC_API_KEY (configurada en Vercel)
 *   2. Header x-user-api-key enviado desde el cliente (clave guardada en el navegador)
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // Resolver API key: variable de entorno o header del cliente
  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    req.headers['x-user-api-key'] ||
    req.headers['X-User-Api-Key']

  if (!apiKey) {
    return res.status(503).json({ error: 'no_api_key' })
  }

  const body = req.body
  const { images } = body || {}

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'no_images' })
  }

  const imageBlocks = images.map(({ base64, mediaType }) => ({
    type: 'image',
    source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 },
  }))

  const today    = new Date()
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const textBlock = {
    type: 'text',
    text: `Eres un extractor de eventos de calendario. Analiza las imágenes y extrae TODOS los eventos, clases, citas o actividades que veas.

Hoy es ${todayISO}. Año actual: ${today.getFullYear()}.
Si ves nombres de días sin año, calcúlalos desde hoy.

Devuelve SOLO un array JSON con objetos que tengan exactamente estos campos:
- "title": nombre de la actividad (string)
- "date": YYYY-MM-DD (string o null)
- "time": HH:MM en 24h (string o null)
- "endTime": HH:MM en 24h si existe (string o null)

SIN markdown, SIN texto extra. Solo el array JSON.

Ejemplo: [{"title":"Gym","date":"${todayISO}","time":"09:00","endTime":"10:00"}]

Si no hay eventos claros: []`,
  }

  try {
    const anthropicRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: [...imageBlocks, textBlock] }],
      }),
    })

    if (!anthropicRes.ok) {
      const txt = await anthropicRes.text()
      if (anthropicRes.status === 401) {
        return res.status(401).json({ error: 'invalid_api_key' })
      }
      console.error('[analyze-photo] Anthropic error:', anthropicRes.status, txt)
      return res.status(502).json({ error: 'api_error', status: anthropicRes.status })
    }

    const data    = await anthropicRes.json()
    const rawText = (data.content?.[0]?.text ?? '').trim()

    let events = []
    try {
      events = JSON.parse(rawText)
    } catch {
      const m = rawText.match(/\[[\s\S]*\]/)
      if (m) try { events = JSON.parse(m[0]) } catch {}
    }

    events = (Array.isArray(events) ? events : [])
      .filter((e) => e && typeof e.title === 'string' && e.title.trim())

    return res.status(200).json({ events })

  } catch (err) {
    console.error('[analyze-photo] Error:', err)
    return res.status(500).json({ error: 'internal_error', message: err.message })
  }
}

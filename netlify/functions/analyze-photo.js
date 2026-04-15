/**
 * Netlify Function: analyze-photo
 *
 * Proxy CORS para llamar a Claude con visión.
 * La API key se acepta de dos fuentes (en orden de prioridad):
 *   1. Variable de entorno ANTHROPIC_API_KEY (configurada en Netlify)
 *   2. Header x-user-api-key enviado desde el cliente (clave guardada en el navegador)
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-user-api-key',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) }
  }

  // Resolver API key: variable de entorno o header del cliente
  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    event.headers?.['x-user-api-key'] ||
    event.headers?.['X-User-Api-Key']

  if (!apiKey) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: 'no_api_key' }),
    }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_json' }) }
  }

  const { images } = body
  if (!Array.isArray(images) || images.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'no_images' }) }
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
    const res = await fetch(ANTHROPIC_API, {
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

    if (!res.ok) {
      const txt = await res.text()
      // API key inválida → 401
      if (res.status === 401) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'invalid_api_key' }) }
      }
      console.error('[analyze-photo] Anthropic error:', res.status, txt)
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'api_error', status: res.status }) }
    }

    const data    = await res.json()
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

    return { statusCode: 200, headers, body: JSON.stringify({ events }) }

  } catch (err) {
    console.error('[analyze-photo] Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal_error', message: err.message }) }
  }
}

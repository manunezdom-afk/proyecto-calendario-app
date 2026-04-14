/**
 * Netlify Function: analyze-photo
 *
 * Recibe imágenes en base64, las manda a Claude con visión y devuelve
 * los eventos detectados como JSON.
 *
 * Requiere variable de entorno: ANTHROPIC_API_KEY
 * (Netlify → Site configuration → Environment variables)
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) }
  }

  // Verificar API key
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: 'no_api_key',
        message: 'Falta ANTHROPIC_API_KEY. Ve a Netlify → Site configuration → Environment variables y agrégala.',
      }),
    }
  }

  // Parsear body
  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_json' }) }
  }

  const { images } = body // [{ base64: string, mediaType: string }]
  if (!Array.isArray(images) || images.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'no_images' }) }
  }

  // Construir bloques de imagen para Claude
  const imageBlocks = images.map(({ base64, mediaType }) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType || 'image/jpeg',
      data: base64,
    },
  }))

  const today = new Date()
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const year = today.getFullYear()

  const textBlock = {
    type: 'text',
    text: `Eres un extractor de eventos de calendario. Analiza las imágenes y extrae TODOS los eventos, clases, citas o actividades que puedas ver.

Hoy es ${todayISO}. Si ves fechas sin año, usa ${year}.
Si ves nombres de días (Lunes, Martes…) sin año, calcúlalos a partir de hoy.

Para cada evento devuelve un objeto JSON con estos campos exactos:
- "title": nombre de la actividad, en el idioma de la imagen (string)
- "date": fecha en formato YYYY-MM-DD (string, o null si no se puede determinar)
- "time": hora de inicio en formato HH:MM 24h (string, o null si no hay hora)
- "endTime": hora de fin en HH:MM 24h si la hay (string, o null)

RESPONDE SOLO con el array JSON. Sin markdown, sin texto antes ni después, sin explicaciones.

Ejemplo de respuesta válida:
[{"title":"Gym","date":"${todayISO}","time":"09:00","endTime":"10:00"},{"title":"Dentista","date":"${todayISO}","time":"15:30","endTime":null}]

Si no identificas ningún evento devuelve exactamente: []`,
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
        messages: [
          {
            role: 'user',
            content: [...imageBlocks, textBlock],
          },
        ],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[analyze-photo] Anthropic error:', errText)
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'api_error', detail: errText }),
      }
    }

    const data = await res.json()
    const rawText = (data.content?.[0]?.text ?? '').trim()

    // Extraer JSON de la respuesta (a veces el modelo añade texto)
    let events = []
    try {
      events = JSON.parse(rawText)
    } catch {
      const match = rawText.match(/\[[\s\S]*\]/)
      if (match) {
        try { events = JSON.parse(match[0]) } catch {}
      }
    }

    // Sanidad: filtrar entradas sin título
    events = (Array.isArray(events) ? events : []).filter(
      (e) => e && typeof e.title === 'string' && e.title.trim()
    )

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ events }),
    }
  } catch (err) {
    console.error('[analyze-photo] Internal error:', err)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'internal_error' }),
    }
  }
}

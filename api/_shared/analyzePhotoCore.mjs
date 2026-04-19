// Lógica compartida entre /api/analyze-photo.js (Vercel) y
// /netlify/functions/analyze-photo.js (Netlify). Ambos handlers son
// adapters finos sobre este core para que el comportamiento y los prompts
// estén sincronizados siempre.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

export class AnalyzePhotoError extends Error {
  constructor(code, { status = 500, detail = undefined } = {}) {
    super(code)
    this.code = code
    this.status = status
    this.detail = detail
  }
}

export function buildPrompt({ todayISO, year }) {
  return `Eres un extractor de eventos de calendario. Analiza las imágenes y extrae TODOS los eventos, clases, citas o actividades que veas.

Hoy es ${todayISO}. Año actual: ${year}.
Si ves nombres de días sin año, calcúlalos desde hoy.

Devuelve SOLO un array JSON con objetos que tengan exactamente estos campos:
- "title": nombre de la actividad (string)
- "date": YYYY-MM-DD (string o null)
- "time": HH:MM en 24h (string o null)
- "endTime": HH:MM en 24h si existe (string o null)

SIN markdown, SIN texto extra. Solo el array JSON.

Ejemplo: [{"title":"Gym","date":"${todayISO}","time":"09:00","endTime":"10:00"}]

Si no hay eventos claros: []`
}

export async function analyzePhotoCore({ images, apiKey }) {
  if (!apiKey) throw new AnalyzePhotoError('no_api_key', { status: 503 })
  if (!Array.isArray(images) || images.length === 0) {
    throw new AnalyzePhotoError('no_images', { status: 400 })
  }

  const imageBlocks = images.map(({ base64, mediaType }) => ({
    type: 'image',
    source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 },
  }))

  const today = new Date()
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const textBlock = { type: 'text', text: buildPrompt({ todayISO, year: today.getFullYear() }) }

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
    if (res.status === 401) throw new AnalyzePhotoError('invalid_api_key', { status: 401 })
    let detail = txt
    try { detail = JSON.parse(txt)?.error?.message ?? txt } catch {}
    console.error('[analyze-photo] Anthropic error:', res.status, detail)
    throw new AnalyzePhotoError('api_error', { status: 502, detail })
  }

  const data = await res.json()
  const rawText = (data.content?.[0]?.text ?? '').trim()

  let events = []
  try {
    events = JSON.parse(rawText)
  } catch {
    const m = rawText.match(/\[[\s\S]*\]/)
    if (m) try { events = JSON.parse(m[0]) } catch {}
  }

  return (Array.isArray(events) ? events : [])
    .filter((e) => e && typeof e.title === 'string' && e.title.trim())
}

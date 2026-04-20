// ─── Rate limiting persistente (20 req/min por IP) ───────────────────────────
// Se almacena en public.api_rate_limit (Supabase) para sobrevivir a cold starts
// del serverless. Si Supabase no está disponible, fallback a memoria local.
import { getSupabaseAdmin } from './_supabaseAdmin.js'

const WINDOW_MS = 60_000
const MAX_REQ = 20
const _rlMem = new Map()

function memLimited(ip) {
  const now = Date.now()
  const e = _rlMem.get(ip)
  if (!e || now > e.reset) { _rlMem.set(ip, { count: 1, reset: now + WINDOW_MS }); return false }
  if (e.count >= MAX_REQ) return true
  e.count++
  return false
}

async function rateLimited(ip) {
  const admin = getSupabaseAdmin()
  if (!admin) return memLimited(ip)
  const bucketKey = `analyze-photo:${ip}`
  const windowStart = new Date(Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS).toISOString()
  try {
    const { data, error } = await admin
      .from('api_rate_limit')
      .select('count')
      .eq('bucket_key', bucketKey)
      .eq('window_start', windowStart)
      .maybeSingle()
    if (error) return memLimited(ip)
    if (data && data.count >= MAX_REQ) return true
    if (data) {
      await admin.from('api_rate_limit')
        .update({ count: data.count + 1 })
        .eq('bucket_key', bucketKey)
        .eq('window_start', windowStart)
    } else {
      await admin.from('api_rate_limit').insert({ bucket_key: bucketKey, window_start: windowStart, count: 1 })
    }
    return false
  } catch {
    return memLimited(ip)
  }
}

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (await rateLimited(ip)) {
    return res.status(429).json({ error: 'rate_limit', message: 'Demasiadas solicitudes. Espera un momento.' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
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
      let detail = txt
      try { detail = JSON.parse(txt)?.error?.message ?? txt } catch {}
      return res.status(502).json({ error: 'api_error', status: anthropicRes.status, detail })
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

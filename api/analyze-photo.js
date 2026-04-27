import { rateLimited, clientIp } from './_lib/rateLimit.js'
import { rejectCrossSiteUnsafe, setCorsHeaders } from './_lib/security.js'
import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'
import { enforceAiQuota } from './_lib/aiUsage.js'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MAX_IMAGES = 4
const MAX_BASE64_CHARS = 6_000_000
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

// Vision con varias imágenes puede tardar; el default de 10s en Vercel
// cortaba antes de tiempo dejando al cliente sin respuesta.
export const maxDuration = 60

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS' })

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  if (rejectCrossSiteUnsafe(req, res)) return

  if (rateLimited(clientIp(req), { max: 12, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limit', message: 'Demasiadas solicitudes. Espera un momento.' })
  }

  // Auth obligatoria — sin esto, cualquiera con la URL puede mandar fotos
  // arbitrarias a Anthropic vision (~$0.30/M tokens, fácil de explotar).
  const userId = await getUserIdFromAuth(req)
  if (!userId) {
    return res.status(401).json({ error: 'auth_required', message: 'Inicia sesión para analizar fotos.' })
  }

  // Cuota diaria por usuario (migración 010). Vision es más cara que texto;
  // límite más conservador en _lib/aiUsage.js.
  const admin = getSupabaseAdmin()
  const quota = await enforceAiQuota(admin, userId, 'analyze-photo')
  if (!quota.ok) {
    return res.status(429).json({
      error: 'quota_exceeded',
      message: 'Llegaste al límite diario de fotos analizadas. Vuelve mañana.',
      reset_at: quota.resetAt,
      limit: quota.limit,
    })
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
  if (images.length > MAX_IMAGES) {
    return res.status(400).json({ error: 'too_many_images', message: `Máximo ${MAX_IMAGES} imágenes por análisis.` })
  }

  const imageBlocks = []
  for (const image of images) {
    const mediaType = String(image?.mediaType || 'image/jpeg').toLowerCase()
    const base64 = typeof image?.base64 === 'string' ? image.base64 : ''
    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return res.status(400).json({ error: 'unsupported_image_type' })
    }
    if (!base64 || base64.length > MAX_BASE64_CHARS) {
      return res.status(400).json({ error: 'image_too_large' })
    }
    imageBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    })
  }

  const today    = new Date()
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  // Construir mapping "lunes→ISO" relativo a ESTA semana (lunes-domingo) para que
  // el modelo coloque cada clase en el día real, no en hoy.
  const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const dow = today.getDay() // 0=domingo
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
  const weekMap = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const name = DAY_NAMES_ES[d.getDay()]
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    weekMap[name] = iso
  }
  const weekMapStr = Object.entries(weekMap).map(([k, v]) => `  ${k} → ${v}`).join('\n')
  const todayName = DAY_NAMES_ES[today.getDay()]

  const textBlock = {
    type: 'text',
    text: `Eres un extractor de eventos de calendario. Analiza las imágenes y extrae TODOS los eventos, clases, citas o actividades que veas.

Hoy es ${todayISO} (${todayName}). Año actual: ${today.getFullYear()}.

MAPEO DE DÍAS DE ESTA SEMANA (úsalo SIEMPRE para convertir nombres de día a fecha):
${weekMapStr}

REGLAS CRÍTICAS DE FECHA:
- Si un evento dice "Lunes", usa ${weekMap.lunes}. Si dice "Martes", usa ${weekMap.martes}. Etc.
- Si un horario de clases muestra una CLASE en varios días (ej: "Cultura e Ideas — Lunes y Miércoles 10:30"), genera DOS eventos separados: uno con date=${weekMap.lunes} y otro con date=${weekMap.miércoles}, ambos con el mismo title.
- Si ves "Lunes a Viernes" o "L-V" o "Lun-Vie", expande a 5 eventos (lunes, martes, miércoles, jueves, viernes) con el mismo horario y título.
- NUNCA uses ${todayISO} para TODOS los eventos solo porque hoy es ${todayName}. Usa la fecha real de cada clase según su día de la semana.
- Si el día no está indicado y no puedes inferirlo, usa null.

Devuelve SOLO un array JSON con objetos que tengan exactamente estos campos:
- "title": nombre de la actividad (string)
- "date": YYYY-MM-DD (string o null)
- "time": HH:MM en 24h (string o null)
- "endTime": HH:MM en 24h si existe (string o null)

SIN markdown, SIN texto extra. Solo el array JSON.

Ejemplo de input: "Cultura e Ideas — Lunes y Miércoles 10:30-12:20"
Ejemplo de output: [
  {"title":"Cultura e Ideas","date":"${weekMap.lunes}","time":"10:30","endTime":"12:20"},
  {"title":"Cultura e Ideas","date":"${weekMap.miércoles}","time":"10:30","endTime":"12:20"}
]

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
      if (anthropicRes.status === 401) {
        return res.status(401).json({ error: 'invalid_api_key' })
      }
      // Loggeamos solo el status y un trozo corto del error para diagnóstico,
      // sin volcar la respuesta completa de Anthropic (puede contener detalles
      // del prompt o mensajes con el contenido enviado por el usuario).
      let detail = ''
      try {
        const txt = await anthropicRes.text()
        detail = (() => { try { return JSON.parse(txt)?.error?.message } catch { return null } })() || txt.slice(0, 200)
      } catch {}
      console.error('[analyze-photo] upstream', anthropicRes.status)
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
    // Sin volcar err.message completo: a veces incluye URLs/headers
    // serializados que ensucian logs sin aportar diagnóstico.
    console.error('[analyze-photo]', err?.name || 'Error')
    return res.status(500).json({ error: 'internal_error' })
  }
}

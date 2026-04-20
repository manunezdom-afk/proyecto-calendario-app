// ─── Rate limiting en memoria (20 req/min por IP) ────────────────────────────
const _rl = new Map()
function rateLimited(ip) {
  const now = Date.now()
  const e = _rl.get(ip)
  if (!e || now > e.reset) { _rl.set(ip, { count: 1, reset: now + 60_000 }); return false }
  if (e.count >= 20) return true
  e.count++
  return false
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
  if (rateLimited(ip)) {
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

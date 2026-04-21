import Anthropic from '@anthropic-ai/sdk'
import { rateLimited, clientIp } from './_lib/rateLimit.js'
import { buildWeatherContext } from './_lib/weather.js'
import { buildDateContext } from './_lib/dateContext.js'
import { buildSystemPrompt } from './_lib/systemPrompt.js'
import { safeParseAssistantJSON } from './_lib/neutralize.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (rateLimited(clientIp(req))) {
    return res.status(429).json({ error: 'rate_limit', message: 'Demasiadas solicitudes. Espera un momento.' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return res.status(503).json({ error: 'no_api_key' })

  const body = req.body || {}
  const { message, location = null, contacts = [], profile = null, behavior = null } = body

  if (!message?.trim()) return res.status(400).json({ error: 'no_message' })
  if (message.length > 4000) {
    return res.status(400).json({ error: 'message_too_long', message: 'Mensaje demasiado largo (máx 4000 caracteres).' })
  }

  const events = (Array.isArray(body.events) ? body.events : [])
    .filter(e => e && typeof e === 'object' && typeof e.title === 'string' && e.title.trim())
    .slice(0, 200)
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(h => h && typeof h === 'object' && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .slice(-20)
  const memories = (Array.isArray(body.memories) ? body.memories : [])
    .filter(m => m && typeof m === 'object' && typeof m.content === 'string')
    .slice(0, 100)
  const tasks = (Array.isArray(body.tasks) ? body.tasks : [])
    .filter(t => t && typeof t === 'object' && typeof t.label === 'string' && t.label.trim())
    .slice(0, 200)

  const dateContext = buildDateContext(body.clientNow, body.clientTimezone)
  const weatherContext = await buildWeatherContext(location)

  const systemPrompt = buildSystemPrompt({
    dateContext, weatherContext, contacts, profile, behavior, memories, events, tasks,
  })

  const anthropic = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 })
  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ]

  async function runClaude(extra = '') {
    const extraMsgs = extra ? [{ role: 'user', content: extra }] : []
    return anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [...messages, ...extraMsgs],
    })
  }

  try {
    const d1 = await runClaude()
    const r1 = (d1.content?.[0]?.text ?? '').trim()
    try {
      return res.status(200).json(safeParseAssistantJSON(r1))
    } catch (e1) {
      const d2 = await runClaude(
        'Tu respuesta anterior tuvo JSON inválido o incompleto. Reintenta ahora. Responde SOLO con un objeto JSON válido siguiendo exactamente el formato indicado. Cierra todas las llaves y corchetes.'
      )
      const r2 = (d2.content?.[0]?.text ?? '').trim()
      try {
        return res.status(200).json(safeParseAssistantJSON(r2))
      } catch (e2) {
        console.error('[focus-assistant] JSON parse failed after retry:', {
          e1: String(e1), e2: String(e2), raw1: r1.slice(0, 500), raw2: r2.slice(0, 500),
        })
        return res.status(502).json({
          error: 'llm_bad_output',
          reply: 'Tuve un problema procesando la respuesta. Repite el mensaje por favor.',
          actions: [],
        })
      }
    }
  } catch (err) {
    const status = err?.status || err?.response?.status
    if (status === 401) {
      console.error('[focus-assistant] Invalid ANTHROPIC_API_KEY')
      return res.status(503).json({ error: 'invalid_api_key', message: 'Servicio temporalmente no disponible.' })
    }
    if (status === 429) {
      console.error('[focus-assistant] Upstream rate limit')
      return res.status(429).json({ error: 'upstream_rate_limit', message: 'Demasiadas solicitudes. Prueba en unos segundos.' })
    }
    if (status === 529 || status === 503) {
      console.error('[focus-assistant] Upstream overloaded')
      return res.status(503).json({ error: 'upstream_overloaded', message: 'El servicio está sobrecargado. Intenta de nuevo.' })
    }
    if (err?.name === 'AbortError' || /timeout/i.test(err?.message || '')) {
      console.error('[focus-assistant] Timeout:', err)
      return res.status(504).json({ error: 'timeout', message: 'La respuesta tardó demasiado. Intenta otra vez.' })
    }
    console.error('[focus-assistant] Unexpected error:', err)
    return res.status(500).json({ error: 'internal_error', message: 'Error interno. Reintenta en un momento.' })
  }
}

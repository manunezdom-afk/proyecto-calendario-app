import Anthropic from '@anthropic-ai/sdk'
import { rateLimited, clientIp } from './_lib/rateLimit.js'
import { buildWeatherContext } from './_lib/weather.js'
import { buildDateContext } from './_lib/dateContext.js'
import { buildSystemPrompt } from './_lib/systemPrompt.js'
import { safeParseAssistantJSON } from './_lib/neutralize.js'
import { normalizeNovaPersonality } from './_lib/personality.js'
import { rejectCrossSiteUnsafe, setCorsHeaders } from './_lib/security.js'
import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'
import { enforceAiQuota } from './_lib/aiUsage.js'

// Necesario en Pro plan: por defecto Vercel mata la función a los 10s, lo
// cual era menor que el timeout de 25s del SDK de Anthropic — el handler
// moría sin responder y el cliente quedaba en "Focus está pensando…".
// En Hobby Vercel ignora valores >10s y mantiene 10s. En Pro respeta 60s.
export const maxDuration = 60

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS' })

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (rejectCrossSiteUnsafe(req, res)) return

  // Cinturón de seguridad #1: rate limit IP (defensa contra burst). El user
  // limit más fino llega después, una vez identificado el usuario.
  if (rateLimited(clientIp(req), { max: 30, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limit', message: 'Demasiadas solicitudes. Espera un momento.' })
  }

  // Cinturón de seguridad #2: autenticación obligatoria. Sin esto, cualquiera
  // con la URL puede vaciar el presupuesto de Anthropic. El cliente inyecta
  // Bearer token automáticamente vía src/lib/apiClient.js si hay sesión.
  const userId = await getUserIdFromAuth(req)
  if (!userId) {
    return res.status(401).json({ error: 'auth_required', message: 'Inicia sesión para usar Nova.' })
  }

  // Cinturón de seguridad #3: cuota diaria por usuario. Si la migración 010 no
  // se aplicó, enforceAiQuota devuelve soft:true y dejamos pasar (logueado).
  const admin = getSupabaseAdmin()
  const quota = await enforceAiQuota(admin, userId, 'focus-assistant')
  if (!quota.ok) {
    return res.status(429).json({
      error: 'quota_exceeded',
      message: 'Llegaste al límite diario de mensajes con Nova. Vuelve mañana.',
      reset_at: quota.resetAt,
      limit: quota.limit,
    })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return res.status(503).json({ error: 'no_api_key' })

  const body = req.body || {}
  const { message, location = null, contacts = [], profile = null, behavior = null } = body

  // novaPersonality entra por el body — si el cliente es viejo o manda un
  // valor inválido, normalize() cae al default 'focus' sin romper la request.
  const novaPersonality = normalizeNovaPersonality(body.novaPersonality)

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
    novaPersonality,
  })

  // Timeout del SDK 45s para aprovechar maxDuration=60s sin agotarlo. Antes
  // estaba en 25s pero competía con el corte default de Vercel a los 10s,
  // lo que dejaba al cliente colgado en "Focus está pensando…" sin error.
  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 })
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
    } catch {
      const d2 = await runClaude(
        'Tu respuesta anterior tuvo JSON inválido o incompleto. Reintenta ahora. Responde SOLO con un objeto JSON válido siguiendo exactamente el formato indicado. Cierra todas las llaves y corchetes.'
      )
      const r2 = (d2.content?.[0]?.text ?? '').trim()
      try {
        return res.status(200).json(safeParseAssistantJSON(r2))
      } catch {
        // Sin loggear el contenido crudo: incluye datos del usuario
        // (eventos, tareas, memorias) y filtra a Vercel logs. La métrica útil
        // (tasa de fallo) la podemos derivar del status code 502.
        console.error('[focus-assistant] JSON parse failed after retry')
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
      console.error('[focus-assistant] upstream auth failure')
      return res.status(503).json({ error: 'invalid_api_key', message: 'Servicio temporalmente no disponible.' })
    }
    if (status === 429) {
      console.error('[focus-assistant] upstream rate limit')
      return res.status(429).json({ error: 'upstream_rate_limit', message: 'Demasiadas solicitudes. Prueba en unos segundos.' })
    }
    if (status === 529 || status === 503) {
      console.error('[focus-assistant] upstream overloaded')
      return res.status(503).json({ error: 'upstream_overloaded', message: 'El servicio está sobrecargado. Intenta de nuevo.' })
    }
    if (err?.name === 'AbortError' || /timeout/i.test(err?.message || '')) {
      console.error('[focus-assistant] timeout')
      return res.status(504).json({ error: 'timeout', message: 'La respuesta tardó demasiado. Intenta otra vez.' })
    }
    // Loggeamos el tipo de error sin el stack completo: evita filtrar datos
    // serializados en el message del SDK.
    console.error('[focus-assistant] unexpected:', err?.name || 'Error', status || '')
    return res.status(500).json({ error: 'internal_error', message: 'Error interno. Reintenta en un momento.' })
  }
}

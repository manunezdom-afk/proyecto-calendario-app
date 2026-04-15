import Anthropic from '@anthropic-ai/sdk';

/**
 * Vercel Serverless Function: focus-assistant
 *
 * Focus como secretario IA — entiende lenguaje natural en español
 * y puede agregar, editar, mover o eliminar eventos del calendario.
 *
 * API key: variable de entorno ANTHROPIC_API_KEY o header x-user-api-key
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-api-key')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    req.headers['x-user-api-key'] ||
    req.headers['X-User-Api-Key']
  const normalizedApiKey = apiKey?.trim()

  if (!normalizedApiKey) {
    return res.status(503).json({ error: 'no_api_key' })
  }

  const anthropic = new Anthropic({ apiKey: normalizedApiKey })

  const { message, events = [], history = [] } = req.body || {}

  if (!message?.trim()) {
    return res.status(400).json({ error: 'no_message' })
  }

  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10)
  const dayAfter  = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10)

  const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const todayStr = today.toLocaleDateString('es-ES', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const weekDates = {}
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today.getTime() + i * 86400000)
    weekDates[DAY_NAMES[d.getDay()]] = d.toISOString().slice(0, 10)
  }

  const systemPrompt = `Eres Focus, el asistente personal de calendario del usuario. Eres como un secretario inteligente y amigable que gestiona su agenda completamente. Hablas en español, eres conciso y natural.

Puedes:
- Agregar eventos nuevos
- Mover o editar eventos existentes (cambiar hora, fecha, título)
- Eliminar eventos
- Responder preguntas sobre la agenda
- Conversar naturalmente

REGLA ABSOLUTA: Responde SOLO con un objeto JSON válido. Sin markdown, sin bloques de código, sin texto fuera del JSON.

Formato de respuesta:
{
  "reply": "Texto conversacional y amigable para mostrarle al usuario",
  "actions": []
}

Acciones disponibles:

Agregar evento:
{ "type": "add_event", "event": { "title": string, "time": string, "date": string|null, "section": "focus"|"evening", "icon": string } }

Editar/mover evento:
{ "type": "edit_event", "id": "id-del-evento", "updates": { campos } }

Eliminar evento:
{ "type": "delete_event", "id": "id-del-evento" }

Reglas de formato:
- time: "9:00 AM", "3:30 PM", etc. — vacío si no hay hora
- date: YYYY-MM-DD — null significa hoy (${todayISO})
- section: "evening" si hora ≥ 14:00, sino "focus"
- icon: fitness_center | groups | restaurant | menu_book | work | local_hospital | shopping_cart | cake | flight | account_balance | alarm | event

Fechas relativas (HOY ES ${todayStr}):
- "hoy" = ${todayISO}
- "mañana" = ${tomorrow}
- "pasado mañana" = ${dayAfter}
- días de la semana: ${JSON.stringify(weekDates)}

Eventos actuales en el calendario del usuario:
${
  events.length > 0
    ? JSON.stringify(
        events.map((e) => ({
          id: e.id,
          title: e.title,
          time: e.time || '',
          date: e.date || null,
          section: e.section,
        })),
        null,
        2,
      )
    : 'Sin eventos aún.'
}

Instrucciones adicionales:
- Si el usuario pide mover un evento, usa edit_event con el id correcto
- Si el usuario habla de eliminar todos los eventos, elimínalos uno por uno con múltiples acciones delete_event
- Si el usuario pregunta algo no relacionado con el calendario, responde brevemente y ofrece ayuda con la agenda
- No pidas confirmación: ejecuta las acciones directamente
- Si no hay suficiente información (ej. no se menciona hora), agrega el evento sin hora y menciona que lo puede editar después
- Responde siempre en español, de forma natural y cálida`

  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ]

  try {
    const data = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    })
    const rawText = (data.content?.[0]?.text ?? '').trim()

    let parsed = { reply: rawText, actions: [] }
    try {
      const m = rawText.match(/\{[\s\S]*\}/)
      if (m) {
        const candidate = JSON.parse(m[0])
        if (candidate.reply) parsed = candidate
      }
      if (!Array.isArray(parsed.actions)) parsed.actions = []
    } catch {
      parsed = { reply: rawText, actions: [] }
    }

    return res.status(200).json(parsed)
  } catch (err) {
    if (err?.status === 401) {
      return res.status(401).json({ error: 'invalid_api_key' })
    }
    console.error('[focus-assistant] Error:', err)
    return res.status(500).json({ error: 'internal_error', message: err.message })
  }
}

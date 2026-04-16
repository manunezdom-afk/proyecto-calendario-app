import Anthropic from '@anthropic-ai/sdk';

/**
 * Vercel Serverless Function: focus-assistant
 *
 * Focus como secretario IA — entiende lenguaje natural en español
 * y puede agregar, editar, mover o eliminar eventos del calendario.
 * Tiene acceso a ubicación, clima en tiempo real y contactos del usuario.
 *
 * API key: variable de entorno ANTHROPIC_API_KEY o header x-user-api-key
 */

function describeWeatherCode(code) {
  if (code === 0) return 'Despejado'
  if (code <= 3) return 'Parcialmente nublado'
  if (code <= 48) return 'Niebla'
  if (code <= 55) return 'Llovizna'
  if (code <= 65) return 'Lluvia'
  if (code <= 75) return 'Nieve'
  if (code === 77) return 'Granizo'
  if (code <= 82) return 'Chubascos'
  if (code <= 86) return 'Nieve'
  if (code <= 99) return 'Tormenta eléctrica'
  return 'Desconocido'
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=3`
  const res = await fetch(url)
  if (!res.ok) throw new Error('weather fetch failed')
  return res.json()
}

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

  const { message, events = [], history = [], location = null, contacts = [] } = req.body || {}

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

  // Clima en tiempo real
  let weatherContext = 'Ubicación no disponible — no puedes dar información del clima.'
  if (location?.lat && location?.lon) {
    try {
      const wData = await fetchWeather(location.lat, location.lon)
      const cur = wData.current
      const daily = wData.daily
      const cityLabel = location.city ? `${location.city}${location.country ? ', ' + location.country : ''}` : `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`

      const forecast = daily.time.map((date, i) => {
        const label = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : date
        return `  ${label}: ${describeWeatherCode(daily.weather_code[i])}, ${daily.temperature_2m_min[i]}°C–${daily.temperature_2m_max[i]}°C, lluvia ${daily.precipitation_probability_max[i]}%`
      }).join('\n')

      weatherContext = `Ubicación del usuario: ${cityLabel}
Clima actual: ${describeWeatherCode(cur.weather_code)}, ${cur.temperature_2m}°C, humedad ${cur.relative_humidity_2m}%, viento ${cur.wind_speed_10m} km/h
Pronóstico próximos 3 días:
${forecast}`
    } catch {
      weatherContext = location.city
        ? `Ubicación: ${location.city}${location.country ? ', ' + location.country : ''}. Clima no disponible en este momento.`
        : 'Clima no disponible en este momento.'
    }
  }

  // Contactos del usuario
  const contactsContext = contacts.length > 0
    ? `Contactos del usuario:\n${contacts.map(c => `- ${c.name ?? 'Sin nombre'}${c.tel ? ': ' + c.tel : ''}${c.email ? ' / ' + c.email : ''}`).join('\n')}`
    : 'El usuario no ha compartido contactos.'

  const systemPrompt = `Eres Focus, el asistente personal de calendario del usuario. Hablas en español chileno, eres conciso y directo.

Tienes acceso completo a:
- La agenda y eventos del usuario
- Su ubicación y clima en tiempo real
- Sus contactos
- La fecha y hora actual

Puedes:
- Agregar eventos nuevos
- Mover o editar eventos existentes (cambiar hora, fecha, título)
- Eliminar eventos
- Responder preguntas sobre la agenda
- Informar sobre el clima actual y pronóstico
- Usar los contactos del usuario para personalizar eventos
- Conversar naturalmente sobre cualquier tema

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

${weatherContext}

${contactsContext}

Instrucciones adicionales:
- Si el usuario pide mover un evento, usa edit_event con el id correcto
- Si el usuario habla de eliminar todos los eventos, elimínalos uno por uno con múltiples acciones delete_event
- Si el usuario pregunta por el clima, responde con los datos reales que tienes en el contexto
- Si el usuario pregunta algo no relacionado con el calendario ni el clima, responde brevemente con lo que sabes y ofrece ayuda con la agenda
- No pidas confirmación: ejecuta las acciones directamente
- Si no hay suficiente información (ej. no se menciona hora), agrega el evento sin hora y menciona que lo puede editar después
- IMPORTANTE — esta es una interfaz de VOZ. Responde siempre en español chileno, máximo 2 oraciones cortas y directas. Sin negritas, sin asteriscos, sin guiones, sin listas, sin ningún símbolo ni formato. Solo texto plano que suene natural al hablar.`

  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ]

  try {
    const data = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
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

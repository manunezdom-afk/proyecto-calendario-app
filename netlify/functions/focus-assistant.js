/**
 * Netlify Function: focus-assistant
 *
 * Focus como secretario IA — entiende lenguaje natural en español
 * y puede agregar, editar, mover o eliminar eventos del calendario.
 * Tiene acceso a ubicación, clima en tiempo real y contactos del usuario.
 *
 * API key: variable de entorno ANTHROPIC_API_KEY o header x-user-api-key
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

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

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-user-api-key',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) }
  }

  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    event.headers?.['x-user-api-key'] ||
    event.headers?.['X-User-Api-Key']

  if (!apiKey) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'no_api_key' }) }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_json' }) }
  }

  const { message, events = [], history = [], location = null, contacts = [] } = body
  if (!message?.trim()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'no_message' }) }
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
      const cityLabel = location.city
        ? `${location.city}${location.country ? ', ' + location.country : ''}`
        : `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`

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

  const systemPrompt = `Eres Focus, un Asistente Ejecutivo de Productividad y Calendario. Hablas en español neutro, con tono formal, profesional y eficiente.

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
- Responder preguntas generales de forma breve y útil

REGLA ABSOLUTA: Responde SOLO con un objeto JSON válido. Sin markdown, sin bloques de código, sin texto fuera del JSON.
FORMATO ESTRICTO (CRÍTICO):
- Tu respuesta DEBE ser un único objeto JSON.
- Debes cerrar siempre todas las llaves } y corchetes ].
- No incluyas comas finales.
- No incluyas texto antes/después del JSON.
- Si el contenido excede el límite, acorta el texto de "reply" (nunca rompas el JSON).

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
- Si el usuario pregunta algo no relacionado con el calendario ni el clima, responde brevemente y ofrece ayuda con organización y agenda
- Sincronización con "Mi Día": si la solicitud implica crear/editar/mover/eliminar eventos, SIEMPRE incluye las acciones necesarias para reflejar el cambio inmediatamente en el calendario. No respondas solo con texto.
- Cuando agregues o muevas un evento, el reply debe confirmar dos cosas: (1) que quedó agregado/actualizado en el calendario y (2) que ya es visible en "Mi Día" para la fecha correspondiente.
- No pidas confirmación salvo que falten datos críticos (por ejemplo: fecha imposible o evento ambiguo entre dos ids). Si faltan detalles no críticos (por ejemplo: hora), crea el evento sin hora y menciónalo en el reply.
- Si no hay suficiente información (ej. no se menciona hora), agrega el evento sin hora y menciona que lo puede editar después
- Responde siempre en español neutro, con trato impecable (perfil estudiante‑ejecutivo de la Universidad de los Andes). Máximo 2 oraciones claras y directas. No uses modismos chilenos ni jerga informal. Sin símbolos ni formato.`

  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ]

  function safeParseAssistantJSON(rawText) {
    const txt = String(rawText || '').trim()
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('no_json_object_found')
    const candidate = JSON.parse(m[0])
    if (!candidate || typeof candidate !== 'object') throw new Error('invalid_json_shape')
    if (typeof candidate.reply !== 'string') throw new Error('missing_reply')
    if (!Array.isArray(candidate.actions)) candidate.actions = []
    return candidate
  }

  async function runClaude(extraUserInstruction = '') {
    const merged = extraUserInstruction
      ? [...messages, { role: 'user', content: extraUserInstruction }]
      : messages
    return fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        system: systemPrompt,
        messages: merged,
      }),
    })
  }

  try {
    const res = await runClaude()

    if (!res.ok) {
      const txt = await res.text()
      if (res.status === 401) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'invalid_api_key' }) }
      }
      console.error('[focus-assistant] Anthropic error:', res.status, txt)
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'api_error', status: res.status }) }
    }

    const data1 = await res.json()
    const raw1 = (data1.content?.[0]?.text ?? '').trim()
    try {
      const parsed1 = safeParseAssistantJSON(raw1)
      return { statusCode: 200, headers, body: JSON.stringify(parsed1) }
    } catch (e1) {
      const res2 = await runClaude(
        'Tu respuesta anterior tuvo JSON inválido o incompleto. Reintenta ahora. Responde SOLO con un objeto JSON válido siguiendo exactamente el formato indicado. Cierra todas las llaves y corchetes.',
      )
      if (!res2.ok) {
        return { statusCode: 200, headers, body: JSON.stringify({ reply: 'No pude generar una respuesta estructurada en este momento. Por favor, repite tu solicitud.', actions: [] }) }
      }
      const data2 = await res2.json()
      const raw2 = (data2.content?.[0]?.text ?? '').trim()
      try {
        const parsed2 = safeParseAssistantJSON(raw2)
        return { statusCode: 200, headers, body: JSON.stringify(parsed2) }
      } catch (e2) {
        console.error('[focus-assistant] JSON parse failed after retry:', { e1: String(e1), e2: String(e2), raw1, raw2 })
        return { statusCode: 200, headers, body: JSON.stringify({ reply: 'No pude generar una respuesta estructurada en este momento. Por favor, repite tu solicitud.', actions: [] }) }
      }
    }
  } catch (err) {
    console.error('[focus-assistant] Error:', err)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'internal_error', message: err.message }),
    }
  }
}

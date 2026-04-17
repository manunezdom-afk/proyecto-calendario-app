/**
 * Netlify Function: focus-assistant
 * Nova — asistente ejecutivo de productividad con tool calling nativo.
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

// ─── Herramientas Anthropic ──────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'create_block',
    description: 'Crea un nuevo evento o bloque en el calendario del usuario.',
    input_schema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Título del evento.' },
        time:        { type: 'string', description: 'Hora en formato "9:00 AM" o "3:30 PM". Vacío si no hay hora.' },
        date:        { type: ['string', 'null'], description: 'Fecha YYYY-MM-DD. null = hoy.' },
        section:     { type: 'string', enum: ['focus', 'evening'], description: '"evening" si hora ≥ 14:00.' },
        icon:        { type: 'string', description: 'fitness_center | groups | restaurant | menu_book | work | local_hospital | shopping_cart | cake | flight | account_balance | alarm | event' },
        description: { type: 'string', description: 'Descripción opcional.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'move_block',
    description: 'Mueve o edita un evento existente (hora, fecha, título, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        id:      { type: 'string', description: 'ID del evento a modificar.' },
        updates: { type: 'object', description: 'Campos a actualizar: title, time, date, section, icon, description.' },
      },
      required: ['id', 'updates'],
    },
  },
  {
    name: 'delete_block',
    description: 'Elimina un evento del calendario.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID del evento a eliminar.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mark_task_done',
    description: 'Marca una tarea de la lista de tareas como completada.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID de la tarea a completar.' },
      },
      required: ['id'],
    },
  },
]

function toolCallToAction(name, input) {
  switch (name) {
    case 'create_block':
      return { type: 'add_event', event: input }
    case 'move_block':
      return { type: 'edit_event', id: input.id, updates: input.updates }
    case 'delete_block':
      return { type: 'delete_event', id: input.id }
    case 'mark_task_done':
      return { type: 'mark_task_done', id: input.id }
    default:
      return null
  }
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

  const {
    message,
    events   = [],
    tasks    = [],
    history  = [],
    location = null,
    contacts = [],
    profile  = null,
  } = body

  if (!message?.trim()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'no_message' }) }
  }

  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10)
  const dayAfter  = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10)

  const hh = String(today.getHours()).padStart(2, '0')
  const mm = String(today.getMinutes()).padStart(2, '0')
  const currentTime24 = `${hh}:${mm}`
  const currentTime12 = today.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true })

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
        ? `Ubicación: ${location.city}${location.country ? ', ' + location.country : ''}. Clima no disponible.`
        : 'Clima no disponible en este momento.'
    }
  }

  // Contactos
  const contactsContext = contacts.length > 0
    ? `Contactos del usuario:\n${contacts.map(c => `- ${c.name ?? 'Sin nombre'}${c.tel ? ': ' + c.tel : ''}${c.email ? ' / ' + c.email : ''}`).join('\n')}`
    : 'El usuario no ha compartido contactos.'

  // Perfil cronobiológico
  function fmtHour(dec) {
    if (dec == null) return ''
    const h = Math.floor(dec), m = Math.round((dec - h) * 60)
    return m > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${h}:00`
  }
  const chronoLabels = { morning: 'matutino', afternoon: 'vespertino', night: 'nocturno' }
  const roleLabels   = { student: 'estudiante', worker: 'trabajador', freelance: 'freelancer', other: 'otro' }
  const profileContext = profile
    ? `Perfil de productividad:
- Cronotipo: ${chronoLabels[profile.chronotype] ?? profile.chronotype ?? 'no definido'} (${roleLabels[profile.role] ?? profile.role ?? 'rol no definido'})
- Zona de rendimiento (máxima energía): ${fmtHour(profile.peakStart)}–${fmtHour(profile.peakEnd)}
- Para trabajo profundo/estudio/foco: siempre propone horario dentro de ${fmtHour(profile.peakStart)}–${fmtHour(profile.peakEnd)} si está libre.`
    : ''

  // Tareas
  const tasksContext = tasks.length > 0
    ? `Tareas del usuario:\n${tasks.map(t => `- [${t.done ? 'x' : ' '}] id:${t.id} "${t.label}" (${t.priority}, ${t.category})`).join('\n')}`
    : 'Sin tareas registradas.'

  const systemPrompt = `Eres Nova, la asistente ejecutiva de productividad. Hablas en español neutro, tono formal y eficiente.

Tienes acceso a:
- Agenda y eventos del usuario
- Lista de tareas (MIT method)
- Ubicación y clima en tiempo real
- Contactos del usuario
- Fecha y hora actual
- Perfil cronobiológico y zona de rendimiento

Puedes usar las herramientas disponibles para:
- Crear nuevos bloques/eventos en el calendario (create_block)
- Mover o editar eventos existentes (move_block)
- Eliminar eventos (delete_block)
- Marcar tareas como completadas (mark_task_done)

Usa las herramientas cuando el usuario pida acciones concretas. Responde en texto conversacional; las acciones se ejecutan automáticamente via herramientas.

Reglas de formato para create_block:
- time: "9:00 AM", "3:30 PM" — vacío si sin hora
- date: YYYY-MM-DD — null = hoy (${todayISO})
- section: "evening" si hora ≥ 14:00, sino "focus"
- icon: fitness_center | groups | restaurant | menu_book | work | local_hospital | shopping_cart | cake | flight | account_balance | alarm | event

Recordatorios previos a un evento: si el usuario pide aviso X minutos antes, crea un bloque nuevo con:
- title: "Recordatorio: [título del evento]"
- time: hora del evento MENOS los minutos solicitados
- icon: "alarm"
NO modifiques el evento original.

Hora ambigua: si el usuario dice "a las 9" sin AM/PM y las 9:00 AM ya pasó (son las ${currentTime24}), interpreta como 9:00 PM. En contextos nocturnos (cena, deporte, cine), prioriza siempre la tarde/noche.

Evento actual (±30 min): "el de ahora", "el actual" → busca el evento cuya hora esté dentro de ±30 min de ${currentTime24}.

Fecha y hora:
- HOY: ${todayStr}
- Fecha ISO: ${todayISO}
- Hora: ${currentTime24} (${currentTime12})
- Mañana: ${tomorrow} | Pasado mañana: ${dayAfter}
- Próximos días: ${JSON.stringify(weekDates)}

Eventos en el calendario:
${events.length > 0
    ? JSON.stringify(events.map(e => ({ id: e.id, title: e.title, time: e.time || '', date: e.date || null, section: e.section })), null, 2)
    : 'Sin eventos aún.'}

${tasksContext}

${weatherContext}

${contactsContext}
${profileContext ? '\n' + profileContext : ''}

Instrucciones:
- Cuando crees/edites/elimines un evento o completes una tarea, confírmalo brevemente en el reply.
- No pidas confirmación salvo que falten datos críticos.
- Si falta la hora, crea el evento sin hora y menciónalo.
- Responde en máximo 2 oraciones. Sin asteriscos, listas, negritas ni símbolos. Solo texto plano.
- Tono impecable, perfil estudiante-ejecutivo de la Universidad de los Andes.`

  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ]

  async function callClaude(msgs) {
    return fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        tool_choice: { type: 'auto' },
        messages: msgs,
      }),
    })
  }

  try {
    const res = await callClaude(messages)

    if (!res.ok) {
      if (res.status === 401) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'invalid_api_key' }) }
      }
      const txt = await res.text()
      console.error('[nova] Anthropic error:', res.status, txt)
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'api_error', status: res.status }) }
    }

    const data = await res.json()
    const content = data.content ?? []

    let reply = ''
    const actions = []

    for (const block of content) {
      if (block.type === 'text') {
        reply += block.text
      } else if (block.type === 'tool_use') {
        const action = toolCallToAction(block.name, block.input)
        if (action) actions.push(action)
      }
    }

    // Si solo hay acciones sin texto, generar reply implícito
    if (!reply.trim() && actions.length > 0) {
      const labels = actions.map(a => {
        if (a.type === 'add_event')      return `"${a.event?.title}" creado`
        if (a.type === 'edit_event')     return 'evento actualizado'
        if (a.type === 'delete_event')   return 'evento eliminado'
        if (a.type === 'mark_task_done') return 'tarea completada'
        return 'acción ejecutada'
      })
      reply = `Listo, ${labels.join(' y ')}.`
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: reply.trim(), actions }),
    }
  } catch (err) {
    console.error('[nova] Error:', err)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'internal_error', message: err.message }),
    }
  }
}

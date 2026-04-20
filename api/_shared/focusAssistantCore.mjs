// Núcleo de /api/focus-assistant.js. Separado del handler para aislar el
// prompt + la llamada a Anthropic del ciclo request/response de la función
// serverless.
//
// Contrato: runFocusAssistant({...}) devuelve { reply, actions } o lanza
// FocusAssistantError con { status, code }.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'

export class FocusAssistantError extends Error {
  constructor(code, { status = 500, detail = undefined } = {}) {
    super(code)
    this.code = code
    this.status = status
    this.detail = detail
  }
}

const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

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

function fmtHour(dec) {
  if (dec == null) return ''
  const h = Math.floor(dec), m = Math.round((dec - h) * 60)
  return m > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${h}:00`
}

async function buildWeatherContext(location) {
  if (!location?.lat || !location?.lon) {
    return 'Ubicación no disponible — no puedes dar información del clima.'
  }
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
    return `Ubicación del usuario: ${cityLabel}
Clima actual: ${describeWeatherCode(cur.weather_code)}, ${cur.temperature_2m}°C, humedad ${cur.relative_humidity_2m}%, viento ${cur.wind_speed_10m} km/h
Pronóstico próximos 3 días:
${forecast}`
  } catch {
    return location.city
      ? `Ubicación: ${location.city}${location.country ? ', ' + location.country : ''}. Clima no disponible en este momento.`
      : 'Clima no disponible en este momento.'
  }
}

function buildBehaviorContext(b) {
  if (!b) return ''
  const lines = []
  lines.push(`Comportamiento observado del usuario (últimos ${b.period_days || 30} días, ${b.sample_size || 0} señales):`)
  if (b.real_peak_window) {
    const { start, end } = b.real_peak_window
    const profileBit = b.profile_peak
      ? ` (el usuario DECLARÓ ${b.profile_peak.start}–${b.profile_peak.end}h en su perfil${start !== b.profile_peak.start ? ' — hay un desfase' : ''})`
      : ''
    lines.push(`- PICO REAL observado de productividad: ${start}–${end}h${profileBit}.`)
    lines.push(`  → Prioriza estas horas reales sobre las declaradas al proponer foco/trabajo profundo.`)
  } else if (b.real_peak_hour != null) {
    lines.push(`- Hora más productiva observada: ${b.real_peak_hour}h.`)
  }
  if (b.busy_weekday) lines.push(`- Día más productivo: ${b.busy_weekday}${b.slow_weekday ? `. Día más lento: ${b.slow_weekday}` : ''}.`)
  if (b.approval_rate != null) {
    const pct = Math.round(b.approval_rate * 100)
    lines.push(`- Tasa de aprobación de sugerencias: ${pct}% (${b.approved_count} aprobadas / ${b.rejected_count} rechazadas).`)
  }
  if (b.top_approved_kind) lines.push(`- Tipo de sugerencia que MÁS aprueba: "${b.top_approved_kind}" — seguí proponiendo estas.`)
  if (b.avoid_kinds?.length) lines.push(`- EVITÁ sugerir (rechazadas 3+ veces): ${b.avoid_kinds.join(', ')}.`)
  if (b.top_categories?.length) {
    const cats = b.top_categories.map(c => `${c.category} (${c.count})`).join(', ')
    lines.push(`- Categorías de eventos que crea más: ${cats}.`)
  }
  if (b.nova_favorite_hour != null) lines.push(`- Suele escribirte alrededor de las ${b.nova_favorite_hour}h.`)
  if (b.engagement_trend) {
    const hint = {
      subiendo: 'Buen momento para sugerencias más ambiciosas.',
      bajando:  'Está menos activo — sugerencias más simples y motivadoras.',
      estable:  'Ritmo consistente.',
    }[b.engagement_trend]
    lines.push(`- Engagement última semana: ${b.engagement_trend}. ${hint}`)
  }
  lines.push('')
  lines.push('INSTRUCCIÓN: Usa este modelo comportamental para personalizar TODAS tus propuestas. Cuando el pico real difiere del declarado, el real tiene prioridad. Cuando hay tipos rechazados, NO los propongas.')
  return lines.join('\n')
}

// Resume propuestas pendientes (sin aprobar) para inyectarlas al prompt.
// Clave para que Nova pueda referenciar eventos que acaba de proponer en la
// misma conversación — cuando el usuario dice "15 min antes" justo después
// de "leer a las 8", ese evento todavía no está en `events` porque el
// usuario no lo aprobó aún desde la bandeja.
function buildPendingContext(pendingSuggestions) {
  if (!pendingSuggestions?.length) return ''
  const lines = pendingSuggestions.slice(0, 10).map((s) => {
    const p = s.payload || {}
    if (s.kind === 'add_event') {
      const ev = p.event || {}
      const parts = [
        `"${ev.title || 'evento'}"`,
        ev.time ? `a las ${ev.time}` : 'sin hora',
        ev.date ? `(${ev.date})` : '',
      ].filter(Boolean).join(' ')
      return `- propose_id:${s.id} · add_event · ${parts}`
    }
    if (s.kind === 'edit_event') return `- propose_id:${s.id} · edit_event · id:${p.id} · updates:${JSON.stringify(p.updates || {})}`
    if (s.kind === 'delete_event') return `- propose_id:${s.id} · delete_event · id:${p.id}`
    if (s.kind === 'mark_task_done') return `- propose_id:${s.id} · mark_task_done · id:${p.id}`
    return `- propose_id:${s.id} · ${s.kind}`
  })
  return `Propuestas pendientes (aún sin aprobar por el usuario en la bandeja):
${lines.join('\n')}

Para efectos de referencia conversacional, trátalas como si ya existieran. Si el usuario dice "avísame 15 min antes" justo después de pedirte crear algo, refiere al add_event pendiente más reciente y calcula la hora a partir de ahí — aunque todavía no esté en el calendario real. Crea el recordatorio aparte como nueva add_event; NO edites la propuesta original.`
}

function buildSystemPrompt({ events, tasks, contacts, profile, memories, behavior, pendingSuggestions, weatherContext, todayISO, todayStr, tomorrow, dayAfter, currentTime24, currentTime12, weekDates }) {
  const contactsContext = contacts?.length > 0
    ? `Contactos del usuario:\n${contacts.map(c => `- ${c.name ?? 'Sin nombre'}${c.tel ? ': ' + c.tel : ''}${c.email ? ' / ' + c.email : ''}`).join('\n')}`
    : 'El usuario no ha compartido contactos.'

  const chronoLabels = { morning: 'matutino', afternoon: 'vespertino', night: 'nocturno' }
  const roleLabels   = { student: 'estudiante', worker: 'trabajador', freelance: 'freelancer', other: 'otro' }
  const CATEGORY_LABELS = {
    fact: 'Hecho', relationship: 'Relación', preference: 'Preferencia',
    goal: 'Meta', pain: 'Dolor/Fricción', routine: 'Rutina', context: 'Contexto',
  }

  const memoriesContext = memories?.length > 0
    ? `Memoria sobre el usuario (persistente entre conversaciones — úsala para personalizar TODAS tus respuestas):
${memories.slice(0, 40).map(m => {
  const label = CATEGORY_LABELS[m.category] || m.category
  const subj = m.subject ? ` (${m.subject})` : ''
  const pin = m.pinned ? ' ⭐' : ''
  return `- ${label}${subj}${pin}: ${m.content}`
}).join('\n')}`
    : 'Aún no tienes memorias sobre este usuario. Cuando aprendas algo relevante, guárdalo usando la acción "remember".'

  const profileContext = profile
    ? `Perfil de productividad del usuario:
- Cronotipo: ${chronoLabels[profile.chronotype] ?? profile.chronotype ?? 'no definido'} (${roleLabels[profile.role] ?? profile.role ?? 'rol no definido'})
- Zona de rendimiento: ${fmtHour(profile.peakStart)}–${fmtHour(profile.peakEnd)}

INSTRUCCIÓN CRÍTICA sobre la zona de rendimiento:
- Cuando el usuario pida agendar trabajo profundo, deep work, estudio, foco o concentración: SIEMPRE propón un horario dentro de ${fmtHour(profile.peakStart)}–${fmtHour(profile.peakEnd)} si ese bloque está libre.
- Si el usuario no especifica hora para este tipo de actividades, sugiere automáticamente ese rango.
- Si hay eventos que interrumpen la zona de rendimiento, menciona el conflicto y ofrece moverlos.
- Cuando propongas mover un evento fuera de la zona, da una hora concreta alternativa.`
    : ''

  const tasksContext = tasks?.length > 0
    ? `Tareas del usuario:\n${tasks.map(t => `- [${t.done ? 'x' : ' '}] id:${t.id} "${t.label}" (${t.priority}, ${t.category})`).join('\n')}`
    : 'Sin tareas registradas.'

  const behaviorContext = buildBehaviorContext(behavior)
  const pendingContext  = buildPendingContext(pendingSuggestions)

  return `Eres Nova, la asistente ejecutiva de productividad. Hablas en español neutro, tono formal y eficiente.

Tienes acceso a:
- Agenda y eventos del usuario
- Lista de tareas (MIT method)
- Ubicación y clima en tiempo real
- Contactos del usuario
- Fecha y hora actual
- Perfil cronobiológico y zona de rendimiento

REGLA ABSOLUTA: Responde SOLO con un objeto JSON válido. Sin markdown, sin bloques de código, sin texto fuera del JSON.
FORMATO ESTRICTO:
- Respuesta DEBE ser un único objeto JSON.
- Cierra todas las llaves } y corchetes ].
- Sin comas finales.
- Sin texto antes/después del JSON.
- Si el contenido excede el límite, acorta el texto de "reply" (nunca rompas el JSON).

Formato:
{
  "reply": "Texto conversacional para el usuario",
  "actions": []
}

Acciones disponibles:

Agregar evento:
{ "type": "add_event", "event": { "title": string, "time": string, "date": string|null, "section": "focus"|"evening", "icon": string } }

Editar/mover evento:
{ "type": "edit_event", "id": "id-del-evento", "updates": { campos } }

Eliminar evento:
{ "type": "delete_event", "id": "id-del-evento" }

Completar tarea:
{ "type": "mark_task_done", "id": "id-de-la-tarea" }

Guardar memoria:
{ "type": "remember", "memory": { "category": "fact|relationship|preference|goal|pain|routine|context", "subject": "opcional", "content": "texto en 3era persona", "confidence": "high|medium|low" } }

Cuándo guardar memoria (hazlo proactivamente):
- Relaciones, hechos personales, preferencias, metas, dolores, rutinas, contextos.
- Redacta en 3era persona concisa. No dupliques memorias ya existentes.
- La acción remember es transparente, no requiere reply adicional.

Reglas de formato:
- time: "9:00 AM", "3:30 PM" — vacío si no hay hora
- date: YYYY-MM-DD — null = hoy (${todayISO})
- section: "evening" si hora ≥ 14:00, sino "focus"
- icon: fitness_center | groups | restaurant | menu_book | work | local_hospital | shopping_cart | cake | flight | account_balance | alarm | event

Fecha y hora:
- HOY: ${todayStr}
- Fecha ISO: ${todayISO}
- Hora: ${currentTime24} (${currentTime12})
- Mañana: ${tomorrow} | Pasado mañana: ${dayAfter}
- Próximos días: ${JSON.stringify(weekDates)}

Eventos actuales:
${events?.length > 0
    ? JSON.stringify(events.map(e => ({ id: e.id, title: e.title, time: e.time || '', date: e.date || null, section: e.section })), null, 2)
    : 'Sin eventos aún.'}

${pendingContext}

${tasksContext}

${weatherContext}

${contactsContext}
${profileContext ? '\n' + profileContext : ''}
${behaviorContext ? '\n' + behaviorContext : ''}

${memoriesContext}

Recordatorios previos a un evento (MUY IMPORTANTE — memoria conversacional):
- Si piden "avísame X min antes", "recuérdame X antes", "ponme un aviso X antes" referido a un evento: NO edites el evento, CREA uno nuevo con add_event, title "Recordatorio: [título original]", time = hora del evento MENOS X, icon "alarm", description "Salir para [título] a las [hora original]".
- El evento al que se refieren puede estar en "Eventos actuales" o en "Propuestas pendientes" — si la última intención del usuario en esta conversación fue crear un evento (aunque aún no esté aprobado en la bandeja), asume que "X min antes" se refiere a ese. Usa el título y la hora de esa propuesta para calcular el recordatorio.
- Si hay ambigüedad real entre varios candidatos, pregunta; si solo hay uno reciente, úsalo sin preguntar.

Hora ambigua: si dicen "a las 9" sin AM/PM y 9:00 AM ya pasó (son las ${currentTime24}), interpretar como 9:00 PM. En contextos nocturnos (cena, deporte, cine) prioriza la tarde/noche.

Evento actual (±30 min): "el de ahora", "el actual" → evento cuya hora esté dentro de ±30 min de ${currentTime24}. Ignora prefijos "Recordatorio:" al comparar.

Instrucciones:
- Si creas/editas/eliminas o completas algo, inclúyelo en actions — no solo texto.
- No pidas confirmación salvo ambigüedad crítica.
- Si falta la hora, crea el evento sin hora y menciónalo.
- Máximo 2 oraciones. Texto plano, sin asteriscos, listas ni markdown.
- Tono impecable, perfil estudiante-ejecutivo de la Universidad de los Andes.`
}

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

async function callAnthropic({ apiKey, systemPrompt, messages }) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: systemPrompt,
      messages,
    }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    if (res.status === 401) throw new FocusAssistantError('invalid_api_key', { status: 401 })
    console.error('[focus-assistant] Anthropic error:', res.status, txt)
    throw new FocusAssistantError('api_error', { status: 502, detail: txt })
  }
  return res.json()
}

export async function runFocusAssistant(input) {
  const { message, apiKey } = input
  if (!apiKey) throw new FocusAssistantError('no_api_key', { status: 503 })
  if (!message?.trim()) throw new FocusAssistantError('no_message', { status: 400 })

  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10)
  const dayAfter = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10)
  const hh = String(today.getHours()).padStart(2, '0')
  const mm = String(today.getMinutes()).padStart(2, '0')
  const currentTime24 = `${hh}:${mm}`
  const currentTime12 = today.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true })
  const todayStr = today.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const weekDates = {}
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today.getTime() + i * 86400000)
    weekDates[DAY_NAMES_ES[d.getDay()]] = d.toISOString().slice(0, 10)
  }

  const weatherContext = await buildWeatherContext(input.location)

  const systemPrompt = buildSystemPrompt({
    events: input.events || [],
    tasks: input.tasks || [],
    contacts: input.contacts || [],
    profile: input.profile,
    memories: input.memories || [],
    behavior: input.behavior,
    pendingSuggestions: input.pendingSuggestions || [],
    weatherContext,
    todayISO, todayStr, tomorrow, dayAfter,
    currentTime24, currentTime12, weekDates,
  })

  const messages = [
    ...(input.history || []).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ]

  const data1 = await callAnthropic({ apiKey, systemPrompt, messages })
  const raw1 = (data1.content?.[0]?.text ?? '').trim()

  try {
    return safeParseAssistantJSON(raw1)
  } catch (e1) {
    // Reintento: pedir al modelo que regenere SOLO JSON válido.
    const retryMessages = [
      ...messages,
      {
        role: 'user',
        content: 'Tu respuesta anterior tuvo JSON inválido o incompleto. Reintenta ahora. Responde SOLO con un objeto JSON válido siguiendo exactamente el formato indicado. Cierra todas las llaves y corchetes.',
      },
    ]
    const data2 = await callAnthropic({ apiKey, systemPrompt, messages: retryMessages })
    const raw2 = (data2.content?.[0]?.text ?? '').trim()
    try {
      return safeParseAssistantJSON(raw2)
    } catch (e2) {
      console.error('[focus-assistant] JSON parse failed after retry:', { e1: String(e1), e2: String(e2) })
      return {
        reply: 'No pude generar una respuesta estructurada en este momento. Por favor, repite tu solicitud.',
        actions: [],
      }
    }
  }
}

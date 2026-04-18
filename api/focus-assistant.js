import Anthropic from '@anthropic-ai/sdk';

// ─── Rate limiting en memoria (30 req/min por IP) ────────────────────────────
const _rl = new Map()
function rateLimited(ip) {
  const now = Date.now()
  const e = _rl.get(ip)
  if (!e || now > e.reset) { _rl.set(ip, { count: 1, reset: now + 60_000 }); return false }
  if (e.count >= 30) return true
  e.count++
  return false
}

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'rate_limit', message: 'Demasiadas solicitudes. Espera un momento.' })
  }

  const normalizedApiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!normalizedApiKey) {
    return res.status(503).json({ error: 'no_api_key' })
  }

  const anthropic = new Anthropic({ apiKey: normalizedApiKey })

  const { message, events = [], history = [], location = null, contacts = [], profile = null, memories = [], behavior = null } = req.body || {}

  if (!message?.trim()) {
    return res.status(400).json({ error: 'no_message' })
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

  // Perfil cronobiológico del usuario
  function fmtHour(dec) {
    if (dec == null) return ''
    const h = Math.floor(dec), m = Math.round((dec - h) * 60)
    return m > 0 ? `${h}:${String(m).padStart(2,'0')}` : `${h}:00`
  }
  const chronoLabels = { morning: 'matutino', afternoon: 'vespertino', night: 'nocturno' }
  const roleLabels   = { student: 'estudiante', worker: 'trabajador', freelance: 'freelancer', other: 'otro' }
  // Memoria persistente sobre el usuario
  const CATEGORY_LABELS = {
    fact:         'Hecho',
    relationship: 'Relación',
    preference:   'Preferencia',
    goal:         'Meta',
    pain:         'Dolor/Fricción',
    routine:      'Rutina',
    context:      'Contexto',
  }
  const memoriesContext = memories.length > 0
    ? `Memoria sobre el usuario (persistente entre conversaciones — úsala para personalizar TODAS tus respuestas):
${memories.slice(0, 40).map(m => {
  const label = CATEGORY_LABELS[m.category] || m.category
  const subj = m.subject ? ` (${m.subject})` : ''
  const pin = m.pinned ? ' ⭐' : ''
  return `- ${label}${subj}${pin}: ${m.content}`
}).join('\n')}`
    : 'Aún no tienes memorias sobre este usuario. Cuando aprendas algo relevante sobre él (relaciones, metas, preferencias, rutinas, dolores, contextos), guárdalo usando la acción "remember".'

  const profileContext = profile
    ? `Perfil de productividad del usuario:
- Cronotipo: ${chronoLabels[profile.chronotype] ?? profile.chronotype ?? 'no definido'} (${roleLabels[profile.role] ?? profile.role ?? 'rol no definido'})
- Zona de rendimiento (máxima energía cognitiva): ${fmtHour(profile.peakStart)}–${fmtHour(profile.peakEnd)}

INSTRUCCIÓN CRÍTICA sobre la zona de rendimiento:
- Cuando el usuario pida agendar trabajo profundo, deep work, estudio, foco o concentración: SIEMPRE propón un horario dentro de ${fmtHour(profile.peakStart)}–${fmtHour(profile.peakEnd)} si ese bloque está libre.
- Si el usuario no especifica hora para este tipo de actividades, sugiere automáticamente ese rango.
- Si hay eventos que interrumpen la zona de rendimiento (reuniones, llamadas, clases), menciona el conflicto y ofrece moverlos.
- Cuando propongas mover un evento fuera de la zona de rendimiento, da una hora concreta alternativa.`
    : ''

  // Modelo comportamental derivado de user_signals (analyzeBehavior)
  // Esto es CLAVE: le da a Nova aprendizaje implícito del usuario sin que él
  // tenga que escribir nada. Nova ajusta sus propuestas basándose en esto.
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

    if (b.busy_weekday) {
      lines.push(`- Día más productivo: ${b.busy_weekday}${b.slow_weekday ? `. Día más lento: ${b.slow_weekday}` : ''}.`)
    }

    if (b.approval_rate != null) {
      const pct = Math.round(b.approval_rate * 100)
      lines.push(`- Tasa de aprobación de sugerencias: ${pct}% (${b.approved_count} aprobadas / ${b.rejected_count} rechazadas).`)
    }

    if (b.top_approved_kind) {
      lines.push(`- Tipo de sugerencia que MÁS aprueba: "${b.top_approved_kind}" — seguí proponiendo estas.`)
    }

    if (b.avoid_kinds && b.avoid_kinds.length > 0) {
      lines.push(`- EVITÁ sugerir (rechazadas 3+ veces): ${b.avoid_kinds.join(', ')}.`)
    }

    if (b.top_categories && b.top_categories.length > 0) {
      const cats = b.top_categories.map(c => `${c.category} (${c.count})`).join(', ')
      lines.push(`- Categorías de eventos que crea más: ${cats}.`)
    }

    if (b.nova_favorite_hour != null) {
      lines.push(`- Suele escribirte alrededor de las ${b.nova_favorite_hour}h.`)
    }

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
  const behaviorContext = buildBehaviorContext(behavior)

  const systemPrompt = `Eres Focus, un Asistente Ejecutivo de Productividad y Calendario. Hablas en español neutro, con tono formal, profesional y eficiente.

Tienes acceso completo a:
- La agenda y eventos del usuario
- Su ubicación y clima en tiempo real
- Sus contactos
- La fecha y hora actual
- Su perfil cronobiológico y zona de rendimiento

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
- No incluyas saltos de contexto, disculpas, ni texto antes/después del JSON.
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

Guardar memoria sobre el usuario (CRÍTICO para personalización):
{ "type": "remember", "memory": { "category": "fact|relationship|preference|goal|pain|routine|context", "subject": "pareja|jefe|proyecto-X|etc", "content": "texto del hecho en tercera persona", "confidence": "high|medium|low" } }

Cuándo guardar memoria (hazlo proactivamente, sin pedir permiso):
- Relaciones: nombres de pareja, familia, amigos, jefe, compañeros, mascota ("Su pareja se llama Ana")
- Hechos personales: profesión, ciudad, universidad, edad aproximada, fechas importantes ("Estudia Ingeniería Industrial en la UAndes")
- Preferencias: comidas, horarios, herramientas, tipos de trabajo que le gustan o evita ("Prefiere reuniones breves por la mañana")
- Metas: objetivos de corto/mediano/largo plazo ("Quiere terminar su tesis en julio")
- Dolores/fricciones: cosas que le frustran o estresan ("Le agota tener más de 3 reuniones seguidas")
- Rutinas: hábitos repetidos ("Hace crossfit lunes, miércoles y viernes 19:00")
- Contextos: situaciones actuales con fecha posible ("Está buscando práctica este semestre")

Reglas de memoria:
- Redacta en tercera persona concisa, máximo 1 oración.
- NO guardes memorias genéricas, triviales o que solo aplican al momento actual.
- NO dupliques: si una memoria similar ya está en la lista, no la repitas.
- Si el usuario corrige algo ("no, no es Ana, es Carla"), emite un remember con el dato correcto — el servidor no borra automáticamente, solo agrega.
- Puedes emitir varias acciones remember en la misma respuesta.
- La acción remember NO requiere reply adicional — el usuario no verá notificación, es transparente.

Reglas de formato:
- time: "9:00 AM", "3:30 PM", etc. — vacío si no hay hora
- date: YYYY-MM-DD — null significa hoy (${todayISO})
- section: "evening" si hora ≥ 14:00, sino "focus"
- icon: fitness_center | groups | restaurant | menu_book | work | local_hospital | shopping_cart | cake | flight | account_balance | alarm | event

Fecha y hora actual del sistema:
- HOY: ${todayStr}
- Fecha ISO: ${todayISO}
- Hora actual: ${currentTime24} (${currentTime12})
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
${profileContext ? '\n' + profileContext : ''}
${behaviorContext ? '\n' + behaviorContext : ''}

${memoriesContext}

Recordatorios previos a un evento (CRÍTICO):
- Si el usuario pide "avísame X minutos antes", "recuérdame salir X min antes", "ponme un aviso X antes" de un evento existente:
  1. NO modifiques ni edites el evento principal (no uses edit_event sobre él).
  2. Crea un NUEVO evento con add_event:
     - title: "Recordatorio: [título del evento principal]"
     - time: hora del evento principal MENOS los minutos solicitados (ej: fútbol 21:00, 15 min antes → 20:45 → "8:45 PM")
     - date: misma fecha que el evento principal (null si es hoy)
     - section: "evening" si la hora calculada ≥ 14:00, sino "focus"
     - icon: "alarm"
     - description: "Salir para [título del evento principal] a las [hora del evento principal]"
  3. El reply debe confirmar ambas cosas: el evento principal sigue en su hora, y el aviso queda agendado a la hora calculada.
- Ejemplo: "Fútbol" a las 9:00 PM, pide aviso 15 min antes → crea "Recordatorio: Fútbol" a las 8:45 PM con description "Salir para Fútbol a las 9:00 PM".

Instrucciones adicionales:
- Si el usuario pide mover un evento, usa edit_event con el id correcto
- Si el usuario habla de eliminar todos los eventos, elimínalos uno por uno con múltiples acciones delete_event
- Si el usuario pregunta por el clima, responde con los datos reales que tienes en el contexto
- Si el usuario pregunta algo no relacionado con el calendario ni el clima, responde brevemente y ofrece ayuda con organización y agenda
- Sincronización con "Mi Día": si la solicitud implica crear/editar/mover/eliminar eventos, SIEMPRE incluye las acciones necesarias para reflejar el cambio inmediatamente en el calendario. No respondas solo con texto.
- Cuando agregues o muevas un evento, el reply debe confirmar dos cosas: (1) que quedó agregado/actualizado en el calendario y (2) que ya es visible en "Mi Día" para la fecha correspondiente.
- No pidas confirmación salvo que falten datos críticos (por ejemplo: fecha imposible o evento ambiguo entre dos ids). Si faltan detalles no críticos (por ejemplo: hora), crea el evento sin hora y menciónalo en el reply.
- Si no hay suficiente información (ej. no se menciona hora), agrega el evento sin hora y menciona que lo puede editar después

Interpretación de hora ambigua (CRÍTICO):
- Si el usuario menciona una hora sin AM/PM (ej. "a las 9", "a las 7"), aplica esta lógica:
  1. Convierte la hora mencionada a AM. Si ya pasó respecto a ${currentTime24}, asume automáticamente que se refiere a la noche (PM). Ejemplo: son las 17:00 y dice "a las 9" → 9:00 AM ya pasó → interpreta como 9:00 PM (21:00).
  2. En contextos de ocio o deporte (fútbol, cena, cine, reunión social), si la hora es ambigua y es tarde del día, prioriza siempre el bloque tarde/noche.
  3. No crees eventos en horas que ya transcurrieron hoy (ni AM ni PM). Si la hora en PM también ya pasó, responde preguntando: "¿Te referís a mañana a esa hora?"
- Al confirmar siempre indica el periodo para evitar errores: "Perfecto, agendado Fútbol para hoy a las 21:00 (9 PM)".

Eliminación y búsqueda por hora actual (CRÍTICO):
- Cuando el usuario diga "el de ahora", "el que tengo ahora", "el actual", "en este momento", "el que empieza ahora" o expresiones similares, identifica el evento cuya hora de inicio esté dentro de un rango de ±30 minutos respecto a la hora actual del sistema (${currentTime24}).
- Para comparar: convierte los tiempos de los eventos (formato "H:MM AM/PM") a 24h y calcula la diferencia en minutos con ${currentTime24}. Si la diferencia absoluta es ≤ 30 minutos, ese evento es el candidato.
- Si hay exactamente un candidato en ese rango, selecciónalo y ejecuta la acción (delete_event / edit_event) directamente sin pedir confirmación ni nombre.
- Solo pide clarificación si hay dos o más eventos dentro del rango de ±30 minutos al mismo tiempo.
- Al comparar por nombre, ignora prefijos como "Recordatorio:", "Recuerda:", "Reminder:" — tratalos como parte del mismo evento. "clase de historia" hace match con "Recordatorio: Clase de Historia".
- Al confirmar la eliminación, incluye el título exacto del evento eliminado en el reply.

- IMPORTANTE — esta es una interfaz de VOZ. Responde siempre en español neutro, con trato impecable (perfil estudiante‑ejecutivo de la Universidad de los Andes). Máximo 2 oraciones claras y directas. No uses modismos chilenos ni jerga informal. Sin negritas, sin asteriscos, sin guiones, sin listas, sin símbolos ni formato. Solo texto plano, apto para ser leído en voz alta.`

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

  async function runClaude({ extraUserInstruction = '' } = {}) {
    const extra = extraUserInstruction
      ? [{ role: 'user', content: extraUserInstruction }]
      : []
    return anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      // 200 tokens puede truncar JSON; subir para respuestas + acciones.
      max_tokens: 700,
      system: systemPrompt,
      messages: [...messages, ...extra],
    })
  }

  try {
    const data1 = await runClaude()
    const raw1 = (data1.content?.[0]?.text ?? '').trim()

    try {
      const parsed1 = safeParseAssistantJSON(raw1)
      return res.status(200).json(parsed1)
    } catch (e1) {
      // Reintento: pedir al modelo que regenere SOLO JSON válido.
      const data2 = await runClaude({
        extraUserInstruction:
          'Tu respuesta anterior tuvo JSON inválido o incompleto. Reintenta ahora. Responde SOLO con un objeto JSON válido siguiendo exactamente el formato indicado. Cierra todas las llaves y corchetes.',
      })
      const raw2 = (data2.content?.[0]?.text ?? '').trim()
      try {
        const parsed2 = safeParseAssistantJSON(raw2)
        return res.status(200).json(parsed2)
      } catch (e2) {
        console.error('[focus-assistant] JSON parse failed after retry:', { e1: String(e1), e2: String(e2), raw1, raw2 })
        return res.status(200).json({
          reply: 'No pude generar una respuesta estructurada en este momento. Por favor, repite tu solicitud.',
          actions: [],
        })
      }
    }
  } catch (err) {
    if (err?.status === 401) {
      return res.status(401).json({ error: 'invalid_api_key' })
    }
    console.error('[focus-assistant] Error:', err)
    return res.status(500).json({ error: 'internal_error', message: err.message })
  }
}

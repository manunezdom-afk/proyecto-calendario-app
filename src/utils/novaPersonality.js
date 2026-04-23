// Capa de tono reutilizable para Nova. No cambia lógica de negocio ni hechos:
// solo envuelve las cadenas que Nova dice al usuario para que cambien de forma
// coherente según la personalidad elegida en Ajustes.
//
// Regla de oro: las 3 variantes dicen lo mismo. Solo cambian framing, longitud
// y vocabulario. Si una variante empieza a decir algo distinto (ej. sugerir
// una hora, inventar una razón), rompe la promesa de esta capa.
//
// Keys soportadas (las llamamos "intents" para dejar claro que son situaciones,
// no copy literal). Añade keys nuevas solo cuando sumes un punto real de
// comunicación — no por cada cadena hardcodeada.

export const NOVA_PERSONALITIES = [
  {
    id: 'focus',
    label: 'Focus',
    description: 'Directa y orientada a la acción',
    longDescription: 'Frases cortas, verbos claros, sin relleno. El modo por defecto.',
  },
  {
    id: 'cercana',
    label: 'Cercana',
    description: 'Más humana y accesible',
    longDescription: 'Tono amable y cercano, sin sonar infantil ni lento.',
  },
  {
    id: 'estrategica',
    label: 'Estratégica',
    description: 'Más analítica y planificadora',
    longDescription: 'Enfatiza estructura, prioridad y el motivo detrás de cada acción.',
  },
]

export const NOVA_PERSONALITY_IDS = NOVA_PERSONALITIES.map((p) => p.id)
export const DEFAULT_NOVA_PERSONALITY = 'focus'

export function normalizeNovaPersonality(value) {
  return NOVA_PERSONALITY_IDS.includes(value) ? value : DEFAULT_NOVA_PERSONALITY
}

export function getPersonalityProfile(id) {
  return NOVA_PERSONALITIES.find((p) => p.id === normalizeNovaPersonality(id))
    ?? NOVA_PERSONALITIES[0]
}

// ──────────────────────────────────────────────────────────────────────────
// Banco de frases por intent × personalidad.
//
// Cada intent es una situación concreta, no un texto. Las 3 variantes dicen
// LO MISMO, solo cambian el tono. Esto se mantiene fácil porque agregar una
// nueva personalidad en el futuro = añadir una columna aquí, no tocar call
// sites.
//
// Variables disponibles vía el segundo argumento de novaSay():
//   · {n}     → número (cuando aplica)
//   · {parts} → string libre (ej: "2 eventos y 1 tarea")
//   · {title} → título de un item
// ──────────────────────────────────────────────────────────────────────────

const INTENTS = {
  // Confirmación genérica cuando Nova aplicó acciones pero no hay texto
  // narrativo desde el servidor.
  success_generic: {
    focus:       'Listo.',
    cercana:     'Ya está.',
    estrategica: 'Programado.',
  },

  // Nova no entendió el mensaje o no pudo ejecutar acciones.
  failure_generic: {
    focus:       'No pude procesar eso.',
    cercana:     'No logré entenderlo, intenta reformularlo.',
    estrategica: 'No identifiqué una acción clara en tu mensaje.',
  },

  // Eventos cargados desde una foto, plural confirmado.
  success_photo_multi: {
    focus:       '¡Listo! Eventos agregados al calendario.',
    cercana:     'Ya te los dejé en el calendario.',
    estrategica: 'Agendados. Ya quedaron estructurados en tu calendario.',
  },

  // Resumen de 1 evento desde foto: "{title}"
  success_photo_one: {
    focus:       'Agregué 1 evento desde la foto: "{title}".',
    cercana:     'Ya te dejé "{title}" en el calendario.',
    estrategica: 'Añadí "{title}" al calendario — 1 evento identificado en la foto.',
  },

  // Resumen de N eventos desde foto.
  success_photo_count: {
    focus:       'Agregué {n} eventos desde la foto.',
    cercana:     'Te dejé {n} eventos listos en el calendario.',
    estrategica: 'Añadí {n} eventos al calendario desde la foto.',
  },

  // Foto sin eventos detectables.
  photo_no_events: {
    focus:       'No encontré eventos claros en la foto. Intenta con otra o descríbelos con texto.',
    cercana:     'No vi eventos claros en la foto. Prueba con otra o cuéntamelo por texto.',
    estrategica: 'La foto no contiene información suficiente. Usa otra imagen o descríbelo por texto.',
  },

  // Toast undo tras aplicar N cambios — {parts} ya viene armado ("2 eventos y 1 tarea")
  added_summary: {
    focus:       'Añadí {parts}',
    cercana:     'Ya te dejé {parts}',
    estrategica: 'Programé {parts}',
  },

  // Sufijo tras una sola propuesta en modo propuesta.
  proposal_suffix_one: {
    focus:       'Revisa la propuesta en la bandeja antes de aplicarla.',
    cercana:     'Te dejé la propuesta en la bandeja para que la revises.',
    estrategica: 'Preparé la propuesta en la bandeja — revisa el detalle antes de aplicar.',
  },

  // Sufijo tras N propuestas en modo propuesta.
  proposal_suffix_multi: {
    focus:       'Preparé {n} propuestas. Revísalas en la bandeja.',
    cercana:     'Te dejé {n} propuestas listas en la bandeja.',
    estrategica: 'Consolidé {n} propuestas en la bandeja — revísalas antes de aplicar.',
  },

  // Error de conexión genérico.
  error_connection: {
    focus:       'No pude conectarme. Intenta de nuevo.',
    cercana:     'No logré conectarme, prueba otra vez.',
    estrategica: 'No pude conectarme al servicio. Reintenta en unos segundos.',
  },
}

// Devuelve la frase correspondiente al intent en la personalidad pedida. Si
// el intent no existe, cae al valor de focus (modo por defecto) y si ese
// tampoco existe, devuelve el intent key como string visible — útil para
// detectar keys faltantes en desarrollo.
export function novaSay(intent, personalityId = DEFAULT_NOVA_PERSONALITY, vars = {}) {
  const profile = normalizeNovaPersonality(personalityId)
  const row = INTENTS[intent]
  if (!row) return intent
  const template = row[profile] ?? row.focus ?? intent
  if (!vars || typeof vars !== 'object') return template
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key]
    return v == null ? '' : String(v)
  })
}

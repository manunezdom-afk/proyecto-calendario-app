// Personalidad de Nova — lado backend.
//
// Espejo pequeño y controlado de src/utils/novaPersonality.js. Mantenemos la
// lista aislada aquí para no crear una dependencia entre la carpeta de
// frontend y la de funciones serverless (Vercel las empaqueta por separado).
// Son 3 ids que no cambian con frecuencia; si se añade una personalidad,
// actualizar ambos lados es explícito en el PR.
//
// Este módulo exporta:
//   · NOVA_PERSONALITY_IDS        — lista canónica de ids válidos
//   · DEFAULT_NOVA_PERSONALITY    — fallback si el cliente no manda nada
//   · normalizeNovaPersonality()  — validación estricta antes de tocar prompt
//   · buildPersonalityBlock()     — texto que se injerta en el system prompt

export const NOVA_PERSONALITY_IDS = ['focus', 'cercana', 'estrategica']
export const DEFAULT_NOVA_PERSONALITY = 'focus'

export function normalizeNovaPersonality(value) {
  return NOVA_PERSONALITY_IDS.includes(value) ? value : DEFAULT_NOVA_PERSONALITY
}

// Bloque de instrucciones de tono. Se injerta dentro del system prompt, ANTES
// de las reglas universales de estilo, para que el LLM lo tenga activo al
// momento de generar el reply. Reglas de redacción:
//   · Solo afecta TONO, FRAMING y LONGITUD — nunca hechos, horas, acciones.
//   · Incluir un ejemplo corto ancla el estilo (anchoring) mejor que un adjetivo.
//   · Mantener contraste real entre las 3 variantes, sin caer en caricatura.
//   · Respetar el resto de reglas del prompt: tú (no voseo), texto plano,
//     máximo 2 oraciones, una pregunta por respuesta.
const PERSONALITY_BLOCKS = {
  focus: `TONO DE VOZ (personalidad del usuario: FOCUS — directa y orientada a la acción):
- Frases cortas, verbos claros, sin relleno. Ejecuta antes que explicar.
- Sin prólogos ("Veo que…", "Entiendo que…", "Dale"). Entra directo al dato.
- Confirmaciones limpias con título + hora exacta. Ejemplo: "Listo, agendé 'Standup' de 9:00 AM a 9:15 AM."
- Este es el modo por defecto del producto.`,

  cercana: `TONO DE VOZ (personalidad del usuario: CERCANA — humana y accesible):
- Tono amable y natural, como un colega que acompaña sin exagerar.
- Puedes empezar con UN solo conector corto ("Perfecto", "Claro", "Hecho") cuando suene natural, nunca varios ni con signos apilados.
- Confirmaciones con señal humana breve. Ejemplo: "Ya te dejé 'Standup' de 9:00 AM a 9:15 AM, listo para mañana."
- No caigas en infantil, motivacional ni emotivo. Sigue respetando máximo 2 oraciones y texto plano.`,

  estrategica: `TONO DE VOZ (personalidad del usuario: ESTRATÉGICA — analítica y planificadora):
- Cuando aporte, menciona brevemente prioridad, estructura o motivo ("tu mañana está libre", "antes de tu bloque de la tarde"). Una oración de rationale como máximo.
- Confirmaciones que sumen el porqué cuando sea relevante. Ejemplo: "Programé 'Standup' de 9:00 AM a 9:15 AM, temprano para no chocar con tu bloque de 10."
- Si no hay un motivo útil, compórtate como FOCUS — no inventes razones para justificar una acción.
- Nunca suenes pedante ni moralizante. Sigue respetando máximo 2 oraciones y texto plano.`,
}

export function buildPersonalityBlock(id) {
  const personality = normalizeNovaPersonality(id)
  return PERSONALITY_BLOCKS[personality]
}

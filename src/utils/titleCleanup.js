// Limpieza ligera de títulos generados desde texto natural (voz, QuickAdd,
// importación de horarios, respuestas de Nova). Quita muletillas comunes en
// español que no aportan al título final — nada de reescrituras creativas.
//
// Ejemplos:
//   "leer lo de tiempos modernos"  → "leer Tiempos modernos"
//   "recordar tema de presupuesto" → "recordar Presupuesto"
//   "ver resumen de lenguaje"      → (sin cambios)
//
// Se aplica antes del capitalizeFirst del parser, así el primer carácter
// también se mayusculiza al final sin esfuerzo adicional.

// Muletillas tipo pronombre ("lo de", "eso de", "aquello de"):
// en español casi siempre son relleno que introduce una referencia.
const PRONOUN_FILLER_BEFORE_ARTICLE = /\b(?:lo|eso|aquello)\s+de\s+(?=(?:la|el|los|las|un[ao]?s?|mi|mis|tu|tus|su|sus)\b)/gi
const PRONOUN_FILLER_BEFORE_WORD    = /\b(?:lo|eso|aquello)\s+de\s+(\p{L})/giu

// Muletillas tipo sustantivo ("tema de", "cosa de", "asunto de"):
// solo las consideramos relleno cuando NO van precedidas por un artículo,
// para no romper frases legítimas como "el tema de la reunión".
const NOUN_FILLER_BEFORE_ARTICLE = /(?<!\b(?:el|la|los|las|un[ao]?s?|mi|mis|tu|tus|su|sus)\s)\b(?:tema|cosa|asunto)\s+de\s+(?=(?:la|el|los|las|un[ao]?s?|mi|mis|tu|tus|su|sus)\b)/gi
const NOUN_FILLER_BEFORE_WORD    = /(?<!\b(?:el|la|los|las|un[ao]?s?|mi|mis|tu|tus|su|sus)\s)\b(?:tema|cosa|asunto)\s+de\s+(\p{L})/giu

export function stripFillerPhrases(text) {
  if (!text) return ''
  let t = String(text)

  // Cuando al filler le sigue un artículo/posesivo, lo quitamos pero dejamos
  // el artículo — ej: "lo de la reunión" → "la reunión".
  t = t.replace(PRONOUN_FILLER_BEFORE_ARTICLE, '')
  t = t.replace(NOUN_FILLER_BEFORE_ARTICLE, '')

  // Cuando al filler le sigue una palabra de contenido, lo quitamos y
  // mayusculizamos la inicial: suele introducir un nombre propio o una
  // referencia concreta — ej: "lo de tiempos modernos" → "Tiempos modernos".
  t = t.replace(PRONOUN_FILLER_BEFORE_WORD, (_m, ch) => ch.toUpperCase())
  t = t.replace(NOUN_FILLER_BEFORE_WORD,    (_m, ch) => ch.toUpperCase())

  // Colapsar espacios que puedan haber quedado tras los reemplazos.
  return t.replace(/\s+/g, ' ').trim()
}

// Limpieza final aplicable a cualquier título generado automáticamente
// (parsers NLP, respuestas de Nova, chips de confirmación). Quita muletillas
// y asegura que la primera letra vaya en mayúscula, sin tocar el resto para
// no destruir nombres propios ya formateados.
export function cleanGeneratedTitle(text) {
  if (text === null || text === undefined) return text
  const raw = String(text).trim()
  if (!raw) return raw
  const stripped = stripFillerPhrases(raw)
  if (!stripped) return raw
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

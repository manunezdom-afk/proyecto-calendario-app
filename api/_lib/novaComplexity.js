// Content-free labels for telemetry and legacy offline diagnostics.
// These signals never select or authorize a paid model.
function detectComplexInput(text) {
  if (typeof text !== 'string') return false
  const lower = text.toLowerCase()

  const conversationalCues = [
    'estoy colapsado', 'estoy saturado', 'estoy cansado', 'estoy agotado',
    'estoy estresado', 'estoy abrumado', 'no sé por dónde', 'no se por donde',
    'no doy más', 'no doy mas', 'no llego', 'no alcanzo', 'no voy a alcanzar',
    'me siento', 'qué debería', 'que deberia', 'qué hago', 'que hago',
    'cómo me organizo', 'como me organizo', 'cómo lo hago', 'como lo hago',
    'ayúdame a ordenar', 'ayudame a ordenar', 'ayúdame a organizar',
    'organizame el día', 'organízame el día', 'organizame el dia',
    'ordéname el día', 'ordename el dia',
    'qué priorizo', 'que priorizo',
    'mil cosas', 'tengo mucho',
    'me siento', 'no sé si', 'no se si',
    'creo que', 'tal vez', 'quizás', 'quizas', 'podría', 'podria',
    'pienso que', 'siento que',
  ]
  for (const c of conversationalCues) {
    if (lower.includes(c)) return true
  }

  const editCues = [
    'arréglalo', 'arreglalo', 'arregla',
    'eso era', 'eso es', 'eso no era', 'no era',
    'ponle recordatorio', 'agrégale recordatorio', 'agregale recordatorio',
    'muévelo', 'muevelo', 'movelo', 'cámbialo', 'cambialo',
    'reagéndalo', 'reagendalo', 'pásalo', 'pasalo',
    'no es así', 'no es asi', 'mal',
    'mejor déjalo', 'mejor dejalo',
    'el recordatorio es', 'el recordatorio era',
    'lo de fútbol', 'lo de futbol', 'lo de arte', 'lo de la reunión',
    'lo de la clase', 'lo de la prueba', 'lo de mañana',
  ]
  for (const c of editCues) {
    if (lower.includes(c)) return true
  }

  const strongHints = [
    ' y luego ', ' y después ', ' y despues ',
    ' luego ', ' después de eso ', ' despues de eso ',
    ' después ', ' despues ',
    ' también ', ' tambien ',
    ' además ', ' ademas ',
    ' más tarde ', ' mas tarde ',
    ' y recuérdame ', ' y recuerdame ', ' y recordame ',
    ' y acuérdame ', ' y acuerdame ', ' y acordame ',
    ' y avísame ', ' y avisame ',
    ' y que no se me olvide ', ' y que no se olvide ',
    ' y no te olvides ', ' y no olvides ', ' y no me dejes olvidar ',
    ' y ponme ', ' y ponle ',
  ]
  for (const h of strongHints) {
    if (lower.includes(h)) return true
  }

  const reminderTriggerRe = /\b(recu[eé]rdame|acu[eé]rdame|acordame|av[ií]same|recordame)\b/
  const eventVerbRe = /\b(tengo|tenemos|agenda|agendame|agéndame|agendarme|ag[eé]ndame|ponme|ponle|p[oó]neme|crea|cr[eé]ame|cr[ée]ame|reagenda|me\s+toca|tengo\s+que|voy\s+a)\b/
  if (reminderTriggerRe.test(lower) && eventVerbRe.test(lower)) {
    const tIdx = lower.search(reminderTriggerRe)
    const eIdx = lower.search(eventVerbRe)
    if (tIdx >= 0 && eIdx >= 0 && Math.abs(tIdx - eIdx) > 12) return true
  }

  const timePatterns = [
    /\ben\s+(una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|\d{1,3})\s*(min|minutos?|h|hs|hrs?|horas?)\b/i,
    /\ba la(s)?\s+\d{1,2}(:\d{2})?\b/i,
    /\ba la(s)?\s+(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/i,
    /\btipo\s+(la(s)?\s+)?\d{1,2}(:\d{2})?\b/i,
    /(?<!\d)\d{1,2}:\d{2}(?!\d)/,
  ]
  let timeHits = 0
  for (const re of timePatterns) {
    const reGlobal = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    const matches = lower.match(reGlobal)
    if (matches) timeHits += matches.length
    if (timeHits >= 2) return true
  }

  if (text.length >= 70 && text.includes(',') && timeHits >= 1) return true

  if (text.length >= 120 && (lower.includes(' y ') || lower.includes(','))) return true

  return false
}

function isClarificationReply(history) {
  if (!Array.isArray(history) || history.length === 0) return false
  const last = history[history.length - 1]
  return last?.role === 'assistant'
    && typeof last.content === 'string'
    && /\?\s*$/.test(last.content.trim())
}

function detectVeryComplexInput(text) {
  if (typeof text !== 'string') return false
  const lower = text.toLowerCase()
  const timeRe = /(\ba la(?:s)?\s+\d{1,2}(?::\d{2})?\b|\ba la(?:s)?\s+(?:una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b|(?<!\d)\d{1,2}:\d{2}(?!\d)|\ben\s+(?:una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|\d{1,3})\s*(?:min|minutos?|h|hs|hrs?|horas?)\b)/gi
  const timeHits = (lower.match(timeRe) || []).length
  if (timeHits >= 3) return true
  if (text.length >= 200) return true
  const strongConnector = /( y luego | y despu[eé]s | y tambi[eé]n | y adem[aá]s )/i.test(lower)
  const reminder = /\b(?:recu[eé]rdame|acu[eé]rdame|acordame|av[ií]same|recordame)\b/i.test(lower)
  if (strongConnector && reminder) return true
  return false
}


export { detectComplexInput, isClarificationReply, detectVeryComplexInput }
// Retired routing snapshot, retained only for historical migration regressions.
// Production uses novaRuntime.selectNovaRoutes and atomic admission.
function detectComplexInput(text) {
  if (typeof text !== 'string') return false
  const lower = text.toLowerCase()

  // 0) CONVERSACIÓN ABIERTA / ESTADO HUMANO. Estos mensajes NO son
  //    comandos — son desahogue/consejo/reflexión. Haiku tiende a
  //    convertirlos en eventos erróneos ("Estoy colapsado" → evento
  //    "Saturación"). Sonnet entiende el matiz humano y devuelve
  //    mode="chat_only". Introducido 2026-05-15 con el refactor
  //    intent-classification.
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

  // 0b) CORRECCIONES / EDICIONES. Verbos que indican que el user está
  //     ajustando un evento existente (no creando). Haiku a veces falla
  //     resolviéndolo contra "Eventos actuales" — Sonnet lo hace mejor.
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

  // 1) Conectores fuertes = casi seguro multi-acción.
  const strongHints = [
    ' y luego ', ' y después ', ' y despues ',
    ' luego ', ' después de eso ', ' despues de eso ',
    ' después ', ' despues ',
    ' también ', ' tambien ',
    ' además ', ' ademas ',
    ' más tarde ', ' mas tarde ',
    // Evento + recordatorio en la misma frase (caso real beta-12):
    // "mañana tengo doctor a las 5 y recuérdame llevar los exámenes" →
    // dos acciones. Sin esta pista, Haiku colapsaba a un solo add_event
    // con reminderNotes pegados. Cubrimos las 3 familias de triggers
    // (recuérdame/acuérdame/avísame) con y sin tilde, y los compuestos
    // "y no se me olvide / no te olvides".
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

  // 1b) Coexistencia evento + recordatorio SIN conector. Caso real:
  //     "tengo doctor a las 5 acuérdame llevar exámenes" (sin "y").
  //     Si la frase tiene a la vez un verbo de evento ("tengo/agenda/
  //     ponme/agéndame/voy a") Y un trigger de recordatorio, es multi.
  //     Una frase pura de recordatorio ("recuérdame X") no matchea
  //     porque no hay verbo de evento.
  const reminderTriggerRe = /\b(recu[eé]rdame|acu[eé]rdame|acordame|av[ií]same|recordame)\b/
  const eventVerbRe = /\b(tengo|tenemos|agenda|agendame|agéndame|agendarme|ag[eé]ndame|ponme|ponle|p[oó]neme|crea|cr[eé]ame|cr[ée]ame|reagenda|me\s+toca|tengo\s+que|voy\s+a)\b/
  if (reminderTriggerRe.test(lower) && eventVerbRe.test(lower)) {
    // Pero si el ÚNICO contenido es un trigger ("recuérdame llamar a mamá"),
    // no es multi: es una sola acción reminder. Filtramos: el trigger debe
    // aparecer separado del verbo de evento por ≥2 palabras (proxy de que
    // son cláusulas distintas).
    const tIdx = lower.search(reminderTriggerRe)
    const eIdx = lower.search(eventVerbRe)
    if (tIdx >= 0 && eIdx >= 0 && Math.abs(tIdx - eIdx) > 12) return true
  }

  // 2) Múltiples marcadores temporales (≥2 hits) — incluye palabras
  //    como "en una hora", "en dos horas".
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

  // 3) Comas con tiempo + texto razonablemente largo.
  if (text.length >= 70 && text.includes(',') && timeHits >= 1) return true

  // 4) Texto muy largo + algún conector implícito.
  if (text.length >= 120 && (lower.includes(' y ') || lower.includes(','))) return true

  return false
}

// Detecta si el turno actual del usuario es la respuesta a una pregunta de
// clarificación que Nova hizo en su turno anterior (ej. Nova preguntó "¿a qué
// hora?" / "¿de la mañana o de la noche?" y el usuario respondió "a las 3" /
// "de la noche"). En esos turnos el modelo debe reconstruir el contexto
// acumulado del hilo (evento + hora recién resuelta + preparativos) y emitir
// el add_event. Haiku lo hace de forma poco fiable —pierde el add_event o
// manda la preparación a una tarea suelta— así que los enrutamos a Sonnet,
// igual que los inputs multi-acción. El historial que llega aquí termina en el
// turno anterior (el mensaje actual viaja en `message`, no en `history`).
function isClarificationReply(history) {
  if (!Array.isArray(history) || history.length === 0) return false
  const last = history[history.length - 1]
  return last?.role === 'assistant'
    && typeof last.content === 'string'
    && /\?\s*$/.test(last.content.trim())
}

// ─── Router de modelos OpenAI por complejidad ───────────────────────────────
// nano (barato, el grueso del tráfico) → mini (complejo) → gpt-5.5 (difícil).
// El costo por mensaje baja mucho al mandar lo simple a nano. Reutiliza
// detectComplexInput/isClarificationReply. OPENAI_NOVA_MODEL fuerza un modelo
// único (kill-switch / debug) y desactiva router + escalada. Cada tier se puede
// sobreescribir con OPENAI_MODEL_NANO/MINI/HARD.
const OPENAI_TIER_MODELS = {
  nano: process.env.OPENAI_MODEL_NANO || 'gpt-5.4-nano',
  mini: process.env.OPENAI_MODEL_MINI || 'gpt-5.4-mini',
  hard: process.env.OPENAI_MODEL_HARD || 'gpt-5.5',
}
const OPENAI_TIER_EFFORT = { nano: 'low', mini: 'medium', hard: 'medium', forced: 'medium' }
const OPENAI_TIER_MAXTOK = { nano: 800, mini: 1024, hard: 1280, forced: 1024 }

function routeForTier(tier) {
  return {
    model: OPENAI_TIER_MODELS[tier],
    tier,
    effort: OPENAI_TIER_EFFORT[tier],
    maxOutputTokens: OPENAI_TIER_MAXTOK[tier],
  }
}

// "Muy complejo" = candidato al tier caro (gpt-5.5). Comparte vocabulario con
// detectComplexInput; solo dispara en lo REALMENTE enredado para no encarecer.
function detectVeryComplexInput(text) {
  if (typeof text !== 'string') return false
  const lower = text.toLowerCase()
  // ≥3 marcadores de hora = varios eventos encadenados.
  const timeRe = /(\ba la(?:s)?\s+\d{1,2}(?::\d{2})?\b|\ba la(?:s)?\s+(?:una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b|(?<!\d)\d{1,2}:\d{2}(?!\d)|\ben\s+(?:una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|\d{1,3})\s*(?:min|minutos?|h|hs|hrs?|horas?)\b)/gi
  const timeHits = (lower.match(timeRe) || []).length
  if (timeHits >= 3) return true
  // Muy largo → razonamiento pesado.
  if (text.length >= 200) return true
  // Conector fuerte + trigger de recordatorio a la vez = multi-cláusula pesada.
  const strongConnector = /( y luego | y despu[eé]s | y tambi[eé]n | y adem[aá]s )/i.test(lower)
  const reminder = /\b(?:recu[eé]rdame|acu[eé]rdame|acordame|av[ií]same|recordame)\b/i.test(lower)
  if (strongConnector && reminder) return true
  return false
}

// Elige {model, tier, effort, maxOutputTokens} para esta request.
function selectOpenAIModel(message, history) {
  const forced = process.env.OPENAI_NOVA_MODEL?.trim()
  if (forced) {
    return { model: forced, tier: 'forced', effort: OPENAI_TIER_EFFORT.forced, maxOutputTokens: OPENAI_TIER_MAXTOK.forced }
  }
  let tier
  if (detectVeryComplexInput(message)) tier = premiumFallbackEnabled() ? 'hard' : 'mini'
  else if (detectComplexInput(message) || isClarificationReply(history)) tier = 'mini'
  else tier = 'nano'
  return routeForTier(tier)
}

// ¿Tier premium (gpt-5.5) habilitado? Por defecto NO: en beta se enciende
// explícitamente con AI_ENABLE_PREMIUM_FALLBACK=true. Apagado, lo "muy
// complejo" va a mini (resuelve bien y cuesta ~7× menos) y la escalada por
// error termina en mini → Claude.
function premiumFallbackEnabled() {
  return String(process.env.AI_ENABLE_PREMIUM_FALLBACK || '').trim().toLowerCase() === 'true'
}

// ─── Router DeepSeek (proveedor principal barato, 2026-07-13) ───────────────
// flash para lo simple Y lo normal (el grueso del tráfico), pro solo para lo
// complejo (multi-instrucción, emocional, clarificaciones). El pro sigue
// siendo barato (~$0.004/mensaje pesado) — la palanca real de ahorro es que
// NADA va a GPT/Claude salvo fallback manual (AI_ENABLE_PROVIDER_FALLBACK).
const DEEPSEEK_TIER_MODELS = {
  cheap: process.env.DEEPSEEK_MODEL_CHEAP || process.env.AI_MODEL_CHEAP || 'deepseek-v4-flash',
  pro: process.env.DEEPSEEK_MODEL_PRO || process.env.AI_MODEL_MEDIUM || 'deepseek-v4-pro',
}
const DEEPSEEK_TIER_MAXTOK = { cheap: 800, pro: 1024, forced: 900 }

function deepseekRouteForTier(tier) {
  return {
    model: DEEPSEEK_TIER_MODELS[tier],
    tier,
    maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS) || DEEPSEEK_TIER_MAXTOK[tier],
  }
}

// Elige {model, tier, maxOutputTokens} para DeepSeek. DEEPSEEK_NOVA_MODEL
// fuerza un modelo único (kill-switch / debug) y desactiva router + escalada.
function selectDeepSeekModel(message, history) {
  const forced = process.env.DEEPSEEK_NOVA_MODEL?.trim()
  if (forced) {
    return { model: forced, tier: 'forced', maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS) || DEEPSEEK_TIER_MAXTOK.forced }
  }
  const complex = detectVeryComplexInput(message)
    || detectComplexInput(message)
    || isClarificationReply(history)
  return deepseekRouteForTier(complex ? 'pro' : 'cheap')
}

// Sube un tier (nano→mini→hard) para la escalada por error reintentable.
// Devuelve null si no hay tier superior disponible (premium apagado) —
// el caller cae al fallback Claude.
function escalateOpenAITier(route) {
  if (route.tier === 'nano') return routeForTier('mini')
  return premiumFallbackEnabled() ? routeForTier('hard') : null
}


export { detectComplexInput as __detectComplexInput }
export { isClarificationReply as __isClarificationReply }
export { detectVeryComplexInput as __detectVeryComplexInput }
export { selectOpenAIModel as __selectOpenAIModel }
export { escalateOpenAITier as __escalateOpenAITier }
export { selectDeepSeekModel as __selectDeepSeekModel }

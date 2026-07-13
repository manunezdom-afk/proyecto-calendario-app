import Anthropic from '@anthropic-ai/sdk'
import crypto from 'node:crypto'
import { rateLimited, clientIp } from './_lib/rateLimit.js'
import { buildWeatherContext, fetchWeather, describeWeatherCode } from './_lib/weather.js'
import { buildDateContext } from './_lib/dateContext.js'
import { buildSystemPrompt } from './_lib/systemPrompt.js'
import { safeParseAssistantJSON } from './_lib/neutralize.js'
import { normalizeNovaPersonality } from './_lib/personality.js'
import { rejectCrossSiteUnsafe, setCorsHeaders } from './_lib/security.js'
import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'
import { ACTION_TYPES, checkLimit, checkGlobalBudget, getUserPlan, recordUsage } from './_lib/usageLimits.js'
import { trackAIUsageEvent } from './_lib/aiUsageTracking.js'
import { filterCalendarEditActions, strippedEditMessage } from './_lib/calendarIntent.js'
import {
  buildOpenAISystemPrompt,
  callOpenAINova,
  extractResponsesText,
  convertOpenAIToBackendResponse,
} from './_lib/openaiNova.js'
import {
  buildDeepSeekJsonAppendix,
  callDeepSeekNova,
  extractDeepSeekText,
  normalizeDeepSeekPayload,
  estimateDeepSeekCostUSD,
} from './_lib/deepseekNova.js'

const MODEL_ID = 'claude-haiku-4-5-20251001'
// Sonnet 4.6 = fallback "premium" cuando Haiku falla en escenarios críticos
// (ediciones de calendario sin verbo explícito, JSON inválido tras reintento,
// truncation por max_tokens). Más caro pero solo se usa en ~3-8% de requests.
const FALLBACK_MODEL_ID = 'claude-sonnet-4-6'

// Reply de último recurso cuando Sonnet-directo no devuelve JSON válido (ni
// siquiera tras reintento). Lo declaramos una vez para (a) devolverlo y (b)
// filtrarlo del historial entrante: reenviar este texto al modelo lo desvía
// del formato JSON y genera más fallbacks en cadena (efecto bola de nieve).
const CHAINED_FALLBACK_REPLY = 'Tu mensaje tiene varias cosas encadenadas. Envíalas por separado para que las agende bien.'

// Necesario en Pro plan: por defecto Vercel mata la función a los 10s, lo
// cual era menor que el timeout de 25s del SDK de Anthropic — el handler
// moría sin responder y el cliente quedaba en "Focus está pensando…".
// En Hobby Vercel ignora valores >10s y mantiene 10s. En Pro respeta 60s.
export const maxDuration = 60

// Detector de complejidad — espejo aproximado del `isLikelyMultiAction`
// de iOS (`NovaResponder.swift`). Lo usamos en el server para enrutar
// frases con varias acciones DIRECTAMENTE a Sonnet, sin pasar primero
// por Haiku. Haiku tropezaba con "en una hora… en dos horas…": perdía
// acciones, concatenaba títulos. Sonnet razona mejor estos casos.
//
// Conservador: prefiere falsos positivos (rutear de más a Sonnet) sobre
// falsos negativos (dejar a Haiku con un input que romperá).
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

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS' })

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (rejectCrossSiteUnsafe(req, res)) return

  // Cinturón de seguridad #1: rate limit IP (defensa contra burst). El user
  // limit más fino llega después, una vez identificado el usuario.
  if (rateLimited(clientIp(req), { max: 30, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limit', message: 'Demasiadas solicitudes. Espera un momento.' })
  }

  // Auth obligatoria: sin Bearer válido devolvemos 401. Antes este endpoint
  // aceptaba requests sin sesión "para pruebas en iOS sin cuenta", pero eso
  // exponía la cuota de Anthropic a cualquiera que descubriera la URL — un
  // atacante podía vaciar el presupuesto de la API en minutos.
  const userId = await getUserIdFromAuth(req)
  if (!userId) {
    return res.status(401).json({
      error: 'auth_required',
      message: 'Inicia sesión para hablar con Nova.',
    })
  }

  // Modo alterno "today-context": cliente pide el JSON del Resumen ejecutivo
  // (ambient level + summary + weather tip + flags). Vive aquí y no como
  // /api/today-context independiente porque el plan Hobby de Vercel limita
  // a 12 serverless functions. Al consolidar liberamos un slot.
  if (req.body?.mode === 'today-context') {
    return handleTodayContext(req, res, userId)
  }

  // Cuota por plan: chequeamos nova_message ANTES de gastar tokens. La
  // verificación es read-only; el contador se incrementa después de que
  // Anthropic respondió OK, así un timeout o caída no quema cuota.
  const admin = getSupabaseAdmin()
  const plan = await getUserPlan(admin, userId)
  const messageCheck = await checkLimit(admin, userId, plan, ACTION_TYPES.NOVA_MESSAGE)
  if (!messageCheck.ok) {
    return res.status(429).json({
      error: 'quota_exceeded',
      action_type: messageCheck.action_type,
      plan: messageCheck.plan,
      period: messageCheck.period,
      used: messageCheck.used,
      limit: messageCheck.limit,
      reset_at: messageCheck.resetAt,
      message: messageCheck.message,
    })
  }

  // Pre-chequeo de smart actions: si no hay cuota, NO bloqueamos el chat
  // — el usuario puede seguir conversando — pero strippeamos las actions
  // del response para no aplicarlas. El frontend muestra un aviso amable.
  const smartCheck = await checkLimit(admin, userId, plan, ACTION_TYPES.NOVA_SMART_ACTION)
  const smartActionsBlocked = !smartCheck.ok

  // Corta-circuito de presupuesto global (tope de plata del dueño). Si el gasto
  // acumulado de IA supera AI_DAILY/MONTHLY_BUDGET_USD, NO llamamos a ningún
  // proveedor pago: devolvemos 503 ai_budget_reached → el cliente degrada al
  // parser local (sigue creando eventos simples, sin costo). Malla blanda; la
  // dura es el límite de gasto en el dashboard de OpenAI/Anthropic.
  const budget = await checkGlobalBudget(admin)
  if (!budget.ok) {
    console.warn(`[focus-assistant][${reqId}] presupuesto IA agotado (${budget.period}: $${budget.spent}/$${budget.budget})`)
    return res.status(503).json({
      error: 'ai_budget_reached',
      requestId: reqId,
      reply: budget.message,
      actions: [],
    })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  // Necesitamos AL MENOS un provider configurado. Antes exigíamos siempre
  // ANTHROPIC_API_KEY incluso para el path OpenAI — un setup OpenAI-only (o
  // un Anthropic key borrado en una reconfig) devolvía 503 y el cliente caía
  // al parser local en silencio (bug 2026-05-28).
  if (!apiKey && !(process.env.OPENAI_API_KEY?.trim()) && !(process.env.DEEPSEEK_API_KEY?.trim())) {
    return res.status(503).json({ error: 'no_api_key' })
  }

  const body = req.body || {}
  const { message, location = null, contacts = [], profile = null, behavior = null } = body

  // novaPersonality entra por el body — si el cliente es viejo o manda un
  // valor inválido, normalize() cae al default 'focus' sin romper la request.
  const novaPersonality = normalizeNovaPersonality(body.novaPersonality)

  if (!message?.trim()) return res.status(400).json({ error: 'no_message' })
  if (message.length > 4000) {
    return res.status(400).json({ error: 'message_too_long', message: 'Mensaje demasiado largo (máx 4000 caracteres).' })
  }

  const events = (Array.isArray(body.events) ? body.events : [])
    .filter(e => e && typeof e === 'object' && typeof e.title === 'string' && e.title.trim())
    .slice(0, 200)
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(h => h && typeof h === 'object' && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    // No reenviar al modelo el fallback "envíalas por separado": acumulado en
    // el historial desvía al modelo del formato y dispara más fallbacks.
    .filter(h => !(h.role === 'assistant' && h.content.trim() === CHAINED_FALLBACK_REPLY))
    .slice(-20)
  const memories = (Array.isArray(body.memories) ? body.memories : [])
    .filter(m => m && typeof m === 'object' && typeof m.content === 'string')
    .slice(0, 100)
  const tasks = (Array.isArray(body.tasks) ? body.tasks : [])
    .filter(t => t && typeof t === 'object' && typeof t.label === 'string' && t.label.trim())
    .slice(0, 200)

  const dateContext = buildDateContext(body.clientNow, body.clientTimezone)
  const weatherContext = await buildWeatherContext(location)

  // discussedEventIds: lista de event UUIDs en orden de recencia (más
  // reciente primero) — el cliente lo manda para que Nova resuelva
  // referencias implícitas ("acuérdame de X") al evento "en discusión"
  // sin preguntar a cuál se refiere. Defensivo: solo arrays de strings.
  const discussedEventIds = Array.isArray(body.discussedEventIds)
    ? body.discussedEventIds.filter(s => typeof s === 'string' && s.trim()).slice(0, 5)
    : []

  const systemPrompt = buildSystemPrompt({
    dateContext, weatherContext, contacts, profile, behavior, memories, events, tasks,
    novaPersonality, discussedEventIds,
  })

  // Request ID — trazabilidad end-to-end. Si el cliente mandó uno (header
  // X-Request-Id), lo respetamos; si no, generamos uno. Lo devolvemos en
  // el body para que iOS lo loguee en sus telemetrías. Sin PII.
  const reqId = (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim())
    || crypto.randomUUID()

  // Provider switch — 2026-07-13: DeepSeek es el proveedor principal (el más
  // barato). Prioridad: NOVA_PROVIDER (o su alias AI_PROVIDER_PRIMARY) >
  // autodetección por key disponible (deepseek > openai > anthropic).
  //
  // El cliente iOS NO conoce el provider — recibe el mismo shape de
  // respuesta gracias a los adapters (deepseekNova.js / openaiNova.js).
  const explicitProvider = (process.env.NOVA_PROVIDER || process.env.AI_PROVIDER_PRIMARY || '').toLowerCase().trim()
  const deepseekKeyAvailable = (process.env.DEEPSEEK_API_KEY?.trim()?.length || 0) > 0
  const openaiKeyAvailable = (process.env.OPENAI_API_KEY?.trim()?.length || 0) > 0
  const provider = explicitProvider
    || (deepseekKeyAvailable ? 'deepseek' : openaiKeyAvailable ? 'openai' : 'anthropic')

  // Memorias del usuario — el cliente las manda en `userMemories` (array
  // de strings humanas). Se inyectan al system prompt para que el LLM
  // pueda resolver referencias y NO repreguntar lo que ya sabe.
  const userMemories = Array.isArray(req?.body?.userMemories)
    ? req.body.userMemories.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 30)
    : []
  // Prompt compartido por los paths DeepSeek y OpenAI (mismo contrato JSON).
  const openaiPrompt = buildOpenAISystemPrompt({
    tz: dateContext.tz,
    todayISO: dateContext.todayISO,
    tomorrow: dateContext.tomorrow,
    dayAfter: dateContext.dayAfter,
    currentTime24: dateContext.currentTime24,
    weekDates: dateContext.weekDates,
    memories: userMemories,
    // Contexto de agenda (QA-closure 2026-06-10): sin esto el path
    // OpenAI no podía responder "qué tengo hoy", evitar duplicados,
    // anclar recordatorios al tema en discusión ni editar/borrar por id.
    events,
    tasks,
    discussedEventIds,
  })

  // ─── Path DeepSeek (proveedor principal) ──────────────────────────────────
  // Si DeepSeek falla del todo: por defecto NO se escala a GPT/Claude (eso
  // gasta plata sin permiso) — se devuelve 502 y el cliente degrada al parser
  // local visible. Con AI_ENABLE_PROVIDER_FALLBACK=true, cae al path OpenAI/
  // Claude de abajo como red de seguridad manual.
  let providerFellThrough = false
  if (provider === 'deepseek' && deepseekKeyAvailable) {
    const deepseekKey = process.env.DEEPSEEK_API_KEY.trim()
    const deepseekPrompt = openaiPrompt + buildDeepSeekJsonAppendix(dateContext.todayISO)

    // Un intento con `route`: llama, parsea, normaliza, convierte, filtra
    // ediciones y registra SU PROPIO evento de costo (cache-aware).
    const runDeepSeek = async (route) => {
      const start = Date.now()
      const data = await callDeepSeekNova({
        message,
        systemPrompt: deepseekPrompt,
        model: route.model,
        apiKey: deepseekKey,
        reqId,
        history,
        maxOutputTokens: route.maxOutputTokens,
      })
      let parsed
      try {
        parsed = JSON.parse(extractDeepSeekText(data))
      } catch (e) {
        const err = new Error(`DeepSeek ${route.tier} bad JSON/empty: ${e.message}`)
        err.retriable = true
        throw err
      }
      const mapped = convertOpenAIToBackendResponse({
        openaiPayload: normalizeDeepSeekPayload(parsed),
        dateContext,
        message,
        reqId,
        events,
      })
      // Misma red server-side que los otros paths: ediciones/borrados solo
      // con verbo explícito. Scope = último turno del usuario + mensaje.
      const lastUserTurn = [...history].reverse().find(h => h.role === 'user')?.content || ''
      const editFilter = filterCalendarEditActions(mapped.actions, `${lastUserTurn}\n${message}`)
      if (editFilter.stripped.length > 0) {
        console.warn(
          `[focus-assistant][${reqId}] DeepSeek(${route.tier}) stripped edits without intent:`,
          editFilter.stripped.map(a => a.type).join(','),
        )
        mapped.actions = editFilter.actions
        const note = strippedEditMessage(editFilter.stripped)
        mapped.reply = `${mapped.reply || ''}${mapped.reply ? '\n\n' : ''}${note}`
      }
      trackAIUsageEvent({
        admin,
        userId,
        action_type: ACTION_TYPES.NOVA_MESSAGE,
        endpoint: 'focus-assistant',
        model: data?.model || route.model || 'deepseek',
        usage: {
          input_tokens: data?.usage?.prompt_tokens ?? 0,
          output_tokens: data?.usage?.completion_tokens ?? 0,
        },
        // Costo cache-aware (hit $0.0028/1M vs miss $0.14/1M): más preciso
        // que la tarifa plana de aiPricing. null → cae al pricing genérico.
        cost_override_usd: estimateDeepSeekCostUSD(data?.model || route.model, data?.usage),
        success: true,
        duration_ms: Date.now() - start,
        metadata: { plan, provider: 'deepseek', tier: route.tier, request_id: reqId, dropped: mapped._dropped?.length || 0 },
      }).catch(() => {})
      return mapped
    }

    const isWeakDeepSeekResult = (mapped) =>
      (typeof mapped?.confidence === 'number' && mapped.confidence < 0.55) ||
      (mapped?.mode === 'clarification' && (mapped.actions?.length || 0) === 0 && (mapped._dropped?.length || 0) > 0)

    try {
      let route = selectDeepSeekModel(message, history)
      let mapped
      try {
        mapped = await runDeepSeek(route)
        // flash flojo → UN reintento en pro (sigue siendo barato).
        if (route.tier === 'cheap' && isWeakDeepSeekResult(mapped)) {
          console.log(`[focus-assistant][${reqId}] deepseek flash débil (conf ${mapped.confidence}) → reintento en pro`)
          route = deepseekRouteForTier('pro')
          mapped = await runDeepSeek(route)
        }
      } catch (attemptErr) {
        // JSON malo/vacío en flash → UNA escalada a pro. En pro (o forced) no
        // hay tier superior: lanza al catch externo.
        if (attemptErr?.retriable && route.tier === 'cheap') {
          route = deepseekRouteForTier('pro')
          console.log(`[focus-assistant][${reqId}] deepseek flash falló → escala a pro`)
          mapped = await runDeepSeek(route)
        } else {
          throw attemptErr
        }
      }

      if (smartActionsBlocked && mapped.actions.length > 0) {
        const allowed = mapped.actions.filter(a => a.type === 'remember')
        mapped.actions = allowed
        mapped.smart_actions_blocked = true
        mapped.smart_actions_message = smartCheck.message
      }
      Promise.resolve()
        .then(() => recordUsage(admin, userId, ACTION_TYPES.NOVA_MESSAGE))
        .then(() => mapped.actions.length > 0
          ? recordUsage(admin, userId, ACTION_TYPES.NOVA_SMART_ACTION)
          : null)
        .catch(() => {})

      if (mapped._dropped && mapped._dropped.length > 0) {
        console.warn(`[focus-assistant][${reqId}] DeepSeek dropped ${mapped._dropped.length}:`, mapped._dropped.join(' | '))
      }
      delete mapped._dropped
      return res.status(200).json(mapped)
    } catch (err) {
      const status = err?.status || 500
      const fallbackEnabled = String(process.env.AI_ENABLE_PROVIDER_FALLBACK || '').trim().toLowerCase() === 'true'
      const canFallThrough = fallbackEnabled && (openaiKeyAvailable || !!apiKey)
      console.error(`[focus-assistant][${reqId}] DeepSeek call failed (${status}): ${err?.message?.slice(0, 200)}${canFallThrough ? ' — fallback a OpenAI/Claude' : ' — sin fallback pago (AI_ENABLE_PROVIDER_FALLBACK off)'}`)
      trackAIUsageEvent({
        admin,
        userId,
        action_type: ACTION_TYPES.NOVA_MESSAGE,
        endpoint: 'focus-assistant',
        model: 'deepseek',
        usage: { input_tokens: 0, output_tokens: 0 },
        success: false,
        error_type: `http_${status}`,
        metadata: { plan, provider: 'deepseek', request_id: reqId },
      }).catch(() => {})
      if (!canFallThrough) {
        if (status === 401 || status === 403) {
          return res.status(503).json({ error: 'invalid_deepseek_key', requestId: reqId, message: 'Provider DeepSeek no autorizado.' })
        }
        if (status === 402) {
          // 402 = sin saldo en DeepSeek. Mensaje honesto para el dueño.
          return res.status(503).json({ error: 'deepseek_no_balance', requestId: reqId, reply: 'Nova está descansando (sin saldo del proveedor). Puedes seguir creando eventos a mano.', actions: [] })
        }
        if (status === 429) {
          return res.status(429).json({ error: 'upstream_rate_limit', requestId: reqId, message: 'Demasiadas solicitudes al proveedor. Espera un momento.' })
        }
        return res.status(502).json({
          error: 'upstream_error',
          requestId: reqId,
          reply: 'Tuve un problema con Nova. Vuelve a intentarlo.',
          actions: [],
        })
      }
      providerFellThrough = true  // sigue al path OpenAI (si hay key) o Claude
    }
  }

  if ((provider === 'openai' || (providerFellThrough && openaiKeyAvailable)) && process.env.OPENAI_API_KEY?.trim()) {
    const openaiKey = process.env.OPENAI_API_KEY.trim()
    // ── Router + escalada de tiers (nano→mini→gpt-5.5) ─────────────────────
    // runOpenAI ejecuta UN intento con `route`: llama al modelo, parsea,
    // convierte y filtra ediciones. Registra su PROPIO evento de costo (cada
    // intento cuenta con su tier/modelo). Lanza si el intento falla (JSON
    // malo/truncado, HTTP error) para que el caller decida escalar o caer a Claude.
    const runOpenAI = async (route) => {
      const start = Date.now()
      const data = await callOpenAINova({
        message,
        systemPrompt: openaiPrompt,
        model: route.model,
        apiKey: openaiKey,
        reqId,
        history,  // turnos previos del chat (ya viene parseado arriba)
        reasoningEffort: route.effort,
        maxOutputTokens: route.maxOutputTokens,
      })
      let parsed
      try {
        parsed = JSON.parse(extractResponsesText(data))
      } catch (e) {
        // JSON inválido o truncado (tope de tokens) → reintentable: el caller
        // sube de tier antes de caer a Claude.
        const err = new Error(`OpenAI ${route.tier} bad JSON/truncated: ${e.message}`)
        err.retriable = true
        throw err
      }
      const mapped = convertOpenAIToBackendResponse({
        openaiPayload: parsed,
        userMessage: message,
        history,
        reqId,
        events,
      })
      // Misma red server-side que el path Anthropic: ediciones/borrados solo
      // con verbo explícito. Scope = último turno del usuario + mensaje actual.
      const lastUserTurn = [...history].reverse().find(h => h.role === 'user')?.content || ''
      const editFilter = filterCalendarEditActions(mapped.actions, `${lastUserTurn}\n${message}`)
      if (editFilter.stripped.length > 0) {
        console.warn(
          `[focus-assistant][${reqId}] OpenAI(${route.tier}) stripped edits without intent:`,
          editFilter.stripped.map(a => a.type).join(','),
        )
        mapped.actions = editFilter.actions
        const note = strippedEditMessage(editFilter.stripped)
        mapped.reply = `${mapped.reply || ''}${mapped.reply ? '\n\n' : ''}${note}`
      }
      // Costo por intento (cada tier registra su propia fila con su modelo).
      trackAIUsageEvent({
        admin,
        userId,
        action_type: ACTION_TYPES.NOVA_MESSAGE,
        endpoint: 'focus-assistant',
        model: data?.model || route.model || 'openai',
        usage: {
          input_tokens: data?.usage?.input_tokens ?? data?.usage?.prompt_tokens ?? 0,
          output_tokens: data?.usage?.output_tokens ?? data?.usage?.completion_tokens ?? 0,
          source: 'openai',
        },
        success: true,
        duration_ms: Date.now() - start,
        metadata: { plan, provider: 'openai', tier: route.tier, request_id: reqId, dropped: mapped._dropped?.length || 0 },
      }).catch(() => {})
      return mapped
    }

    // ¿Resultado "débil"? (confianza baja, o schema-válido pero todo cayó como
    // basura). Solo decide un reintento barato nano→mini.
    const isWeakOpenAIResult = (mapped) =>
      (typeof mapped?.confidence === 'number' && mapped.confidence < 0.55) ||
      (mapped?.mode === 'clarification' && (mapped.actions?.length || 0) === 0 && (mapped._dropped?.length || 0) > 0)

    // Tope por-usuario de gpt-5.5: cada request al tier 'hard' consume cuota
    // nova_premium_message (misma que la escalada a Sonnet). Sin cuota →
    // degrada a mini en silencio (mini resuelve bien y cuesta ~7× menos).
    // Devuelve null si ni siquiera mini aplica (caller decide).
    const gatePremiumTier = async (route) => {
      if (route?.tier !== 'hard') return route
      const premiumCheck = await checkLimit(admin, userId, plan, ACTION_TYPES.NOVA_PREMIUM_MESSAGE)
      if (premiumCheck.ok) return route
      console.warn(`[focus-assistant][${reqId}] cuota premium agotada (${premiumCheck.used}/${premiumCheck.limit}) → degrada hard→mini`)
      return routeForTier('mini')
    }

    try {
      let route = await gatePremiumTier(selectOpenAIModel(message, history))
      let mapped
      try {
        mapped = await runOpenAI(route)
        // Escalada barata: nano flojo → reintenta UNA vez en mini.
        if (route.tier === 'nano' && isWeakOpenAIResult(mapped)) {
          console.log(`[focus-assistant][${reqId}] nano débil (conf ${mapped.confidence}) → reintento en mini`)
          route = routeForTier('mini')
          mapped = await runOpenAI(route)
        }
      } catch (attemptErr) {
        // Error reintentable (JSON malo/truncado) y no estamos en el tier tope
        // → sube un tier antes de rendirse. 401/403/429/timeout NO son
        // reintentables acá: caen al catch externo (→ Claude). La subida a
        // 'hard' respeta premium apagado (null) y la cuota por-usuario: si
        // el gate la degrada al MISMO tier que ya falló, no reintentamos.
        let upped = attemptErr?.retriable && route.tier !== 'hard'
          ? await gatePremiumTier(escalateOpenAITier(route))
          : null
        if (upped && upped.tier !== route.tier) {
          console.log(`[focus-assistant][${reqId}] ${route.tier} falló → escala a ${upped.tier}`)
          route = upped
          mapped = await runOpenAI(route)  // si esto lanza → catch externo → Claude
        } else {
          throw attemptErr
        }
      }

      // Mismo enforcement de cuota que Anthropic: si actions ≠ vacío,
      // contamos NOVA_SMART_ACTION; si smartActionsBlocked, las strippeamos.
      if (smartActionsBlocked && mapped.actions.length > 0) {
        const allowed = mapped.actions.filter(a => a.type === 'remember')
        mapped.actions = allowed
        mapped.smart_actions_blocked = true
        mapped.smart_actions_message = smartCheck.message
      }
      Promise.resolve()
        .then(() => recordUsage(admin, userId, ACTION_TYPES.NOVA_MESSAGE))
        .then(() => mapped.actions.length > 0
          ? recordUsage(admin, userId, ACTION_TYPES.NOVA_SMART_ACTION)
          : null)
        // gpt-5.5 consume cuota premium (misma que la escalada a Sonnet):
        // así el tope diario por-usuario de nova_premium_message aplica igual
        // para ambos proveedores.
        .then(() => route.tier === 'hard'
          ? recordUsage(admin, userId, ACTION_TYPES.NOVA_PREMIUM_MESSAGE)
          : null)
        .catch(() => {})

      if (mapped._dropped && mapped._dropped.length > 0) {
        console.warn(`[focus-assistant][${reqId}] OpenAI dropped ${mapped._dropped.length}:`, mapped._dropped.join(' | '))
      }
      // No exponer `_dropped` al cliente (es solo para telemetría server-side).
      delete mapped._dropped
      return res.status(200).json(mapped)
    } catch (err) {
      const status = err?.status || 500
      const canFallbackToClaude = !!apiKey
      console.error(`[focus-assistant][${reqId}] OpenAI call failed (${status}): ${err?.message?.slice(0, 200)}${canFallbackToClaude ? ' — fallback a Claude' : ''}`)
      // RED DE SEGURIDAD (2026-05-28): si OpenAI falla (key inválida tras
      // rotarla, modelo inaccesible, schema rechazado, timeout…) y hay
      // ANTHROPIC_API_KEY, NO devolvemos error — caemos al path Claude de
      // abajo (sin return). Así Nova sigue siendo una IA real (mundo +
      // razonamiento) en vez de degradar al parser local tonto. El usuario
      // reportó "sigue local pese a estar logueado": era exactamente esto —
      // OpenAI fallaba en silencio y el cliente caía al parser determinista.
      if (!canFallbackToClaude) {
        if (status === 401 || status === 403) {
          return res.status(503).json({ error: 'invalid_openai_key', requestId: reqId, message: 'Provider OpenAI no autorizado.' })
        }
        if (status === 429) {
          return res.status(429).json({ error: 'upstream_rate_limit', requestId: reqId, message: 'Demasiadas solicitudes a OpenAI. Espera un momento.' })
        }
        return res.status(502).json({
          error: 'upstream_error',
          requestId: reqId,
          reply: 'Tuve un problema con Nova. Vuelve a intentarlo.',
          actions: [],
        })
      }
      // canFallbackToClaude === true: no return → sigue al bloque Anthropic.
    }
  }

  // Timeout del SDK 45s para aprovechar maxDuration=60s sin agotarlo. Antes
  // estaba en 25s pero competía con el corte default de Vercel a los 10s,
  // lo que dejaba al cliente colgado en "Focus está pensando…" sin error.
  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 })

  // Scope para detectar intención de edición: mensaje actual + último turno
  // del usuario. En continuaciones ("cambia lo de fútbol" → "¿a qué hora?" →
  // "a las 6") el verbo de edición vive en el turno anterior; con solo
  // `message` el filtro strippeaba la edición legítima y Nova respondía la
  // nota técnica "No moví ni edité…". El path OpenAI ya usaba este scope.
  const lastUserTurnText = [...history].reverse().find(h => h.role === 'user')?.content || ''
  const editIntentScope = `${lastUserTurnText}\n${message}`
  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ]

  // runClaude — modelId opcional permite escalar a Sonnet sin duplicar lógica.
  // Cuando se llama con FALLBACK_MODEL_ID, action_type pasa a NOVA_PREMIUM_MESSAGE
  // así ai_usage_events distingue claramente las escalaciones del flujo normal.
  async function runClaude(extra = '', attempt = 1, modelId = MODEL_ID) {
    const isPremium = modelId === FALLBACK_MODEL_ID
    const actionType = isPremium ? ACTION_TYPES.NOVA_PREMIUM_MESSAGE : ACTION_TYPES.NOVA_MESSAGE
    const extraMsgs = extra ? [{ role: 'user', content: extra }] : []
    const start = Date.now()
    let response
    try {
      response = await anthropic.messages.create({
        model: modelId,
        // 2048 (subimos desde 1500 el 2026-05-12): el prompt nuevo manda
        // emitir múltiples add_event para frases compuestas tipo "en una
        // hora X, en dos horas Y, a las 12 Z". Con 1500 Haiku truncaba
        // a veces JSON con 3 acciones + reply + confirmaciones. 2048 da
        // margen sin disparar mucho el costo (~3-5% más por request).
        max_tokens: 2048,
        system: systemPrompt,
        messages: [...messages, ...extraMsgs],
      })
    } catch (err) {
      // Registrar el intento fallido también — sin tokens (Anthropic no los
      // devolvió). Útil para distinguir "modelo cayó" de "no se llamó nunca".
      trackAIUsageEvent({
        admin,
        userId,
        action_type: actionType,
        endpoint: 'focus-assistant',
        model: modelId,
        usage: { input_tokens: 0, output_tokens: 0, source: 'unavailable' },
        success: false,
        error_type: err?.name || 'upstream_error',
        duration_ms: Date.now() - start,
        metadata: { plan, retry_attempt: attempt, premium_escalated: isPremium },
      }).catch(() => {})
      throw err
    }
    // Tracking granular del costo real de esta llamada al modelo.
    trackAIUsageEvent({
      admin,
      userId,
      action_type: actionType,
      endpoint: 'focus-assistant',
      model: response?.model || modelId,
      anthropicResponse: response,
      success: true,
      duration_ms: Date.now() - start,
      metadata: { plan, retry_attempt: attempt, premium_escalated: isPremium },
    }).catch(() => {})
    return response
  }

  // Detecta si un response de Haiku necesita escalarse a Sonnet:
  // - hit max_tokens (truncation)
  // - output cerca del límite (~87% de max_tokens — riesgo de respuesta cortada)
  // - filterCalendarEditActions strippeó acciones (Haiku quería editar sin
  //   intent explícito, Sonnet con prompt refinado debería dar mejor add_event)
  function shouldEscalateToSonnet(response, strippedCount) {
    if (response?.stop_reason === 'max_tokens') return true
    const outputTokens = response?.usage?.output_tokens || 0
    // 1780 ≈ 87% de 2048. Antes era 1300 ≈ 87% de 1500.
    if (outputTokens > 1780) return true
    if (strippedCount > 0) return true
    return false
  }

  // Reintenta con Sonnet cuando Haiku tropezó. Mensaje de refuerzo recuerda
  // las reglas duras del system prompt (no editar sin verbo, fecha=hoy si solo
  // hay hora). El user message original sigue en `messages`.
  async function escalateToSonnet() {
    return runClaude(
      'IMPORTANTE: tu respuesta anterior con Haiku falló o emitió ediciones sin que el usuario lo pidiera. Reintenta siguiendo ESTAS REGLAS DURAS:\n' +
        '1) NUNCA uses edit_event/update_event/delete_event a menos que el usuario haya escrito un verbo explícito de edición (mueve, cambia, edita, modifica, reagenda, pásalo, corre, adelanta, atrasa, borra, elimina, cancela, quita).\n' +
        '2) Si el usuario menciona hora sin fecha, date=hoy (sin importar si la hora ya pasó). Si quería otro día, lo dirá ("mañana", "viernes").\n' +
        '3) Eventos similares de OTRO DÍA NO bloquean creación nueva — son eventos distintos.\n' +
        '4) Si dudas entre crear y editar, SIEMPRE elige add_event.\n' +
        '5) Cierra todas las llaves del JSON; sin texto fuera del objeto.',
      1,
      FALLBACK_MODEL_ID,
    )
  }

  // Procesa la respuesta del modelo, aplica enforcement de smart_action y
  // contabiliza nova_message (+ nova_premium_message si hubo escalación).
  function finalize(parsed, { escalated = false } = {}) {
    const out = parsed && typeof parsed === 'object' ? { ...parsed } : { reply: '', actions: [] }
    let actions = Array.isArray(out.actions) ? out.actions : []

    // Defensa server-side contra ediciones no pedidas (BLOQUE C).
    // Si el usuario NO usó verbos explícitos de edición ("mueve", "cambia",
    // "edita", "borra", etc), strippeamos cualquier edit_event /
    // update_event / delete_event que el modelo haya emitido — el system
    // prompt ya tiene la regla, esto es la red. El scope incluye el último
    // turno del usuario (continuaciones post-clarificación).
    const editFilter = filterCalendarEditActions(actions, editIntentScope)
    if (editFilter.stripped.length > 0) {
      console.warn(
        '[focus-assistant] stripped edit actions without explicit intent:',
        editFilter.stripped.map(a => a.type).join(','),
      )
      const note = strippedEditMessage(editFilter.stripped)
      out.reply = `${out.reply || ''}${out.reply ? '\n\n' : ''}${note}`
      actions = editFilter.actions
      out.actions = actions
    }

    // Si las smart_actions están bloqueadas por cuota: stripeamos las
    // acciones (excepto 'remember' que es transparente y barata) y avisamos
    // al usuario al final del reply para que sepa por qué Nova no actuó.
    let appliedSmartAction = false
    if (smartActionsBlocked && actions.length > 0) {
      const allowed = actions.filter(a => a?.type === 'remember')
      const stripped = actions.length - allowed.length
      out.actions = allowed
      if (stripped > 0) {
        out.smart_actions_blocked = true
        out.smart_actions_message = smartCheck.message
        const note = `\n\n_${smartCheck.message}_`
        out.reply = `${out.reply || ''}${out.reply ? note : smartCheck.message}`
      }
    } else if (actions.length > 0) {
      // Hay acciones reales (excluyendo solo-memoria): sí cuenta como smart_action.
      const realActions = actions.filter(a => a?.type !== 'remember')
      appliedSmartAction = realActions.length > 0
    }

    // Fire-and-forget: no esperamos a que termine el upsert para responder.
    // Si falla, el usuario tuvo su respuesta y el contador queda como está
    // (peor caso: pierde +1 contra sí mismo si la próxima llamada lo cuenta).
    // Cuando hubo escalación a Sonnet, también incrementamos NOVA_PREMIUM_MESSAGE
    // para que las cuotas de la cohort beta puedan verlo separado.
    Promise.resolve()
      .then(() => recordUsage(admin, userId, ACTION_TYPES.NOVA_MESSAGE))
      .then(() => appliedSmartAction
        ? recordUsage(admin, userId, ACTION_TYPES.NOVA_SMART_ACTION)
        : null)
      .then(() => escalated
        ? recordUsage(admin, userId, ACTION_TYPES.NOVA_PREMIUM_MESSAGE)
        : null)
      .catch(() => {})

    // Adjuntamos requestId para trazabilidad e2e (iOS lo loguea sin PII).
    out.requestId = reqId
    return res.status(200).json(out)
  }

  try {
    // PASO 0 — Detector de complejidad. Frases con varias acciones,
    // conectores fuertes ("luego", "después", "y"), o múltiples
    // referencias temporales (incluyendo palabras como "en una hora")
    // necesitan razonamiento más fino. Haiku tropezaba con esos casos
    // (concatenaba títulos, perdía acciones). Para esos vamos directo
    // a Sonnet — ~10% más caro pero MUY mejor en estructura.
    const clarificationReply = isClarificationReply(history)
    const isComplexInput = detectComplexInput(message) || clarificationReply
    if (isComplexInput) {
      console.log(`[focus-assistant] ${clarificationReply ? 'clarification reply' : 'complex input'} → Sonnet directly`)
      try {
        const dDirect = await runClaude('', 1, FALLBACK_MODEL_ID)
        const rDirect = (dDirect.content?.[0]?.text ?? '').trim()
        try {
          const parsedDirect = safeParseAssistantJSON(rDirect)
          return finalize(parsedDirect, { escalated: true })
        } catch {
          // Sonnet devolvió JSON inválido. Suele pasar con historiales largos o
          // repetitivos que lo desvían del formato. Antes nos rendíamos aquí
          // con "envíalas por separado" (falso negativo molesto). Reintentamos
          // UNA vez con un refuerzo de formato — el path con Haiku ya reintenta
          // y escala; esta rama era la única sin red.
          console.warn('[focus-assistant] Sonnet (direct) JSON inválido — reintentando con refuerzo de formato')
          try {
            const dRetry = await runClaude(
              'Tu respuesta anterior NO fue JSON válido. Devuelve EXCLUSIVAMENTE el objeto JSON del schema (empieza con "{" y termina con "}"), sin texto fuera del objeto y con todas las llaves cerradas.',
              2,
              FALLBACK_MODEL_ID,
            )
            const rRetry = (dRetry.content?.[0]?.text ?? '').trim()
            const parsedRetry = safeParseAssistantJSON(rRetry)
            return finalize(parsedRetry, { escalated: true })
          } catch {
            console.error('[focus-assistant] Sonnet (direct) JSON inválido tras reintento')
            recordUsage(admin, userId, ACTION_TYPES.NOVA_PREMIUM_MESSAGE).catch(() => {})
            return res.status(200).json({
              reply: CHAINED_FALLBACK_REPLY,
              confidence: 0,
              shouldAskUser: true,
              actions: [],
            })
          }
        }
      } catch (err) {
        // Sonnet API falló — re-throw para que el catch general formatee.
        throw err
      }
    }

    // PASO 1 — Haiku (modelo barato, cubre 90%+ de los requests SIMPLES).
    const d1 = await runClaude('', 1)
    const r1 = (d1.content?.[0]?.text ?? '').trim()
    let parsed
    try {
      parsed = safeParseAssistantJSON(r1)
    } catch {
      // PASO 2a — JSON inválido: reintenta directamente con Sonnet (Path B).
      try {
        const dPremium = await escalateToSonnet()
        const rPremium = (dPremium.content?.[0]?.text ?? '').trim()
        return finalize(safeParseAssistantJSON(rPremium), { escalated: true })
      } catch {
        console.error('[focus-assistant] JSON parse failed after Sonnet escalation')
        recordUsage(admin, userId, ACTION_TYPES.NOVA_MESSAGE).catch(() => {})
        return res.status(502).json({
          error: 'llm_bad_output',
          reply: 'No pude procesar la respuesta. Repite el mensaje, por favor.',
          actions: [],
        })
      }
    }

    // PASO 2b — Haiku parseó OK pero ¿la respuesta es de calidad suficiente?
    // Detectamos signals de "esto va a salir mal" (ediciones strippeadas,
    // truncation, confidence baja) y escalamos a Sonnet con prompt refinado.
    const haikuActions = Array.isArray(parsed?.actions) ? parsed.actions : []
    const preFilter = filterCalendarEditActions(haikuActions, editIntentScope)
    const haikuConfidence = typeof parsed?.confidence === 'number' ? parsed.confidence : 1.0
    const escalateNeeded =
      shouldEscalateToSonnet(d1, preFilter.stripped.length) ||
      haikuConfidence < 0.55

    if (escalateNeeded) {
      try {
        const dPremium = await escalateToSonnet()
        const rPremium = (dPremium.content?.[0]?.text ?? '').trim()
        const parsedPremium = safeParseAssistantJSON(rPremium)
        return finalize(parsedPremium, { escalated: true })
      } catch {
        console.warn('[focus-assistant] Sonnet escalation failed, falling back to Haiku response')
        return finalize(parsed, { escalated: false })
      }
    }

    return finalize(parsed, { escalated: false })
  } catch (err) {
    const status = err?.status || err?.response?.status
    if (status === 401) {
      console.error('[focus-assistant] upstream auth failure')
      return res.status(503).json({ error: 'invalid_api_key', message: 'Servicio temporalmente no disponible.' })
    }
    if (status === 429) {
      console.error('[focus-assistant] upstream rate limit')
      return res.status(429).json({ error: 'upstream_rate_limit', message: 'Demasiadas solicitudes. Prueba en unos segundos.' })
    }
    if (status === 529 || status === 503) {
      console.error('[focus-assistant] upstream overloaded')
      return res.status(503).json({ error: 'upstream_overloaded', message: 'El servicio está sobrecargado. Intenta de nuevo.' })
    }
    if (err?.name === 'AbortError' || /timeout/i.test(err?.message || '')) {
      console.error('[focus-assistant] timeout')
      return res.status(504).json({ error: 'timeout', message: 'La respuesta tardó demasiado. Intenta otra vez.' })
    }
    // Loggeamos el tipo de error sin el stack completo: evita filtrar datos
    // serializados en el message del SDK.
    console.error('[focus-assistant] unexpected:', err?.name || 'Error', status || '')
    return res.status(500).json({ error: 'internal_error', message: 'Error interno. Reintenta en un momento.' })
  }
}

// ── Today Context ─────────────────────────────────────────────────────────
// Cerebro del Ambient Pulse y el Resumen ejecutivo. Devuelve un único JSON:
//   { ambient: 'low'|'medium'|'high',
//     summary: string,
//     weather: string|null,
//     flags: { urgentEvent, meetingsBackToBack, actionableInsight, freeHours } }
//
// Vive en focus-assistant.js (no como endpoint propio) porque Vercel Hobby
// limita a 12 serverless functions y ya estábamos en el tope.

const TODAY_CTX_WEATHER_CACHE = new Map()
const TODAY_CTX_WEATHER_TTL_MS = 30 * 60 * 1000

async function handleTodayContext(req, res, userId) {
  const { todayISO, tomorrowISO, location = null, clientNow = Date.now() } = req.body ?? {}
  if (!todayISO || typeof todayISO !== 'string') {
    return res.status(400).json({ error: 'missing_today_iso' })
  }

  const supa = getSupabaseAdmin()
  if (!supa) return res.status(503).json({ error: 'service_unavailable' })

  const { data: todayRows } = await supa
    .from('events')
    .select('id, title, time, date, section')
    .eq('user_id', userId)
    .eq('date', todayISO)
    .order('time', { ascending: true })
  const { data: tmwRows } = await supa
    .from('events')
    .select('id, title, time, date')
    .eq('user_id', userId)
    .eq('date', tomorrowISO)
    .limit(1)

  const todayEvents = (todayRows ?? []).filter((e) => e.time)
  const firstTomorrow = (tmwRows ?? [])[0] ?? null

  let weatherSummary = null
  let weatherTip = null
  if (location?.lat && location?.lon) {
    const cached = TODAY_CTX_WEATHER_CACHE.get(userId)
    let weather = cached && Date.now() - cached.at < TODAY_CTX_WEATHER_TTL_MS ? cached.data : null
    if (!weather) {
      try {
        weather = await fetchWeather(location.lat, location.lon)
        TODAY_CTX_WEATHER_CACHE.set(userId, { at: Date.now(), data: weather })
      } catch {
        // ignore
      }
    }
    if (weather?.current) {
      const code = weather.current.weather_code
      weatherSummary = `${describeWeatherCode(code)}, ${Math.round(weather.current.temperature_2m)}°C`
      weatherTip = humanizeTodayWeather(weather, todayEvents)
    }
  }

  const analysis = analyzeTodayDay(todayEvents, firstTomorrow, clientNow)

  let ambient = 'low'
  const flags = {
    urgentEvent: analysis.urgentEvent,
    meetingsBackToBack: analysis.backToBack,
    actionableInsight: !!weatherTip,
    freeHours: analysis.qualityHoursLeft,
  }
  if (analysis.urgentEvent) ambient = 'high'
  else if (analysis.backToBack || weatherTip) ambient = 'medium'

  const summary = buildTodaySummary({
    todayEvents, analysis, hour: new Date(clientNow).getHours(),
  })

  return res.json({
    ambient,
    summary,
    weather: weatherTip ?? weatherSummary,
    flags,
  })
}

function todayCtxTimeToMin(t) {
  const m = String(t).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function analyzeTodayDay(events, firstTomorrow, nowMs) {
  const now = new Date(nowMs)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const dayEnd = 23 * 60

  const upcoming = events
    .map((e) => ({ ...e, mins: todayCtxTimeToMin(e.time) }))
    .filter((e) => e.mins != null && e.mins >= nowMin)
    .sort((a, b) => a.mins - b.mins)

  const nextEvent = upcoming[0] ?? null
  const minsUntilNext = nextEvent ? nextEvent.mins - nowMin : null
  const urgentEvent = minsUntilNext != null && minsUntilNext <= 15 && minsUntilNext > 0

  let backToBack = false
  if (upcoming.length >= 3) {
    let chain = 1
    for (let i = 1; i < upcoming.length; i++) {
      const gap = upcoming[i].mins - upcoming[i - 1].mins
      if (gap < 20) {
        chain++
        if (chain >= 3) { backToBack = true; break }
      } else {
        chain = 1
      }
    }
  }

  const ceil = nextEvent ? Math.min(nextEvent.mins, dayEnd) : dayEnd
  const rawMin = Math.max(0, ceil - nowMin)
  const qualityHoursLeft = Math.round(((rawMin / 60) - 0.5 * Math.floor(rawMin / 60)) * 2) / 2

  return { urgentEvent, backToBack, nextEvent, minsUntilNext, qualityHoursLeft, firstTomorrow }
}

function humanizeTodayWeather(weather, todayEvents) {
  const daily = weather?.daily
  if (!daily?.precipitation_probability_max) return null
  const todayProb = daily.precipitation_probability_max[0]
  const tomorrowProb = daily.precipitation_probability_max[1]

  if (todayProb >= 60 && todayEvents.length > 0) {
    const outdoor = todayEvents.find((e) =>
      /gym|salir|super|fútbol|paseo|caminar|cafe|cita/i.test(e.title || '')
    )
    if (outdoor) {
      return `Lluvia probable hoy (${todayProb}%); considera adelantar "${outdoor.title}".`
    }
    return `Lluvia probable hoy (${todayProb}%). Lleva paraguas.`
  }
  if (tomorrowProb >= 70) return `Mañana llueve fuerte (${tomorrowProb}%).`
  return null
}

function buildTodaySummary({ todayEvents, analysis, hour }) {
  if (analysis.urgentEvent) {
    return `${analysis.nextEvent.title} en ${analysis.minsUntilNext} min.`
  }
  if (analysis.backToBack) {
    return 'Calendario apretado: 3+ eventos seguidos. Mantén el ritmo.'
  }
  if (todayEvents.length === 0) {
    if (hour < 12) return `Día limpio — ${analysis.qualityHoursLeft}h de margen útil.`
    if (hour < 18) return `Tarde abierta — ${analysis.qualityHoursLeft}h útiles por delante.`
    return 'Casi cierre. Mañana lo planeamos juntos.'
  }
  if (analysis.qualityHoursLeft >= 2) {
    return `Tienes ${analysis.qualityHoursLeft}h libres antes de tu próximo bloque.`
  }
  return 'Día programado. Vamos paso a paso.'
}

// Exportado solo para tests unitarios y la batería QA (run-nova-battery.mjs
// replica el ruteo Haiku/Sonnet de producción). El runtime usa la versión
// local dentro del handler; estos exports no afectan el bundle de Vercel.
export { detectComplexInput as __detectComplexInput }
export { isClarificationReply as __isClarificationReply }
export { detectVeryComplexInput as __detectVeryComplexInput }
export { selectOpenAIModel as __selectOpenAIModel }
export { escalateOpenAITier as __escalateOpenAITier }
export { selectDeepSeekModel as __selectDeepSeekModel }


import handleCapabilities from './_lib/aiCapabilities.js'
import { executeNovaRequest } from './_lib/novaRuntime.js'
import { sanitizeNovaRequest, novaRequestId } from './_lib/novaSafety.js'
import { ASSISTANT_NAME } from './_lib/assistantBrand.js'
import { rateLimited, clientIp } from './_lib/rateLimit.js'
import { fetchWeather, describeWeatherCode } from './_lib/weather.js'
import { buildDateContext, addCivilDays } from './_lib/dateContext.js'
import { validCivilDate } from './_lib/novaContract.js'
import { rejectCrossSiteUnsafe, setCorsHeaders } from './_lib/security.js'
import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'
import { getUserPlan } from './_lib/usageLimits.js'
export const maxDuration = 60

export default async function handler(req, res) {
  // Keep the compatibility probe on this function to fit the existing hosting plan.
  if (req.query?.capabilities === '1') return handleCapabilities(req, res)
  setCorsHeaders(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (rejectCrossSiteUnsafe(req, res)) return
  if (rateLimited(clientIp(req), { max: 30, windowMs: 60_000 })) return res.status(429).json({ error: 'rate_limit', message: 'Demasiadas solicitudes. Espera un momento.' })
  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'auth_required', message: `Inicia sesión para hablar con ${ASSISTANT_NAME}.` })
  if (req.body?.mode === 'today-context') return handleTodayContext(req, res, userId)
  const validated = sanitizeNovaRequest(req.body)
  if (validated.error) return res.status(400).json({ error: validated.error })
  const requestId = novaRequestId(req.headers['x-request-id'])
  res.setHeader('Cache-Control', 'no-store')
  const admin = getSupabaseAdmin()
  const plan = await getUserPlan(admin, userId)
  try {
    const result = await executeNovaRequest({ admin, userId, requestId, body: validated.body, plan })
    return res.status(result.httpStatus).json(result.body)
  } catch {
    return res.status(503).json({ error: 'assistant_unavailable', requestId,
      message: `${ASSISTANT_NAME} no está disponible por un momento. Puedes crear tus pendientes manualmente.`, actions: [] })
  }
}

const TODAY_CTX_WEATHER_CACHE = new Map()
const TODAY_CTX_WEATHER_TTL_MS = 30 * 60 * 1000

async function handleTodayContext(req, res, userId) {
  const { todayISO, location = null, clientNow = Date.now(), clientTimezone } = req.body ?? {}
  if (!validCivilDate(todayISO) || !Number.isFinite(clientNow) || Math.abs(clientNow) >= 8.64e15) {
    return res.status(400).json({ error: 'missing_today_iso' })
  }

  const tomorrowISO = validCivilDate(req.body?.tomorrowISO) ? req.body.tomorrowISO : addCivilDays(todayISO, 1)
  const localTime = buildDateContext(clientNow, clientTimezone).currentTime24
  const nowMin = todayCtxTimeToMin(localTime)
  const supa = getSupabaseAdmin()
  if (!supa) return res.status(503).json({ error: 'service_unavailable' })

  const { data: todayRows, error: todayError } = await supa
    .from('events')
    .select('id, title, time, date, section')
    .eq('user_id', userId)
    .eq('date', todayISO)
    .order('time', { ascending: true })
  const { data: tmwRows, error: tomorrowError } = await supa
    .from('events')
    .select('id, title, time, date')
    .eq('user_id', userId)
    .eq('date', tomorrowISO)
    .limit(1)

  if (todayError || tomorrowError) return res.status(503).json({ error: 'service_unavailable' })
  const todayEvents = (todayRows ?? []).filter((e) => e.time)
  const firstTomorrow = (tmwRows ?? [])[0] ?? null

  let weatherSummary = null
  let weatherTip = null
  if (Number.isFinite(location?.lat) && Math.abs(location.lat) <= 90 && Number.isFinite(location?.lon) && Math.abs(location.lon) <= 180) {
    const cached = TODAY_CTX_WEATHER_CACHE.get(userId)
    let weather = cached && Date.now() - cached.at < TODAY_CTX_WEATHER_TTL_MS ? cached.data : null
    if (!weather) {
      try {
        weather = await fetchWeather(location.lat, location.lon)
        if (TODAY_CTX_WEATHER_CACHE.size >= 500) TODAY_CTX_WEATHER_CACHE.delete(TODAY_CTX_WEATHER_CACHE.keys().next().value)
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

  const analysis = analyzeTodayDay(todayEvents, firstTomorrow, nowMin)

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
    todayEvents, analysis, hour: Math.floor(nowMin / 60),
  })

  return res.json({
    ambient,
    summary,
    weather: weatherTip ?? weatherSummary,
    flags,
  })
}

function todayCtxTimeToMin(t) {
  const m = String(t).match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
  if (!m) return null
  let hour = Number(m[1]); const minute = Number(m[2])
  if (minute > 59 || hour > 23 || (m[3] && (hour < 1 || hour > 12))) return null
  if (m[3]) hour = hour % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0)
  return hour * 60 + minute
}

function analyzeTodayDay(events, firstTomorrow, nowMin) {
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
export { detectComplexInput as __detectComplexInput, isClarificationReply as __isClarificationReply, detectVeryComplexInput as __detectVeryComplexInput } from './_lib/novaComplexity.js'

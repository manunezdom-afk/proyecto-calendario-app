/**
 * behaviorAnalysis — construye un modelo del usuario a partir de sus signals
 *
 * Corre nocturnamente (en Evening Shutdown) o a demanda. Lee las señales
 * de los últimos 30 días, las agrega en patrones interpretables, y guarda
 * el resultado en `user_behavior`. Ese modelo se inyecta en el system prompt
 * de Nova (para decisiones en tiempo real) y se muestra en la vista
 * "Lo que Nova sabe de ti" (para transparencia).
 *
 * Principio: todas las métricas son derivadas, no se guarda data bruta en el
 * modelo. El usuario siempre puede borrar las señales y el modelo se regenera.
 */

import { supabase } from '../lib/supabase'
import { fetchRecentSignals } from './signalsService'

const CACHE_KEY = 'focus_user_behavior'
const MIN_SIGNALS = 5 // por debajo, el modelo es poco confiable
const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// ── helpers ─────────────────────────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function mean(arr) {
  if (!arr.length) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function mode(arr) {
  if (!arr.length) return null
  const counts = {}
  arr.forEach(v => { counts[v] = (counts[v] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

function peakWindow(hours, windowSize = 3) {
  // Encuentra la ventana de N horas consecutivas con mayor densidad de actividad.
  // Devuelve { start, end } (ej. 9-11 → { start: 9, end: 12 }).
  if (hours.length < 3) return null
  const hist = Array(24).fill(0)
  hours.forEach(h => { if (h >= 0 && h < 24) hist[h]++ })
  let bestIdx = 0, bestSum = 0
  for (let i = 0; i <= 24 - windowSize; i++) {
    const s = hist.slice(i, i + windowSize).reduce((a, b) => a + b, 0)
    if (s > bestSum) { bestSum = s; bestIdx = i }
  }
  if (bestSum === 0) return null
  return { start: bestIdx, end: bestIdx + windowSize }
}

// ── el motor ────────────────────────────────────────────────────────────────

/**
 * Analiza todas las signals recientes y devuelve un modelo estructurado.
 * Si hay suficientes datos (>= MIN_SIGNALS), también upsertea en Supabase.
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {Object} [opts.profile] - perfil del usuario (cronotype, peakStart, etc.)
 */
export async function analyzeBehavior({ userId, profile = {} } = {}) {
  const signals = await fetchRecentSignals({ sinceDays: 30, limit: 500 })

  if (signals.length < MIN_SIGNALS) {
    return null
  }

  // ── Tareas completadas: cuándo y cómo ─────────────────────────────────────
  const completions = signals.filter(s => s.kind === 'task_completed')
  const completionHours = completions
    .map(s => s.payload?.hour)
    .filter(h => typeof h === 'number' && h >= 0 && h <= 23)

  const realPeakHour = completionHours.length >= 5 ? Math.round(median(completionHours)) : null
  const realPeakWindow = peakWindow(completionHours, 3)

  // Por día de la semana
  const byWeekday = Array(7).fill(0)
  completions.forEach(s => {
    const wd = s.payload?.weekday
    if (typeof wd === 'number' && wd >= 0 && wd < 7) byWeekday[wd]++
  })
  const totalCompletions = byWeekday.reduce((a, b) => a + b, 0)

  let busyWeekday = null, slowWeekday = null
  if (totalCompletions >= 5) {
    const sorted = byWeekday
      .map((n, i) => ({ wd: i, n }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n)
    busyWeekday = sorted[0] ? WEEKDAY_NAMES[sorted[0].wd] : null
    slowWeekday = sorted.length >= 3 ? WEEKDAY_NAMES[sorted[sorted.length - 1].wd] : null
  }

  // ── Sugerencias: qué aprueba y qué rechaza ────────────────────────────────
  const approvedByKind = {}
  const rejectedByKind = {}
  signals.forEach(s => {
    const k = s.payload?.kind
    if (!k) return
    if (s.kind === 'suggestion_approved') approvedByKind[k] = (approvedByKind[k] || 0) + 1
    else if (s.kind === 'suggestion_rejected') rejectedByKind[k] = (rejectedByKind[k] || 0) + 1
  })
  const approvedCount = Object.values(approvedByKind).reduce((a, b) => a + b, 0)
  const rejectedCount = Object.values(rejectedByKind).reduce((a, b) => a + b, 0)
  const approvalRate = approvedCount + rejectedCount > 0
    ? approvedCount / (approvedCount + rejectedCount)
    : null

  const topApprovedKind = Object.entries(approvedByKind)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null

  // "Consistently rejected" = 3+ rechazos y más rechazos que aprobados
  const avoidKinds = Object.entries(rejectedByKind)
    .filter(([k, n]) => n >= 3 && n > (approvedByKind[k] || 0))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k)

  // ── Categorías de eventos más frecuentes ──────────────────────────────────
  const categoryCount = {}
  signals.filter(s => s.kind === 'event_created').forEach(s => {
    const sec = s.payload?.section
    if (sec) categoryCount[sec] = (categoryCount[sec] || 0) + 1
  })
  const topCategories = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, n]) => ({ category: cat, count: n }))

  // ── Uso de Nova ───────────────────────────────────────────────────────────
  const novaMsgs = signals.filter(s => s.kind === 'nova_message')
  const novaHours = novaMsgs.map(s => s.payload?.hour).filter(h => typeof h === 'number')
  const novaDailyAvg = Math.round((novaMsgs.length / 30) * 10) / 10
  const novaFavoriteHour = novaHours.length >= 3 ? parseInt(mode(novaHours), 10) : null

  // ── Overall trend: comparar últimos 7d vs 7-14d (engagement trend) ────────
  const now = Date.now()
  const last7 = signals.filter(s => new Date(s.created_at).getTime() > now - 7 * 86400000).length
  const prev7 = signals.filter(s => {
    const t = new Date(s.created_at).getTime()
    return t > now - 14 * 86400000 && t <= now - 7 * 86400000
  }).length
  let engagementTrend = null
  if (prev7 >= 3) {
    if (last7 > prev7 * 1.15) engagementTrend = 'subiendo'
    else if (last7 < prev7 * 0.85) engagementTrend = 'bajando'
    else engagementTrend = 'estable'
  }

  // ── Ensamblamos el modelo ─────────────────────────────────────────────────
  const model = {
    computed_at: new Date().toISOString(),
    sample_size: signals.length,
    period_days: 30,

    // Energía real
    real_peak_hour: realPeakHour,
    real_peak_window: realPeakWindow,
    profile_peak: profile.peakStart != null
      ? { start: profile.peakStart, end: profile.peakEnd }
      : null,

    // Semana
    busy_weekday: busyWeekday,
    slow_weekday: slowWeekday,
    weekday_completions: byWeekday,

    // Tareas
    total_completions: totalCompletions,

    // Sugerencias
    approved_count: approvedCount,
    rejected_count: rejectedCount,
    approval_rate: approvalRate != null ? Math.round(approvalRate * 100) / 100 : null,
    top_approved_kind: topApprovedKind,
    avoid_kinds: avoidKinds,

    // Categorías
    top_categories: topCategories,

    // Nova
    nova_daily_avg: novaDailyAvg,
    nova_favorite_hour: novaFavoriteHour,

    // Trend
    engagement_trend: engagementTrend,
  }

  // Cacheamos local siempre
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(model)) } catch {}

  // Persistimos en Supabase si hay usuario
  if (userId && supabase) {
    try {
      await supabase.from('user_behavior').upsert({
        user_id: userId,
        model,
        last_analyzed_at: new Date().toISOString(),
      })
    } catch (err) {
      console.warn('[Focus] ⚠️ No se pudo guardar el modelo de comportamiento', err)
    }
  }

  return model
}

/** Lee el modelo cacheado (síncrono). Usado por NovaWidget en cada request. */
export function getCachedBehavior() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/** Trae el modelo de Supabase y cachea. Se llama al login. */
export async function fetchBehavior(userId) {
  if (!userId || !supabase) return getCachedBehavior()
  try {
    const { data } = await supabase
      .from('user_behavior')
      .select('model, last_analyzed_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (data?.model) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data.model)) } catch {}
      return data.model
    }
  } catch {}
  return getCachedBehavior()
}

/** Formatea el modelo como texto plano para inyectar en el system prompt de Nova. */
export function modelToPrompt(model) {
  if (!model) return null
  const lines = []
  lines.push(`Basado en ${model.sample_size} señales de los últimos ${model.period_days} días:`)

  if (model.real_peak_window) {
    const { start, end } = model.real_peak_window
    const profileBit = model.profile_peak
      ? ` (perfil declarado: ${model.profile_peak.start}–${model.profile_peak.end}h)`
      : ''
    lines.push(`- Pico REAL de productividad observado: ${start}–${end}h${profileBit}.`)
  } else if (model.real_peak_hour != null) {
    lines.push(`- Hora más productiva observada: ${model.real_peak_hour}h.`)
  }

  if (model.busy_weekday) {
    lines.push(`- Día más productivo: ${model.busy_weekday}${model.slow_weekday ? `; día más lento: ${model.slow_weekday}` : ''}.`)
  }

  if (model.approval_rate != null) {
    lines.push(`- Tasa de aprobación de sugerencias: ${Math.round(model.approval_rate * 100)}% (${model.approved_count} aprobadas / ${model.rejected_count} rechazadas).`)
  }

  if (model.top_approved_kind) {
    lines.push(`- Tipo de sugerencia que más aprueba: "${model.top_approved_kind}" — seguí proponiendo estas.`)
  }

  if (model.avoid_kinds && model.avoid_kinds.length > 0) {
    lines.push(`- EVITÁ sugerir estos tipos (el usuario los rechazó repetidamente): ${model.avoid_kinds.join(', ')}.`)
  }

  if (model.top_categories && model.top_categories.length > 0) {
    const cats = model.top_categories.map(c => `${c.category} (${c.count})`).join(', ')
    lines.push(`- Categorías de eventos más comunes: ${cats}.`)
  }

  if (model.nova_favorite_hour != null) {
    lines.push(`- Suele escribirte alrededor de las ${model.nova_favorite_hour}h.`)
  }

  if (model.engagement_trend) {
    lines.push(`- Engagement de la última semana: ${model.engagement_trend}.`)
  }

  return lines.length > 1 ? lines.join('\n') : null
}

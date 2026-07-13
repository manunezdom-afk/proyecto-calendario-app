// Configuración centralizada de planes y límites de uso.
//
// Por qué archivo y no tabla en DB:
//   * Cambios de límites requieren coordinación con copy/UX → preferimos
//     deploy con review en lugar de edición SQL en producción.
//   * Sin una tabla extra y sin RLS adicional → menos superficie de ataque.
//   * Si alguna vez necesitamos editarlos en caliente, migrar a tabla
//     `app_plan_limits (plan TEXT, action_type TEXT, period TEXT, limit INT)`
//     es directo: cambiar getLimit() por una lectura cacheada y listo.
//
// Cómo se usa:
//   import { getUserPlan, enforceLimit, ACTION_TYPES, MESSAGES } from './_lib/usageLimits.js'
//
//   const plan = await getUserPlan(admin, userId)
//   const check = await enforceLimit(admin, userId, plan, ACTION_TYPES.NOVA_MESSAGE)
//   if (!check.ok) return res.status(429).json({ error: 'quota_exceeded', ...check })
//
// IMPORTANTE: enforceLimit() incrementa el contador de forma optimista. Si el
// modelo de IA falla después, el usuario "perdió" un crédito. Es una
// decisión consciente: contar al inicio evita que un atacante haga
// reintentos rápidos para superar el límite mientras el handler está
// pensando. El costo real para el usuario es bajo (cuotas son diarias).

// ─────────────────────────────────────────────────────────────────────────────
// Constantes públicas
// ─────────────────────────────────────────────────────────────────────────────

export const PLANS = Object.freeze({
  FREE:         'free',
  EARLY_ACCESS: 'early_access',
  PLUS:         'plus',     // reservado, sin pagos todavía
  PRO:          'pro',      // reservado, sin pagos todavía
  ADMIN:        'admin',
})

export const VALID_PLANS = new Set(Object.values(PLANS))

// Action types canónicos. Los handlers DEBEN usar estos valores; no llaves
// libres tipo 'focus-assistant' o el nombre del archivo. Esto desacopla los
// contadores de la URL: si mañana mudamos focus-assistant a /api/v2/nova,
// el contador sigue siendo 'nova_message'.
export const ACTION_TYPES = Object.freeze({
  NOVA_MESSAGE:         'nova_message',          // 1 turno de chat con Nova (focus-assistant)
  NOVA_SMART_ACTION:    'nova_smart_action',     // turno donde Nova devuelve actions[] (crear/editar)
  NOVA_PREMIUM_MESSAGE: 'nova_premium_message',  // escalación a Sonnet cuando Haiku falla o emite acciones riesgosas
  ORGANIZE_DAY:         'organize_day',          // futuro: reorganizar Mi Día con IA
  WEEKLY_PLANNING:      'weekly_planning',       // futuro: planificación semanal con IA
  VOICE_AI:             'voice_ai',              // futuro: transcripción/dictado con IA backend
  PHOTO_ANALYSIS:       'photo_analysis',        // analyze-photo (vision)
})

export const VALID_ACTION_TYPES = new Set(Object.values(ACTION_TYPES))

// ─────────────────────────────────────────────────────────────────────────────
// Tabla de límites
// ─────────────────────────────────────────────────────────────────────────────
//
// Estructura: LIMITS[plan][action_type] = { daily?, weekly?, monthly?, enabled }
//   * daily   — máximo de veces por día UTC
//   * weekly  — máximo en los últimos 7 días
//   * monthly — máximo en los últimos 30 días
//   * enabled — si false → bloquea siempre (no usado todavía, reservado)
//
// Reglas decididas con el usuario:
//   * Lo manual (crear tarea, evento, notificación local) NO consume cuota
//     porque no llama a IA. Solo se cuentan acciones que cuestan tokens o
//     procesamiento backend significativo.
//   * Free es conservador: priorizamos contener costos antes que volumen.
//   * Early Access es ~3x free, pensado para 60-90 días de cohort beta.
//   * Plus/Pro están como placeholder con números altos pero no operan
//     todavía (no hay pagos).
//   * Admin tiene techo muy alto pero no infinito → un bug en el cliente
//     no nos vacía el presupuesto.

const HUGE = 100_000  // techo alto para admin sin perder enforcement total

const LIMITS = Object.freeze({
  [PLANS.FREE]: {
    [ACTION_TYPES.NOVA_MESSAGE]:         { daily: 20  },
    [ACTION_TYPES.NOVA_SMART_ACTION]:    { daily: 10  },
    [ACTION_TYPES.NOVA_PREMIUM_MESSAGE]: { daily: 5   },
    [ACTION_TYPES.ORGANIZE_DAY]:         { daily: 3   },
    [ACTION_TYPES.WEEKLY_PLANNING]:      { weekly: 1  },
    [ACTION_TYPES.VOICE_AI]:             { daily: 10  },
    [ACTION_TYPES.PHOTO_ANALYSIS]:       { daily: 5   },
  },
  [PLANS.EARLY_ACCESS]: {
    [ACTION_TYPES.NOVA_MESSAGE]:         { daily: 60  },
    [ACTION_TYPES.NOVA_SMART_ACTION]:    { daily: 30  },
    [ACTION_TYPES.NOVA_PREMIUM_MESSAGE]: { daily: 20  },
    [ACTION_TYPES.ORGANIZE_DAY]:         { daily: 10  },
    [ACTION_TYPES.WEEKLY_PLANNING]:      { weekly: 3  },
    [ACTION_TYPES.VOICE_AI]:             { daily: 30  },
    [ACTION_TYPES.PHOTO_ANALYSIS]:       { daily: 15  },
  },
  [PLANS.PLUS]: {
    [ACTION_TYPES.NOVA_MESSAGE]:         { daily: 200 },
    [ACTION_TYPES.NOVA_SMART_ACTION]:    { daily: 100 },
    [ACTION_TYPES.NOVA_PREMIUM_MESSAGE]: { daily: 50  },
    [ACTION_TYPES.ORGANIZE_DAY]:         { daily: 30  },
    [ACTION_TYPES.WEEKLY_PLANNING]:      { weekly: 10 },
    [ACTION_TYPES.VOICE_AI]:             { daily: 100 },
    [ACTION_TYPES.PHOTO_ANALYSIS]:       { daily: 50  },
  },
  [PLANS.PRO]: {
    [ACTION_TYPES.NOVA_MESSAGE]:         { daily: 1000 },
    [ACTION_TYPES.NOVA_SMART_ACTION]:    { daily: 500  },
    [ACTION_TYPES.NOVA_PREMIUM_MESSAGE]: { daily: 200  },
    [ACTION_TYPES.ORGANIZE_DAY]:         { daily: 100  },
    [ACTION_TYPES.WEEKLY_PLANNING]:      { weekly: 30  },
    [ACTION_TYPES.VOICE_AI]:             { daily: 500  },
    [ACTION_TYPES.PHOTO_ANALYSIS]:       { daily: 200  },
  },
  [PLANS.ADMIN]: {
    [ACTION_TYPES.NOVA_MESSAGE]:         { daily: HUGE },
    [ACTION_TYPES.NOVA_SMART_ACTION]:    { daily: HUGE },
    [ACTION_TYPES.NOVA_PREMIUM_MESSAGE]: { daily: HUGE },
    [ACTION_TYPES.ORGANIZE_DAY]:         { daily: HUGE },
    [ACTION_TYPES.WEEKLY_PLANNING]:      { weekly: HUGE },
    [ACTION_TYPES.VOICE_AI]:             { daily: HUGE },
    [ACTION_TYPES.PHOTO_ANALYSIS]:       { daily: HUGE },
  },
})

// Mensajes humanos por (plan, action_type). Devolvemos uno fallback si la
// combinación no está cubierta.
export const MESSAGES = Object.freeze({
  [PLANS.FREE]: {
    [ACTION_TYPES.NOVA_MESSAGE]:
      'Llegaste al límite diario de Nova en el plan gratis. Puedes seguir usando tareas, eventos y notificaciones manualmente. Tu límite se reinicia mañana.',
    [ACTION_TYPES.NOVA_SMART_ACTION]:
      'Llegaste al límite diario de acciones inteligentes de Nova. Puedes seguir conversando, pero las acciones automáticas se reanudan mañana.',
    [ACTION_TYPES.ORGANIZE_DAY]:
      'Ya organizaste tu día las veces que el plan gratis permite hoy. Puedes hacerlo de nuevo mañana.',
    [ACTION_TYPES.WEEKLY_PLANNING]:
      'Ya usaste tu planificación semanal disponible en el plan gratis. Puedes seguir organizando tu día o crear tareas manualmente.',
    [ACTION_TYPES.VOICE_AI]:
      'Llegaste al límite diario de dictado por voz en el plan gratis. Vuelve mañana o escribe directamente.',
    [ACTION_TYPES.PHOTO_ANALYSIS]:
      'Llegaste al límite diario de análisis de fotos en el plan gratis. Vuelve mañana o agrega los eventos manualmente.',
    [ACTION_TYPES.NOVA_PREMIUM_MESSAGE]:
      'Llegaste al límite diario de respuestas avanzadas de Nova en el plan gratis. Las respuestas normales siguen disponibles.',
  },
  [PLANS.EARLY_ACCESS]: {
    [ACTION_TYPES.NOVA_MESSAGE]:
      'Llegaste al límite ampliado de Early Access por hoy. Tu acceso se reinicia mañana.',
    [ACTION_TYPES.NOVA_SMART_ACTION]:
      'Llegaste al límite ampliado de acciones inteligentes en Early Access. Vuelve mañana.',
    [ACTION_TYPES.ORGANIZE_DAY]:
      'Llegaste al límite de Mi Día en Early Access por hoy. Vuelve mañana.',
    [ACTION_TYPES.WEEKLY_PLANNING]:
      'Usaste tus planificaciones semanales de Early Access esta semana. Se reinician en 7 días.',
    [ACTION_TYPES.VOICE_AI]:
      'Llegaste al límite de dictado por voz en Early Access por hoy. Vuelve mañana.',
    [ACTION_TYPES.PHOTO_ANALYSIS]:
      'Llegaste al límite de análisis de fotos en Early Access por hoy. Vuelve mañana.',
    [ACTION_TYPES.NOVA_PREMIUM_MESSAGE]:
      'Llegaste al límite ampliado de respuestas avanzadas de Nova en Early Access. Las respuestas normales siguen disponibles.',
  },
})

const FALLBACK_LIMIT_MESSAGE =
  'Llegaste al límite de uso por ahora. Vuelve más tarde o sigue usando las funciones manuales.'

export function messageForLimit(plan, actionType) {
  return (
    MESSAGES?.[plan]?.[actionType] ||
    MESSAGES?.[PLANS.FREE]?.[actionType] ||
    FALLBACK_LIMIT_MESSAGE
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizePlan(value) {
  const v = String(value || '').toLowerCase().trim()
  return VALID_PLANS.has(v) ? v : PLANS.FREE
}

function isExpired(expiresAt) {
  if (!expiresAt) return false
  const t = new Date(expiresAt).getTime()
  return Number.isFinite(t) && t < Date.now()
}

/**
 * Devuelve el plan efectivo del usuario.
 *   * Sin fila → 'free'
 *   * expires_at vencido → 'free'
 *   * Plan inválido (legacy) → 'free'
 *   * Falla de DB → 'free' (degradación segura: el peor caso es bloquear
 *     más rápido a un usuario premium, no dejar pasar a un free).
 */
export async function getUserPlan(admin, userId) {
  if (!admin || !userId) return PLANS.FREE
  try {
    const { data, error } = await admin
      .from('user_plans')
      .select('plan, expires_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      // Si la tabla aún no existe, no rompemos nada: tratamos como free.
      if (/does not exist|relation .* does not exist/i.test(error.message || '')) {
        return PLANS.FREE
      }
      return PLANS.FREE
    }
    if (!data) return PLANS.FREE
    if (isExpired(data.expires_at)) return PLANS.FREE
    return normalizePlan(data.plan)
  } catch {
    return PLANS.FREE
  }
}

export function getLimit(plan, actionType) {
  const p = normalizePlan(plan)
  const cfg = LIMITS?.[p]?.[actionType]
  return cfg || null
}

function todayUtcISO() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function nextDailyResetIso() {
  const d = new Date()
  d.setUTCHours(24, 0, 0, 0)
  return d.toISOString()
}

function rangeDailyDays(now = new Date()) {
  // Solo hoy.
  return [todayUtcFor(now)]
}

function rangeWeeklyDays(now = new Date()) {
  // Últimos 7 días incluyendo hoy.
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    days.push(todayUtcFor(d))
  }
  return days
}

function rangeMonthlyDays(now = new Date()) {
  const days = []
  for (let i = 0; i < 30; i++) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    days.push(todayUtcFor(d))
  }
  return days
}

function todayUtcFor(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function nextWeeklyResetIso(now = new Date()) {
  // No hay "lunes" — usamos rolling 7 días, así que el reset es 24h adelante
  // del día más viejo que aún cuenta. Aproximación: 1 día desde ahora.
  const d = new Date(now)
  d.setUTCHours(24, 0, 0, 0)
  return d.toISOString()
}

/**
 * Cuenta el uso actual sumando filas de ai_usage en el rango correspondiente.
 *
 * Devuelve { used, limit, period, resetAt }.
 *   period puede ser 'daily' | 'weekly' | 'monthly'
 *   Si la limit config tiene varios periodos, gana el MÁS RESTRICTIVO
 *   (ej. weekly:1 con uso=1 y daily:5 con uso=0 → bloquea por weekly).
 */
async function getUsage(admin, userId, actionType, limitCfg) {
  // Determinar todos los periodos a chequear
  const periods = []
  if (limitCfg?.daily   != null) periods.push({ name: 'daily',   days: rangeDailyDays(),   limit: limitCfg.daily,   resetAt: nextDailyResetIso() })
  if (limitCfg?.weekly  != null) periods.push({ name: 'weekly',  days: rangeWeeklyDays(),  limit: limitCfg.weekly,  resetAt: nextWeeklyResetIso() })
  if (limitCfg?.monthly != null) periods.push({ name: 'monthly', days: rangeMonthlyDays(), limit: limitCfg.monthly, resetAt: nextWeeklyResetIso() })

  if (periods.length === 0) return { ok: true, soft: true, periods: [] }

  // Lo más eficiente es hacer una sola query por la unión de días, ya que
  // los rangos están anidados (daily ⊂ weekly ⊂ monthly).
  const allDays = [...new Set(periods.flatMap(p => p.days))]
  const { data, error } = await admin
    .from('ai_usage')
    .select('day, count')
    .eq('user_id', userId)
    .eq('endpoint', actionType)
    .in('day', allDays)

  if (error) {
    if (/does not exist|relation .* does not exist/i.test(error.message || '')) {
      return { ok: true, soft: true, reason: 'table_missing', periods: [] }
    }
    return { ok: true, soft: true, reason: 'db_error', periods: [] }
  }

  const byDay = new Map()
  for (const row of data || []) byDay.set(row.day, Number(row.count || 0))

  const enriched = periods.map(p => ({
    ...p,
    used: p.days.reduce((sum, day) => sum + (byDay.get(day) || 0), 0),
  }))

  // Bloqueamos si CUALQUIER periodo está lleno
  for (const p of enriched) {
    if (p.used >= p.limit) {
      return {
        ok: false,
        period: p.name,
        used: p.used,
        limit: p.limit,
        resetAt: p.resetAt,
        periods: enriched,
      }
    }
  }

  return { ok: true, periods: enriched }
}

/**
 * Modo beta global. Cuando BETA_UNLIMITED=true en env vars del backend,
 * checkLimit devuelve siempre ok=true (soft) sin consultar DB ni
 * incrementar contadores de bloqueo. recordUsage SIGUE escribiendo en
 * ai_usage / ai_usage_events para medir costos — solo se desactiva el
 * enforcement de límites, no la observabilidad.
 *
 * Activar/desactivar:
 *   - Vercel → Project Settings → Environment Variables → BETA_UNLIMITED
 *   - Dejar vacío o "false" para reactivar límites por plan.
 *
 * UI: el cliente puede leer si beta unlimited está activo via
 * GET /api/me/plan (campo `betaUnlimited` agregado más abajo).
 */
function isBetaUnlimited() {
  const v = String(process.env.BETA_UNLIMITED || '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export { isBetaUnlimited }

/**
 * Verifica si el usuario tiene cuota disponible para action_type. NO escribe.
 *
 * Devuelve:
 *   { ok: true,  remaining, plan, period }    — dentro del límite
 *   { ok: true,  soft: true, plan, reason }   — DB no disponible (no bloqueamos)
 *   { ok: true,  soft: true, plan, beta: true } — BETA_UNLIMITED activo
 *   { ok: false, plan, action_type, period, used, limit, resetAt, message }
 *
 * Uso típico:
 *   const check = await checkLimit(admin, userId, plan, ACTION_TYPES.NOVA_MESSAGE)
 *   if (!check.ok) return res.status(429).json({ error: 'quota_exceeded', ...check })
 *   // ... ejecutar acción que cuesta tokens ...
 *   await recordUsage(admin, userId, ACTION_TYPES.NOVA_MESSAGE)
 */
export async function checkLimit(admin, userId, plan, actionType) {
  if (!admin || !userId) {
    return { ok: true, soft: true, plan: PLANS.FREE }
  }
  if (!VALID_ACTION_TYPES.has(actionType)) {
    console.warn('[usageLimits] action_type desconocido:', actionType)
    return { ok: true, soft: true, plan }
  }

  // BETA_UNLIMITED: bypass total de enforcement. Sigue corriendo
  // recordUsage abajo (en focus-assistant.js) así que ai_usage_events
  // refleja el costo real para tracking de presupuesto.
  if (isBetaUnlimited()) {
    return { ok: true, soft: true, plan: normalizePlan(plan), beta: true }
  }

  const effectivePlan = normalizePlan(plan)
  const cfg = getLimit(effectivePlan, actionType)
  if (!cfg) {
    return { ok: true, soft: true, plan: effectivePlan }
  }

  const usage = await getUsage(admin, userId, actionType, cfg)
  if (usage.soft) {
    return { ok: true, soft: true, plan: effectivePlan, reason: usage.reason }
  }
  if (!usage.ok) {
    return {
      ok: false,
      plan: effectivePlan,
      action_type: actionType,
      period: usage.period,
      used: usage.used,
      limit: usage.limit,
      resetAt: usage.resetAt,
      message: messageForLimit(effectivePlan, actionType),
    }
  }

  const periodInfo = usage.periods?.[0]
  return {
    ok: true,
    plan: effectivePlan,
    action_type: actionType,
    remaining: Math.max(0, (periodInfo?.limit ?? Infinity) - (periodInfo?.used ?? 0)),
    limit: periodInfo?.limit,
    period: periodInfo?.name || 'daily',
  }
}

/**
 * Incrementa +1 el contador del usuario para action_type en HOY (UTC).
 *
 * Devuelve:
 *   { ok: true,  remaining? }                 — incrementó OK (best effort)
 *   { ok: true,  soft: true, reason }         — falló silencioso (no bloqueamos)
 *
 * No verifica el límite — para eso usar checkLimit() antes. Esta función está
 * pensada para llamarse DESPUÉS de que la acción IA se ejecutó con éxito;
 * así un bug en el modelo o un timeout no consumen cuota del usuario.
 */
export async function recordUsage(admin, userId, actionType) {
  if (!admin || !userId) return { ok: true, soft: true }
  if (!VALID_ACTION_TYPES.has(actionType)) {
    console.warn('[usageLimits] recordUsage action_type desconocido:', actionType)
    return { ok: true, soft: true }
  }

  const day = todayUtcISO()
  try {
    const { data: row, error: selErr } = await admin
      .from('ai_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('day', day)
      .eq('endpoint', actionType)
      .maybeSingle()

    if (selErr) return { ok: true, soft: true, reason: 'select_error' }

    const current = Number(row?.count || 0)
    const { error: upErr } = await admin
      .from('ai_usage')
      .upsert(
        { user_id: userId, day, endpoint: actionType, count: current + 1, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,day,endpoint' },
      )
    if (upErr) return { ok: true, soft: true, reason: 'upsert_error' }
    return { ok: true, count: current + 1 }
  } catch {
    return { ok: true, soft: true, reason: 'unexpected' }
  }
}

/**
 * Atajo: checkLimit + recordUsage en una sola llamada. Usar cuando contar
 * "antes" del trabajo es aceptable (ej. requests baratos sin tokens).
 *
 * Devuelve lo mismo que checkLimit; si OK también incrementa.
 */
export async function enforceLimit(admin, userId, plan, actionType) {
  const check = await checkLimit(admin, userId, plan, actionType)
  if (!check.ok) return check
  if (!check.soft) await recordUsage(admin, userId, actionType)
  return check
}

/**
 * Devuelve un snapshot del uso del día/semana del usuario para todas las
 * acciones que tienen límite en su plan. Útil para mostrar progreso en UI
 * (Ajustes) o para tests. NO incrementa nada.
 */
export async function getUsageSnapshot(admin, userId, plan) {
  if (!admin || !userId) return null
  const effectivePlan = normalizePlan(plan)
  const planCfg = LIMITS[effectivePlan] || {}
  const out = { plan: effectivePlan, actions: {} }
  for (const [actionType, cfg] of Object.entries(planCfg)) {
    const usage = await getUsage(admin, userId, actionType, cfg)
    if (usage.soft) continue
    out.actions[actionType] = {
      limit: cfg,
      periods: usage.periods,
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Corta-circuito de presupuesto global (tope de gasto de IA)
// ─────────────────────────────────────────────────────────────────────────────
//
// Protege el bolsillo del dueño: si el gasto ACUMULADO de IA (sumando TODOS los
// usuarios) supera el presupuesto configurado, cortamos las llamadas pagas y
// Nova degrada al parser local. Es una malla BLANDA — la malla DURA es el
// límite de gasto que el dueño pone en los dashboards de OpenAI/Anthropic
// (auto-recharge OFF + usage hard limit). Esta capa corta ANTES, en el número
// que el dueño elija, con un aviso amable.
//
// Se activa solo si hay presupuesto por env:
//   AI_DAILY_BUDGET_USD   — tope de gasto por día UTC
//   AI_MONTHLY_BUDGET_USD — tope de gasto en los últimos 30 días
// Sin ninguno seteado → no hay corte.
//
// Cacheamos el resultado ~60s para no consultar `ai_usage_events` en cada
// request. Consecuencia: el tope se puede sobrepasar por hasta ~60s de tráfico
// — aceptable; el tope duro del proveedor es la garantía real. Depende de que
// los precios en aiPricing.js estén bien (si no, el costo estimado es erróneo).

const BUDGET_CACHE_TTL_MS = 60_000
let _budgetCache = { at: 0, result: null }

function round6(n) { return Number((Number(n) || 0).toFixed(6)) }

function budgetLimitsFromEnv() {
  const daily = Number(process.env.AI_DAILY_BUDGET_USD)
  const monthly = Number(process.env.AI_MONTHLY_BUDGET_USD)
  return {
    daily: Number.isFinite(daily) && daily > 0 ? daily : null,
    monthly: Number.isFinite(monthly) && monthly > 0 ? monthly : null,
  }
}

/**
 * ¿Queda presupuesto de IA para atender esta request? NO escribe.
 *
 * Devuelve:
 *   { ok: true, soft: true, reason }              — sin presupuesto configurado / DB caída
 *   { ok: true, dailySpent, monthlySpent }        — dentro del presupuesto
 *   { ok: false, period, spent, budget, message } — presupuesto agotado → degradar a local
 */
export async function checkGlobalBudget(admin) {
  const { daily, monthly } = budgetLimitsFromEnv()
  if (daily == null && monthly == null) {
    return { ok: true, soft: true, reason: 'no_budget' }
  }

  const now = Date.now()
  if (_budgetCache.result && (now - _budgetCache.at) < BUDGET_CACHE_TTL_MS) {
    return _budgetCache.result
  }
  if (!admin) return { ok: true, soft: true, reason: 'no_admin' }

  const startOfTodayUtc = new Date()
  startOfTodayUtc.setUTCHours(0, 0, 0, 0)
  const todayStartMs = startOfTodayUtc.getTime()
  const windowStart = monthly != null
    ? new Date(now - 30 * 24 * 60 * 60 * 1000)
    : startOfTodayUtc

  try {
    const { data, error } = await admin
      .from('ai_usage_events')
      .select('estimated_cost_usd, created_at')
      .gte('created_at', windowStart.toISOString())

    if (error) {
      // Tabla ausente / error → NO bloqueamos (el tope duro del proveedor
      // sigue protegiendo). Cacheamos para no reintentar en loop.
      const soft = { ok: true, soft: true, reason: 'db_error' }
      _budgetCache = { at: now, result: soft }
      return soft
    }

    let dailySpent = 0
    let monthlySpent = 0
    for (const rowu of data || []) {
      const cost = Number(rowu.estimated_cost_usd || 0)
      monthlySpent += cost
      if (new Date(rowu.created_at).getTime() >= todayStartMs) dailySpent += cost
    }

    let result
    if (daily != null && dailySpent >= daily) {
      result = {
        ok: false, period: 'daily', spent: round6(dailySpent), budget: daily,
        message: 'Nova está descansando por hoy. Puedes seguir creando eventos y recordatorios; vuelve mañana.',
      }
    } else if (monthly != null && monthlySpent >= monthly) {
      result = {
        ok: false, period: 'monthly', spent: round6(monthlySpent), budget: monthly,
        message: 'Nova está descansando este mes. Puedes seguir creando eventos y recordatorios.',
      }
    } else {
      result = { ok: true, dailySpent: round6(dailySpent), monthlySpent: round6(monthlySpent) }
    }
    _budgetCache = { at: now, result }
    return result
  } catch {
    const soft = { ok: true, soft: true, reason: 'unexpected' }
    _budgetCache = { at: now, result: soft }
    return soft
  }
}

// Solo para tests: permite resetear el caché entre casos.
export function __resetBudgetCache() { _budgetCache = { at: 0, result: null } }

// Re-exports legacy: usados por tests/auth-required.test.js antes de la
// migración. Mantenemos hasta limpiar tests viejos.
export const __test__ = { LIMITS, normalizePlan, isExpired }

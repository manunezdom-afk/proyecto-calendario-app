import { createHash } from 'node:crypto'
import { getLimit } from './usageLimits.js'
import { getModelPricing } from './aiPricing.js'
import { novaInputTokenLimit, paidAICallsEnabled } from './novaSafety.js'

const numeric = (key, fallback, ceiling) => {
  if (process.env[key] == null) return fallback
  const n = Number(process.env[key])
  // An explicit zero/invalid monetary cap is closed, never a higher fallback.
  return Number.isFinite(n) && n >= 0 ? Math.min(n, ceiling) : 0
}
export function budgetAlertPercentages() {
  if (process.env.AI_BUDGET_ALERT_PERCENTAGES == null) return [50, 75, 90]
  const parts = process.env.AI_BUDGET_ALERT_PERCENTAGES.split(',').map(part => part.trim())
  const values = parts.map(Number)
  if (!parts.length || parts.length > 5 || parts.some(part => !part) || values.some(value => !Number.isFinite(value) || value <= 0 || value > 100)) return []
  return [...new Set(values)].sort((a, b) => a - b)
}

export function admissionPolicy() {
  return {
    requests_per_minute: Math.floor(numeric('AI_USER_REQUESTS_PER_MINUTE', 5, 30)), max_concurrent: 1, lease_seconds: 55,
    daily_budget_usd: numeric('AI_DAILY_BUDGET_USD', 5, 1000), monthly_budget_usd: numeric('AI_MONTHLY_BUDGET_USD', 20, 10000),
    user_daily_budget_usd: numeric('AI_USER_DAILY_BUDGET_USD', 0.25, 10), user_monthly_budget_usd: numeric('AI_USER_MONTHLY_BUDGET_USD', 5, 100),
    request_budget_usd: numeric('AI_MAX_COST_PER_REQUEST_USD', 0.25, 0.50),
    sol_daily_budget_usd: numeric('AI_SOL_DAILY_BUDGET_USD', 0.50, 100),
    sol_monthly_budget_usd: numeric('AI_SOL_MONTHLY_BUDGET_USD', 3, 1000),
    sol_user_daily_requests: Math.floor(numeric('AI_SOL_USER_DAILY_REQUESTS', 2, 100)),
    sol_user_monthly_requests: Math.floor(numeric('AI_SOL_USER_MONTHLY_REQUESTS', 10, 1000)),
    sol_enabled: process.env.AI_SOL_ENABLED == null || process.env.AI_SOL_ENABLED === 'true',
    economy_percent: numeric('AI_ECONOMY_BUDGET_PERCENT', 90, 100),
    alert_percentages: budgetAlertPercentages(),
    sol_share_alert_percent: numeric('AI_SOL_SHARE_ALERT_PERCENT', 5, 100),
    sol_share_min_requests: Math.floor(numeric('AI_SOL_SHARE_MIN_REQUESTS', 20, 10000)),
  }
}
export function quotaLimits(plan, actionType) {
  const cfg = getLimit(plan, actionType)
  if (!cfg || cfg.enabled === false) return {}
  return Object.fromEntries(['daily', 'weekly', 'monthly'].filter(key => Number.isInteger(cfg[key])).map(key => [key, cfg[key]]))
}
export function reserveAttemptCost(route, inputTokens = route?.inputTokens ?? novaInputTokenLimit()) {
  if (!route || !Number.isInteger(inputTokens) || inputTokens < 1 || !Number.isInteger(route.maxOutputTokens) || route.maxOutputTokens < 1) {
    throw Object.assign(new Error('invalid_token_reservation'), { code: 'invalid_token_reservation' })
  }
  const pricing = getModelPricing(route.model, { conservative: true, requireCurrent: true, inputTokens })
  if (!pricing || pricing.provider !== route.provider) throw Object.assign(new Error('pricing_unavailable'), { code: 'pricing_unavailable' })
  // Reserve the largest documented cache-write price even when the static
  // prefix hits cache, so caching cannot make the reservation optimistic.
  return Math.ceil((inputTokens * Math.max(pricing.input, pricing.cacheWrite || 0,
    pricing.cacheWrite5m || 0, pricing.cacheWrite1h || 0) + route.maxOutputTokens * pricing.output) / 1000) / 1000
}
export function reserveRequestCost(routes) {
  if (!Array.isArray(routes) || routes.length < 1 || routes.length > 2) throw Object.assign(new Error('invalid_attempt_count'), { code: 'invalid_attempt_count' })
  const amount = routes.reduce((sum, route) => sum + reserveAttemptCost(route), 0)
  if (amount > numeric('AI_MAX_COST_PER_REQUEST_USD', 0.25, 0.50)) throw Object.assign(new Error('request_cost_limit'), { code: 'request_cost_limit' })
  return amount
}
const admissionOperations = new Set(['focus_ai_admit', 'focus_ai_begin_attempt', 'focus_ai_settle_attempt',
  'focus_ai_consume', 'focus_ai_finish', 'focus_ai_model_metrics', 'focus_ai_get_control', 'focus_ai_set_control', 'durable_replay_read'])
function admissionDiagnostic(operation, outcome, started, signal, error) {
  // Operational categories only: never log RPC arguments, IDs, error messages,
  // SQL details, fingerprints or the private cached response.
  const failure = signal?.aborted || ['AbortError', 'TimeoutError'].includes(error?.name) ? 'timeout'
    : ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'].includes(error?.code) ? 'transport_error' : outcome
  console.warn('[nova_admission]', JSON.stringify({ operation: admissionOperations.has(operation) ? operation : 'unknown',
    outcome: failure, duration_ms: Math.max(0, Date.now() - started) }))
}
export async function admissionRPC(admin, name, args) {
  const started = Date.now(), signal = AbortSignal.timeout(3000)
  if (typeof admin?.rpc !== 'function') {
    admissionDiagnostic(name, 'missing_client', started)
    return { status: 'unavailable' }
  }
  try {
    let query = admin.rpc(name, args)
    if (typeof query?.abortSignal === 'function') query = query.abortSignal(signal)
    const { data, error } = await query
    if (error || !data || typeof data.status !== 'string') {
      admissionDiagnostic(name, error ? 'database_error' : 'malformed_response', started, signal, error)
      return { status: 'unavailable' }
    }
    if (data.status === 'unavailable') admissionDiagnostic(name, 'database_unavailable', started)
    for (const alert of Array.isArray(data.budget_alerts) ? data.budget_alerts : []) {
      if (typeof alert.scope === 'string' && Number.isFinite(Number(alert.threshold_percent))) {
        console.warn('[ai_budget_alert]', JSON.stringify({ id: alert.id, scope: alert.scope,
          period_start: alert.period_start, threshold_percent: Number(alert.threshold_percent), snapshot: alert.snapshot }))
      }
    }
    if (data.reservation_overrun === true) console.warn('[ai_budget_alert]', JSON.stringify({ scope: 'reservation_overrun' }))
    return data
  } catch (error) {
    admissionDiagnostic(name, 'database_error', started, signal, error)
    return { status: 'unavailable' }
  }
}

export async function recoverNovaReplay({ admin, userId, requestId, message, actionType }) {
  // One read after uncertain admission, never another mutating admission or a
  // provider authorization. A completed row is immutable until TTL/account
  // cleanup; ownership, exact intent and expiry must still match after the read.
  const started = Date.now(), signal = AbortSignal.timeout(1500)
  const unavailable = () => ({ status: 'unavailable' })
  if (typeof admin?.from !== 'function' || !userId || !requestId || typeof message !== 'string' || !actionType) return unavailable()
  const fingerprint = createHash('sha256').update(message.trim()).digest('hex')
  try {
    const query = admin.from('focus_ai_requests')
      .select('user_id,request_id,fingerprint,action_type,state,response_expires_at,response')
      .eq('user_id', userId).eq('request_id', requestId).eq('fingerprint', fingerprint).eq('action_type', actionType)
      .in('state', ['completed', 'failed']).gt('response_expires_at', new Date(started).toISOString()).limit(1).maybeSingle()
    if (typeof query?.abortSignal !== 'function') return unavailable()
    const { data, error } = await query.abortSignal(signal)
    if (error || signal.aborted) {
      admissionDiagnostic('durable_replay_read', 'database_error', started, signal, error)
      return unavailable()
    }
    const cached = data?.response
    if (!data || data.user_id !== userId || data.request_id !== requestId || data.fingerprint !== fingerprint
      || data.action_type !== actionType || !Number.isFinite(Date.parse(data.response_expires_at))
      || Date.parse(data.response_expires_at) <= Date.now()
      || !((data.state === 'completed' && cached?.httpStatus === 200) || (data.state === 'failed' && cached?.httpStatus === 503))
      || cached.body?.requestId !== requestId || !Array.isArray(cached.body.actions) || !Array.isArray(cached.body.proposed_actions)) {
      admissionDiagnostic('durable_replay_read', 'not_recoverable', started)
      return unavailable()
    }
    admissionDiagnostic('durable_replay_read', 'recovered', started)
    return { status: 'replay', response: cached }
  } catch (error) {
    admissionDiagnostic('durable_replay_read', 'database_error', started, signal, error)
    return unavailable()
  }
}
export async function admitNovaRequest({ admin, userId, requestId, message, actionType, plan, reserveUSD, modelAttemptsRequired = false }) {
  if (!paidAICallsEnabled()) return { status: 'unavailable', reason: 'paid_ai_disabled' }
  const policy = { ...admissionPolicy(), model_attempts_required: modelAttemptsRequired }
  if (!policy.alert_percentages.length || policy.economy_percent <= 0 || policy.sol_share_alert_percent <= 0) return { status: 'unavailable', reason: 'invalid_alert_policy' }
  if (['daily_budget_usd','monthly_budget_usd','user_daily_budget_usd','user_monthly_budget_usd','request_budget_usd'].some(key => policy[key] <= 0)) return { status: 'budget', budget_level: 'blocked' }
  return admissionRPC(admin, 'focus_ai_admit', { p_user_id: userId, p_request_id: requestId,
    p_fingerprint: createHash('sha256').update(message.trim()).digest('hex'), p_action_type: actionType,
    p_limits: quotaLimits(plan, actionType), p_reserve_usd: reserveUSD, p_policy: policy })
}
export const consumeNovaQuota = ({ admin, userId, requestId, leaseId, actionType, plan }) => admissionRPC(admin, 'focus_ai_consume', {
  p_user_id: userId, p_request_id: requestId, p_lease_id: leaseId, p_action_type: actionType, p_limits: quotaLimits(plan, actionType) })
export const finishNovaRequest = ({ admin, userId, requestId, leaseId, response, actualUSD, outcome }) => admissionRPC(admin, 'focus_ai_finish', {
  p_user_id: userId, p_request_id: requestId, p_lease_id: leaseId, p_response: response,
  p_actual_usd: actualUSD, p_outcome: outcome })

export async function beginNovaAttempt({ admin, userId, requestId, leaseId, attemptIndex, route, reserveUSD }) {
  if (!paidAICallsEnabled()) return { status: 'unavailable', reason: 'paid_ai_disabled' }
  if (!route || route.provider !== 'openai' || !['luna','terra','sol'].includes(route.tier) || route.model !== `gpt-5.6-${route.tier}`) {
    return { status: 'unavailable', reason: 'invalid_model' }
  }
  const rawReason = route.reason || route.escalationReason || 'unspecified'
  const reason = typeof rawReason === 'string' && /^[a-zA-Z0-9_:-]{1,96}$/.test(rawReason) ? rawReason : 'unspecified'
  return admissionRPC(admin, 'focus_ai_begin_attempt', { p_user_id: userId, p_request_id: requestId,
    p_lease_id: leaseId, p_attempt_index: attemptIndex, p_model: route.model, p_tier: route.tier,
    p_reserve_usd: reserveUSD ?? reserveAttemptCost(route), p_policy: admissionPolicy(), p_reason: reason })
}
export const settleNovaAttempt = ({ admin, userId, requestId, leaseId, attemptIndex, actualUSD, outcome }) => admissionRPC(admin, 'focus_ai_settle_attempt', {
  p_user_id: userId, p_request_id: requestId, p_lease_id: leaseId, p_attempt_index: attemptIndex,
  p_actual_usd: actualUSD ?? null, p_outcome: outcome })
export const novaModelMetrics = ({ admin }) => admissionRPC(admin, 'focus_ai_model_metrics', { p_policy: admissionPolicy() })
export const novaPaidControl = ({ admin }) => admissionRPC(admin, 'focus_ai_get_control', {})
export const setNovaPaidControl = ({ admin, enabled }) => admissionRPC(admin, 'focus_ai_set_control', { p_paid_enabled: enabled })

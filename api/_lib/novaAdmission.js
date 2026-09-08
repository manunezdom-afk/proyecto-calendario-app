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
export function admissionPolicy() {
  return {
    requests_per_minute: Math.floor(numeric('AI_USER_REQUESTS_PER_MINUTE', 5, 30)), max_concurrent: 1, lease_seconds: 55,
    daily_budget_usd: numeric('AI_DAILY_BUDGET_USD', 5, 1000), monthly_budget_usd: numeric('AI_MONTHLY_BUDGET_USD', 50, 10000),
    user_daily_budget_usd: numeric('AI_USER_DAILY_BUDGET_USD', 0.25, 10), user_monthly_budget_usd: numeric('AI_USER_MONTHLY_BUDGET_USD', 5, 100),
  }
}
export function quotaLimits(plan, actionType) {
  const cfg = getLimit(plan, actionType)
  if (!cfg || cfg.enabled === false) return {}
  return Object.fromEntries(['daily', 'weekly', 'monthly'].filter(key => Number.isInteger(cfg[key])).map(key => [key, cfg[key]]))
}
export function reserveAttemptCost(route, inputTokens = route.inputTokens ?? novaInputTokenLimit()) {
  const pricing = getModelPricing(route.model, { conservative: true, requireCurrent: true, inputTokens })
  if (!pricing || pricing.provider !== route.provider) throw Object.assign(new Error('pricing_unavailable'), { code: 'pricing_unavailable' })
  // No caching is explicitly requested, but allow the largest documented write
  // price so provider caching cannot make the reservation optimistic.
  return Math.ceil((inputTokens * Math.max(pricing.input, pricing.cacheWrite || 0,
    pricing.cacheWrite5m || 0, pricing.cacheWrite1h || 0) + route.maxOutputTokens * pricing.output) / 1000) / 1000
}
export function reserveRequestCost(routes) {
  const amount = routes.reduce((sum, route) => sum + reserveAttemptCost(route), 0)
  if (amount > numeric('AI_MAX_COST_PER_REQUEST_USD', 0.10, 0.50)) throw Object.assign(new Error('request_cost_limit'), { code: 'request_cost_limit' })
  return amount
}
export async function admissionRPC(admin, name, args) {
  if (typeof admin?.rpc !== 'function') return { status: 'unavailable' }
  try {
    let query = admin.rpc(name, args)
    if (typeof query?.abortSignal === 'function') query = query.abortSignal(AbortSignal.timeout(3000))
    const { data, error } = await query
    if (error || !data || typeof data.status !== 'string') return { status: 'unavailable' }
    return data
  } catch { return { status: 'unavailable' } }
}
export async function admitNovaRequest({ admin, userId, requestId, message, actionType, plan, reserveUSD }) {
  if (!paidAICallsEnabled()) return { status: 'unavailable', reason: 'paid_ai_disabled' }
  const policy = admissionPolicy()
  if (Object.entries(policy).some(([key,value]) => key.includes('budget_usd') && value <= 0)) return { status: 'budget', budget_level: 'blocked' }
  return admissionRPC(admin, 'focus_ai_admit', { p_user_id: userId, p_request_id: requestId,
    p_fingerprint: createHash('sha256').update(message.trim()).digest('hex'), p_action_type: actionType,
    p_limits: quotaLimits(plan, actionType), p_reserve_usd: reserveUSD, p_policy: policy })
}
export const consumeNovaQuota = ({ admin, userId, requestId, leaseId, actionType, plan }) => admissionRPC(admin, 'focus_ai_consume', {
  p_user_id: userId, p_request_id: requestId, p_lease_id: leaseId, p_action_type: actionType, p_limits: quotaLimits(plan, actionType) })
export const finishNovaRequest = ({ admin, userId, requestId, leaseId, response, actualUSD, outcome }) => admissionRPC(admin, 'focus_ai_finish', {
  p_user_id: userId, p_request_id: requestId, p_lease_id: leaseId, p_response: response,
  p_actual_usd: actualUSD, p_outcome: outcome })

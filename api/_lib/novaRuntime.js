import { ASSISTANT_NAME } from './assistantBrand.js'
import { buildDateContext } from './dateContext.js'
import { buildOpenAISystemPrompt, NOVA_OPENAI_SCHEMA, callOpenAINova, extractResponsesText } from './openaiNova.js'
import { callDeepSeekNova, buildDeepSeekJsonAppendix, extractDeepSeekText } from './deepseekNova.js'
import { callAnthropicNova, extractAnthropicText } from './anthropicNova.js'
import { validateNovaPlan } from './novaContract.js'
import { boundNovaInput, providerFallbackEnabled, novaOutputTokenLimit, novaInputUpperBound, paidAICallsEnabled } from './novaSafety.js'
import { ACTION_TYPES, messageForLimit } from './usageLimits.js'
import { extractAnthropicUsage, trackAIUsageEvent } from './aiUsageTracking.js'
import { calculateAICost, normalizeModelName } from './aiPricing.js'
import { detectComplexInput, isClarificationReply } from './novaComplexity.js'
import { admitNovaRequest, finishNovaRequest, consumeNovaQuota, reserveAttemptCost, reserveRequestCost } from './novaAdmission.js'

const KEYS = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', deepseek: 'DEEPSEEK_API_KEY' }
const CHEAP = { openai: 'gpt-5.6-luna', anthropic: 'claude-haiku-4-5-20251001', deepseek: 'deepseek-v4-flash' }
const PREMIUM = { openai: 'gpt-5.6-terra', anthropic: 'claude-sonnet-4-6', deepseek: 'deepseek-v4-pro' }
export const premiumEnabled = () => process.env.AI_ENABLE_PREMIUM_FALLBACK?.trim().toLowerCase() === 'true'
export function selectNovaRoutes() {
  if (!paidAICallsEnabled()) throw Object.assign(new Error('paid_ai_disabled'), { code: 'paid_ai_disabled' })
  const provider = process.env.NOVA_PROVIDER?.trim().toLowerCase() || 'anthropic'
  if (!KEYS[provider]) throw Object.assign(new Error('provider_unavailable'), { code: 'provider_unavailable' })
  const forced = process.env[`${provider.toUpperCase()}_NOVA_MODEL`]?.trim()
  const model = forced || CHEAP[provider]
  const isPremium = normalizeModelName(model) !== normalizeModelName(CHEAP[provider])
  if (isPremium && !premiumEnabled()) throw Object.assign(new Error('premium_disabled'), { code: 'premium_disabled' })
  if (!process.env[KEYS[provider]]?.trim()) throw Object.assign(new Error('provider_unavailable'), { code: 'provider_unavailable' })
  const first = { provider, model, premium: isPremium, maxOutputTokens: novaOutputTokenLimit(process.env.AI_MAX_OUTPUT_TOKENS, 1600) }
  // The measured rollout starts with one economical candidate. Complexity is
  // observed, never permission to use premium. A premium/provider fallback is
  // opt-in and runs only after transport or structural-output failure.
  const routes = [first]
  if (premiumEnabled() && !isPremium) routes.push({ ...first, model: PREMIUM[provider], premium: true })
  else if (providerFallbackEnabled()) {
    const alternate = Object.keys(CHEAP).find(name => name !== provider && process.env[KEYS[name]]?.trim())
    if (alternate) routes.push({ provider: alternate, model: CHEAP[alternate], premium: false, maxOutputTokens: first.maxOutputTokens })
  }
  // One explicit retry is reserved in advance. No third attempt or SDK retry.
  if (routes.length === 1) routes.push({ ...first })
  return routes
}
function usageFor(provider, data) {
  const usage = data?.usage
  if (!usage) return { input_tokens: 0, output_tokens: 0, source: 'unavailable' }
  const input = usage.input_tokens ?? usage.prompt_tokens
  const output = usage.output_tokens ?? usage.completion_tokens
  const cache = [usage.cache_read_input_tokens, usage.cache_creation_input_tokens,
    usage.input_tokens_details?.cached_tokens, usage.input_tokens_details?.cache_write_tokens, usage.prompt_cache_hit_tokens]
  if (![input, output].every(value => Number.isSafeInteger(value) && value >= 0)
    || cache.some(value => value != null && (!Number.isSafeInteger(value) || value < 0))) return { input_tokens: 0, output_tokens: 0, source: 'unavailable' }
  if (provider === 'anthropic') return extractAnthropicUsage(data)
  return { input_tokens: input, output_tokens: output,
    cached_input_tokens: usage.input_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0,
    cache_creation_input_tokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
    source: `${provider}_usage` }
}
const unavailable = requestId => ({ httpStatus: 503, body: { error: 'assistant_unavailable', requestId,
  message: `${ASSISTANT_NAME} no está disponible por un momento. Puedes crear tus pendientes manualmente y volver a intentarlo.`, actions: [], proposed_actions: [] } })
function admissionResponse(admission, requestId, plan) {
  if (admission.status === 'replay' && admission.response?.body) return admission.response
  if (['conflict', 'in_progress', 'concurrency'].includes(admission.status)) return { httpStatus: 409, body: {
    error: admission.status === 'conflict' ? 'request_conflict' : 'request_in_progress', requestId,
    message: admission.status === 'conflict' ? 'Este envío ya no puede repetirse. Revisa el resultado antes de iniciar otro.' : 'Hay una solicitud en curso. Espera un momento.', actions: [] } }
  if (['rate', 'quota', 'budget'].includes(admission.status)) return { httpStatus: 429, body: {
    error: admission.status === 'budget' ? 'ai_budget_reached' : admission.status === 'rate' ? 'rate_limit' : 'quota_exceeded', requestId,
    message: admission.status === 'quota' ? messageForLimit(plan, ACTION_TYPES.NOVA_MESSAGE) : 'Llegaste al límite de uso por ahora. Puedes seguir creando tus pendientes manualmente.', actions: [] } }
  return unavailable(requestId)
}
function relevantContext(body, dateContext) {
  const normalized = body.message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const terms = normalized.match(/[a-z0-9]{3,}/g) || []
  const score = (item, title) => terms.filter(term => title.toLowerCase().includes(term)).length * 100
    + (body.discussedEventIds.includes(item.id) ? 1000 : 0) + (item.date === dateContext.todayISO ? 10 : 0)
  const events = [...body.events].sort((a,b) => score(b,b.title)-score(a,a.title)).slice(0, 12)
  const tasks = [...body.tasks].sort((a,b) => score(b,b.label)-score(a,a.label)).slice(0, 12)
  const memories = [...body.userMemories, ...body.memories.map(memory => memory.content)]
    .map((content,index) => ({ content, index, score: terms.filter(term => content.toLowerCase().includes(term)).length }))
    .sort((a,b) => b.score-a.score || a.index-b.index).slice(0, 6).map(item => item.content)
  return { events, tasks, memories }
}

export async function executeNovaRequest({ admin, userId, requestId, body, plan,
  callProviders = { openai: callOpenAINova, deepseek: callDeepSeekNova, anthropic: callAnthropicNova },
  track = trackAIUsageEvent } = {}) {
  const started = Date.now()
  let routes, reserveUSD
  try { routes = selectNovaRoutes() } catch { return unavailable(requestId) }
  const dateContext = buildDateContext(body.clientNow, body.clientTimezone)
  const context = relevantContext(body, dateContext)
  let basePrompt, histories
  // Keep the current message intact. Trim only context and old history before
  // admission; if even the fixed contract does not fit, no paid call occurs.
  try {
    while (true) {
      basePrompt = buildOpenAISystemPrompt({ ...dateContext, ...context, discussedEventIds: body.discussedEventIds })
      try {
        histories = routes.map(route => boundNovaInput({ systemPrompt: basePrompt + (route.provider === 'deepseek' ? buildDeepSeekJsonAppendix() : ''),
          message: body.message, history: body.history, schema: route.provider === 'deepseek' ? undefined : NOVA_OPENAI_SCHEMA.schema }))
        break
      } catch (error) {
        if (context.events.length > 1) context.events.pop()
        else if (context.tasks.length > 1) context.tasks.pop()
        else if (context.memories.length > 1) context.memories.pop()
        else throw error
      }
    }
  } catch { return { httpStatus: 400, body: { error: 'input_budget_exceeded', requestId,
    message: 'Divide este mensaje en solicitudes más pequeñas para poder revisarlas bien.', actions: [] } } }
  try {
    routes = routes.map((route, index) => ({ ...route, inputTokens: novaInputUpperBound({
      systemPrompt: basePrompt + (route.provider === 'deepseek' ? buildDeepSeekJsonAppendix() : ''), message: body.message,
      history: histories[index], schema: route.provider === 'deepseek' ? undefined : NOVA_OPENAI_SCHEMA.schema }) }))
    try { reserveUSD = reserveRequestCost(routes) } catch (error) {
      // An optional fallback must never make an affordable primary unavailable.
      // If it cannot fit the hard per-request cap, admit only the primary.
      if (error.code !== 'request_cost_limit' || routes.length < 2) throw error
      routes = routes.slice(0, 1); reserveUSD = reserveRequestCost(routes)
    }
  } catch { return unavailable(requestId) }
  const admission = await admitNovaRequest({ admin, userId, requestId, message: body.message, actionType: ACTION_TYPES.NOVA_MESSAGE, plan, reserveUSD })
  if (admission.status !== 'admitted') return admissionResponse(admission, requestId, plan)
  const leaseId = admission.lease_id
  let actualUSD = 0, trackingOK = true, response = unavailable(requestId)
  let previousError = 'primary', attempts = 0
  const complexity = detectComplexInput(body.message) ? 'complex' : isClarificationReply(body.history) ? 'continuation' : 'simple'
  const signal = AbortSignal.timeout(Math.max(1, 43000 - (Date.now() - started)))
  for (let index = 0; index < routes.length; index++) {
    let route = routes[index]
    if (signal.aborted || Date.now() - started >= 40000) break
    if (admission.budget_level === 'economy') {
      if (index > 0) break
      if (route.premium) route = { ...route, model: CHEAP[route.provider], premium: false }
    }
    if (route.premium) {
      if (!premiumEnabled()) break
      const quota = await consumeNovaQuota({ admin, userId, requestId, leaseId, actionType: ACTION_TYPES.NOVA_PREMIUM_MESSAGE, plan })
      if (quota.status !== 'ok') break
    }
    if (signal.aborted || !paidAICallsEnabled()) break
    let data, result, error
    attempts++
    const attemptStarted = Date.now()
    try {
      data = await callProviders[route.provider]({ model: route.model, apiKey: process.env[KEYS[route.provider]].trim(),
        reqId: requestId, message: body.message, history: histories[index], systemPrompt: basePrompt + (route.provider === 'deepseek' ? buildDeepSeekJsonAppendix() : ''),
        maxOutputTokens: route.maxOutputTokens, reasoningEffort: 'low',
        signal: AbortSignal.any([signal, AbortSignal.timeout(18000)]) })
      const text = ({ openai: extractResponsesText, anthropic: extractAnthropicText, deepseek: extractDeepSeekText })[route.provider](data)
      if (text.length > 100000) throw Object.assign(new Error('output_too_large'), { code: 'invalid_schema' })
      let payload
      try { payload = JSON.parse(text) } catch { throw Object.assign(new Error('invalid_json'), { code: 'invalid_json' }) }
      result = validateNovaPlan({ payload, userMessage: body.message, history: histories[index],
        events: body.events, tasks: body.tasks, memories: context.memories,
        discussedEventIds: body.discussedEventIds, dateContext, requestId })
      if (!result.validation.ok) error = Object.assign(new Error('invalid_plan'), { code: 'invalid_plan' })
    } catch (failure) { error = failure }
    const usage = usageFor(route.provider, data)
    const estimate = usage.source === 'unavailable' ? reserveAttemptCost(route)
      : calculateAICost({ model: route.model, ...usage, at: new Date(attemptStarted), conservative: false }).cost_usd_unrounded
    actualUSD += estimate
    let recorded
    try { recorded = await track({ admin, userId, action_type: ACTION_TYPES.NOVA_MESSAGE, endpoint: 'focus-assistant',
      model: route.model, usage, cost_override_usd: estimate, success: !error,
      error_type: error ? (error.code || (error.status ? `http_${error.status}` : error.name === 'AbortError' || error.name === 'TimeoutError' ? 'timeout' : 'provider_error')) : null,
      duration_ms: Date.now() - attemptStarted, metadata: { request_id: requestId, admission_lease_id: leaseId,
        provider: route.provider, tier: route.premium ? 'premium' : 'standard', retry_attempt: index,
        budget_level: admission.budget_level, input_token_limit: route.inputTokens,
        output_token_limit: route.maxOutputTokens, cost_basis: usage.source === 'unavailable' ? 'reservation' : 'provider_usage',
        escalation_reason: previousError, complexity,
        clarification: !!(result?.shouldAskUser || result?.follow_up_question),
        validation_ok: result?.validation?.ok === true,
        schema_valid: !!result && !result.validation.issues.includes('invalid_schema'),
        request_elapsed_ms: Date.now() - started,
        action_count: (result?.actions?.length || 0) + (result?.proposed_actions?.length || 0) } }) } catch { recorded = { ok: false } }
    trackingOK = trackingOK && recorded?.ok === true
    previousError = error ? (error.code || (error.status ? `http_${error.status}` : 'provider_error')) : 'none'
    if (!trackingOK) break
    if (result) {
      if (result.actions.length || result.proposed_actions.length) {
        const quota = await consumeNovaQuota({ admin, userId, requestId, leaseId, actionType: ACTION_TYPES.NOVA_SMART_ACTION, plan })
        if (quota.status !== 'ok') {
          response = quota.status === 'quota' ? { httpStatus: 200, body: { ...result, actions: [], proposed_actions: [], execution_pending: false,
            mode: 'chat_only', reply: messageForLimit(plan, ACTION_TYPES.NOVA_SMART_ACTION), smart_actions_blocked: true,
            smart_actions_message: messageForLimit(plan, ACTION_TYPES.NOVA_SMART_ACTION) } } : unavailable(requestId)
          break
        }
      }
      response = { httpStatus: 200, body: result }
      break // Semantic rejection asks the user; paying again cannot grant intent.
    }
    if (error?.status === 400 || error?.status === 401 || error?.status === 403 || error?.code === 'provider_refusal') break
  }
  if (!trackingOK) { response = unavailable(requestId); actualUSD = Math.max(actualUSD, reserveUSD) }
  // Only a durable terminal failure may close the client's logical UUID.
  // An explicit next retry then starts a new request; ambiguous network or
  // persistence failures keep the UUID so a completed plan can be recovered.
  if (response.httpStatus === 503) response.body = { ...response.body, request_completed: true, request_retryable: true }
  const finalized = await finishNovaRequest({ admin, userId, requestId, leaseId, response, actualUSD,
    outcome: response.httpStatus === 200 ? 'success' : 'failed' })
  if (finalized.status !== 'completed') return unavailable(requestId)
  // Whole-request latency includes the final durable replay write. The attempt
  // table separately retains provider duration and elapsed time at each attempt.
  console.info('[nova_request]', JSON.stringify({ request_id: requestId, attempts,
    request_total_ms: Date.now() - started, status: response.httpStatus,
    estimated_cost_usd: Math.round(actualUSD * 1e9) / 1e9 }))
  return response
}

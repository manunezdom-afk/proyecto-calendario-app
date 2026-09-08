import { ASSISTANT_NAME } from './assistantBrand.js'
import { buildDateContext } from './dateContext.js'
import { buildOpenAISystemPrompt, NOVA_OPENAI_SCHEMA, callOpenAINova, extractResponsesText } from './openaiNova.js'
import { validateNovaPlan, relativeDepartureSchedule } from './novaContract.js'
import { boundNovaInput, novaInputUpperBound, paidAICallsEnabled } from './novaSafety.js'
import { ACTION_TYPES, messageForLimit } from './usageLimits.js'
import { trackAIUsageEvent } from './aiUsageTracking.js'
import { calculateAICost, getModelPricing } from './aiPricing.js'
import { selectNovaRoutes, novaTierRoute, shouldEscalateNova } from './novaRouter.js'
import { activePendingProposal } from './novaPendingProposal.js'
import { admitNovaRequest, finishNovaRequest, consumeNovaQuota, reserveAttemptCost, reserveRequestCost,
  beginNovaAttempt, settleNovaAttempt } from './novaAdmission.js'
export { selectNovaRoutes } from './novaRouter.js'

function usageFor(data) {
  const usage = data?.usage
  const input = usage?.input_tokens, output = usage?.output_tokens
  const cached = usage?.input_tokens_details?.cached_tokens
  const written = usage?.input_tokens_details?.cache_write_tokens
  const reasoning = usage?.output_tokens_details?.reasoning_tokens ?? 0
  if (![input, output, cached, written, reasoning].every(value => Number.isSafeInteger(value) && value >= 0)
    || cached + written > input || reasoning > output) return { input_tokens: 0, output_tokens: 0, source: 'unavailable' }
  return { input_tokens: input, output_tokens: output, cached_input_tokens: cached,
    cache_creation_input_tokens: written, reasoning_tokens: reasoning, source: 'openai_usage' }
}
const unavailable = requestId => ({ httpStatus: 503, body: { error: 'assistant_unavailable', requestId,
  message: `${ASSISTANT_NAME} no está disponible por un momento. Puedes crear tus pendientes manualmente y volver a intentarlo.`, actions: [], proposed_actions: [] } })
function admissionResponse(admission, requestId, plan) {
  if (admission.status === 'replay' && admission.response?.body) return admission.response
  if (['conflict', 'in_progress', 'concurrency', 'already_started'].includes(admission.status)) return { httpStatus: 409, body: {
    error: admission.status === 'conflict' ? 'request_conflict' : 'request_in_progress', requestId,
    message: admission.status === 'conflict' ? 'Este envío ya no puede repetirse. Revisa el resultado antes de iniciar otro.' : 'Hay una solicitud en curso. Espera un momento.', actions: [] } }
  if (['rate', 'quota', 'budget', 'model_budget', 'model_quota', 'economy'].includes(admission.status)) return { httpStatus: 429, body: {
    error: ['budget', 'model_budget', 'economy'].includes(admission.status) ? 'ai_budget_reached' : admission.status === 'rate' ? 'rate_limit' : 'quota_exceeded', requestId,
    message: admission.status === 'quota' ? messageForLimit(plan, ACTION_TYPES.NOVA_MESSAGE) : 'Llegaste al límite de uso por ahora. Puedes seguir creando tus pendientes manualmente.', actions: [] } }
  return unavailable(requestId)
}
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
function relevantContext(body, dateContext, route) {
  const text = normalize(body.message)
  const terms = text.match(/[a-z0-9]{3,}/g) || []
  const planning = route.decision?.signals.planning
  const score = (item, title) => terms.filter(term => normalize(title).includes(term)).length * 100
    + (body.discussedEventIds.includes(item.id) ? 1000 : 0)
    + (item.date === dateContext.todayISO ? 10 : item.date === dateContext.tomorrow ? 8 : 0)
  const events = [...body.events].sort((a,b) => score(b,b.title)-score(a,a.title)).slice(0, route.events)
  const tasks = [...body.tasks].sort((a,b) => score(b,b.label)-score(a,a.label)).slice(0, route.tasks)
  const memoryQuery = /\b(?:que sabes|que recuerdas|mis preferencias)\b/.test(text)
  const memories = [...body.userMemories, ...body.memories.map(memory => memory.content)]
    .map((content,index) => ({ content, index, score: terms.filter(term => normalize(content).includes(term)).length }))
    .filter(item => item.score > 0 || memoryQuery || planning && /\b(?:prefiero|estudi|dorm|trabaj|horario|gusta)/.test(normalize(item.content)))
    .sort((a,b) => b.score-a.score || a.index-b.index).slice(0, route.memories).map(item => item.content)
  return { events, tasks, memories }
}
export function prepareNovaRoute(body, dateContext, route) {
  const context = relevantContext(body, dateContext, route)
  const temporalHints = relativeDepartureSchedule(body.message, dateContext)
  while (true) {
    const systemPrompt = buildOpenAISystemPrompt({ ...dateContext, ...context, temporalHints, discussedEventIds: body.discussedEventIds,
      pendingProposal: activePendingProposal(body.message, body.pendingProposal, body.events) })
    try {
      const history = boundNovaInput({ systemPrompt, message: body.message, history: body.history,
        schema: NOVA_OPENAI_SCHEMA.schema, maxInputTokens: route.maxInputTokens })
      return { ...route, systemPrompt, history, memories: context.memories,
        inputTokens: novaInputUpperBound({ systemPrompt, message: body.message, history, schema: NOVA_OPENAI_SCHEMA.schema }) }
    } catch (error) {
      if (context.memories.length) context.memories.pop()
      else if (context.tasks.length) context.tasks.pop()
      else if (context.events.length) context.events.pop()
      else throw error
    }
  }
}
// DOMException TimeoutError has numeric code 23; keep a useful closed error
// category instead of leaking that implementation detail into routing metrics.
const errorCode = error => ['AbortError','TimeoutError'].includes(error?.name) ? 'timeout'
  : typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(error.code) ? error.code
    : error?.status ? `http_${error.status}` : 'provider_error'

/** One production chat provider; every explicit attempt requires an atomic lease. */
export async function executeNovaRequest({ admin, userId, requestId, body, plan,
  callProviders = { openai: callOpenAINova }, track = trackAIUsageEvent } = {}) {
  const started = Date.now()
  if (!paidAICallsEnabled() || !process.env.OPENAI_API_KEY?.trim()) return unavailable(requestId)
  const dateContext = buildDateContext(body.clientNow, body.clientTimezone)
  let routes, reserveUSD
  try {
    routes = selectNovaRoutes(body)
    // Sol pricing expiry disables that tier, not economical everyday service.
    if (routes[0].tier === 'sol' && !getModelPricing(routes[0].model, { requireCurrent: true })) {
      routes = [{ ...novaTierRoute('terra'), decision: routes[0].decision, routeReason: 'sol_pricing_unavailable' }]
    }
    routes = routes.filter(route => getModelPricing(route.model, { requireCurrent: true }))
    if (!routes.length) return unavailable(requestId)
    routes = routes.map(route => prepareNovaRoute(body, dateContext, route))
    try { reserveUSD = reserveRequestCost(routes) } catch (error) {
      if (error.code !== 'request_cost_limit' || routes.length < 2) throw error
      routes = routes.slice(0, 1); reserveUSD = reserveRequestCost(routes)
    }
  } catch (error) {
    return error.code === 'input_budget_exceeded' ? { httpStatus: 400, body: { error: 'input_budget_exceeded', requestId,
      message: 'Divide este mensaje en solicitudes más pequeñas para poder revisarlas bien.', actions: [] } } : unavailable(requestId)
  }
  let admission = await admitNovaRequest({ admin, userId, requestId, message: body.message,
    actionType: ACTION_TYPES.NOVA_MESSAGE, plan, reserveUSD, modelAttemptsRequired: true })
  // A denied budget admission creates no request or quota charge. Retry admission
  // once with a smaller, single-route reservation so a possible repair cannot
  // block an affordable primary. Never resize an admitted lease or retry an
  // uncertain result; the same request ID remains protected by the DB lock.
  if (admission.status === 'budget' && (routes.length > 1 || routes[0].tier === 'sol')) {
    try {
      const economical = routes[0].tier === 'sol'
        ? prepareNovaRoute(body, dateContext, { ...novaTierRoute('terra'), decision: routes[0].decision, routeReason: 'budget_reservation_downgrade' })
        : { ...routes[0], routeReason: 'budget_primary_only' }
      const smallerReserve = reserveRequestCost([economical])
      if (smallerReserve < reserveUSD) {
        routes = [economical]; reserveUSD = smallerReserve
        admission = await admitNovaRequest({ admin, userId, requestId, message: body.message,
          actionType: ACTION_TYPES.NOVA_MESSAGE, plan, reserveUSD, modelAttemptsRequired: true })
      }
    } catch { /* Keep the original budget denial if the smaller route is invalid. */ }
  }
  if (admission.status !== 'admitted') return admissionResponse(admission, requestId, plan)
  const leaseId = admission.lease_id
  const signal = AbortSignal.timeout(Math.max(1, 43000 - (Date.now() - started)))
  let actualUSD = 0, trackingOK = true, response = unavailable(requestId), previousError = null, attempts = 0
  let premiumDenied = false
  for (let index = 0; index < routes.length; index++) {
    let route = routes[index]
    if (signal.aborted || Date.now() - started >= 40000 || !paidAICallsEnabled()) break
    if ((admission.budget_level === 'economy' && route.tier === 'sol') || premiumDenied) {
      route = prepareNovaRoute(body, dateContext, { ...novaTierRoute(premiumDenied ? 'luna' : 'terra'), decision: route.decision, routeReason: 'economic_downgrade' })
    }
    if (route.premium) {
      const quota = await consumeNovaQuota({ admin, userId, requestId, leaseId, actionType: ACTION_TYPES.NOVA_PREMIUM_MESSAGE, plan })
      if (quota.status === 'quota') {
        premiumDenied = true
        route = prepareNovaRoute(body, dateContext, { ...novaTierRoute('luna'), decision: route.decision, routeReason: 'premium_quota_downgrade' })
      } else if (quota.status !== 'ok') { response = unavailable(requestId); break }
    }
    let attemptReserve = reserveAttemptCost(route)
    let authorization = await beginNovaAttempt({ admin, userId, requestId, leaseId, attemptIndex: index,
      route: { ...route, reason: previousError || route.routeReason }, reserveUSD: attemptReserve })
    if (route.tier === 'sol' && ['model_budget','model_quota','economy'].includes(authorization.status)) {
      route = prepareNovaRoute(body, dateContext, { ...novaTierRoute('terra'), decision: route.decision, routeReason: 'sol_limit_downgrade' })
      attemptReserve = reserveAttemptCost(route)
      authorization = await beginNovaAttempt({ admin, userId, requestId, leaseId, attemptIndex: index,
        route: { ...route, reason: route.routeReason }, reserveUSD: attemptReserve })
    }
    if (authorization.status !== 'started') {
      if (response.httpStatus !== 200) response = admissionResponse(authorization, requestId, plan)
      break
    }
    // No request is sent after a kill switch change, including during DB waits.
    if (signal.aborted || !paidAICallsEnabled()) {
      await settleNovaAttempt({ admin, userId, requestId, leaseId, attemptIndex: index, actualUSD: 0, outcome: 'failed' })
      break
    }
    let data, result, error
    const attemptStarted = Date.now(); attempts++
    try {
      data = await callProviders.openai({ model: route.model, apiKey: process.env.OPENAI_API_KEY.trim(), reqId: requestId,
        message: body.message, history: route.history, systemPrompt: route.systemPrompt,
        maxOutputTokens: route.maxOutputTokens, maxInputTokens: route.maxInputTokens,
        reasoningEffort: route.reasoningEffort, timeoutMs: route.timeoutMs,
        signal: AbortSignal.any([signal, AbortSignal.timeout(route.timeoutMs)]) })
      const output = extractResponsesText(data)
      if (output.length > 100000) throw Object.assign(new Error('output_too_large'), { code: 'output_too_large' })
      let payload
      try { payload = JSON.parse(output) } catch { throw Object.assign(new Error('invalid_json'), { code: 'invalid_json' }) }
      result = validateNovaPlan({ payload, userMessage: body.message, history: route.history,
        events: body.events, tasks: body.tasks, memories: route.memories, discussedEventIds: body.discussedEventIds,
        pendingProposal: body.pendingProposal, dateContext, requestId })
      if (!result.validation.ok) error = Object.assign(new Error('invalid_plan'), { code: 'invalid_plan' })
    } catch (failure) { error = failure }
    const usage = usageFor(data)
    const pricing = getModelPricing(route.model, { at: new Date(attemptStarted), inputTokens: usage.input_tokens })
    const known = usage.source !== 'unavailable'
    const estimate = known ? calculateAICost({ model: route.model, ...usage, at: new Date(attemptStarted) }).cost_usd_unrounded : attemptReserve
    actualUSD += estimate
    const cacheReadSavings = known ? usage.cached_input_tokens * (pricing.input - pricing.cachedInput) / 1e6 : undefined
    const cacheWritePremium = known ? usage.cache_creation_input_tokens * (pricing.cacheWrite - pricing.input) / 1e6 : undefined
    let recorded
    try {
      recorded = await track({ admin, userId, action_type: ACTION_TYPES.NOVA_MESSAGE, endpoint: 'focus-assistant', model: route.model,
        usage, cost_override_usd: estimate, success: !error, error_type: error ? errorCode(error) : null,
        duration_ms: Date.now() - attemptStarted, metadata: { request_id: requestId, admission_lease_id: leaseId,
          provider: 'openai', tier: route.tier, reasoning_effort: route.reasoningEffort, service_tier: 'default',
          retry_attempt: index, escalated: index > 0 && route.tier !== routes[0].tier,
          routing_reason: route.routeReason, escalation_reason: previousError || 'none', complexity: route.decision.tier,
          budget_level: authorization.budget_level || admission.budget_level,
          input_token_limit: route.maxInputTokens, output_token_limit: route.maxOutputTokens,
          cost_basis: known ? 'provider_usage' : 'reservation', cached_input_tokens: usage.cached_input_tokens,
          cache_read_tokens: usage.cached_input_tokens, cache_creation_tokens: usage.cache_creation_input_tokens,
          cache_write_tokens: usage.cache_creation_input_tokens, cache_hit: known ? usage.cached_input_tokens > 0 : undefined,
          cache_read_savings_usd: cacheReadSavings, cache_write_premium_usd: cacheWritePremium,
          cache_savings_usd: known ? cacheReadSavings - cacheWritePremium : undefined,
          reasoning_tokens: usage.reasoning_tokens, output_reasoning_tokens: usage.reasoning_tokens,
          clarification: !!(result?.shouldAskUser || result?.follow_up_question), validation_ok: result?.validation?.ok === true,
          schema_valid: !!result && !result.validation.issues.includes('invalid_schema'), request_elapsed_ms: Date.now() - started,
          action_count: (result?.actions?.length || 0) + (result?.proposed_actions?.length || 0) } })
    } catch { recorded = { ok: false } }
    const settled = await settleNovaAttempt({ admin, userId, requestId, leaseId, attemptIndex: index,
      actualUSD: recorded?.ok === true ? estimate : Math.max(estimate, attemptReserve), outcome: error || recorded?.ok !== true ? 'failed' : 'success' })
    trackingOK = recorded?.ok === true && settled.status === 'settled'
    previousError = error ? errorCode(error) : result?.shouldAskUser ? 'resolvable_clarification' : 'none'
    if (!trackingOK) { response = unavailable(requestId); break }
    if (result) response = { httpStatus: 200, body: { ...result,
      processing: { route: 'remote_ai', model: route.model, reason: route.routeReason } } }
    if (shouldEscalateNova({ error, result, route, nextRoute: routes[index+1], body }) && !premiumDenied) continue
    break
  }
  if (trackingOK && response.httpStatus === 200 && (response.body.actions.length || response.body.proposed_actions.length)) {
    const quota = await consumeNovaQuota({ admin, userId, requestId, leaseId, actionType: ACTION_TYPES.NOVA_SMART_ACTION, plan })
    if (quota.status !== 'ok') response = quota.status === 'quota' ? { httpStatus: 200, body: { ...response.body,
      actions: [], proposed_actions: [], execution_pending: false, mode: 'chat_only',
      reply: messageForLimit(plan, ACTION_TYPES.NOVA_SMART_ACTION), smart_actions_blocked: true,
      smart_actions_message: messageForLimit(plan, ACTION_TYPES.NOVA_SMART_ACTION) } } : unavailable(requestId)
  }
  if (response.body.mode !== 'proposal' || !response.body.proposed_actions?.length || response.body.smart_actions_blocked) delete response.body.replacesProposalId
  if (!trackingOK) actualUSD = Math.max(actualUSD, reserveUSD)
  if (response.httpStatus === 503) response.body = { ...response.body, request_completed: true, request_retryable: true }
  const finalized = await finishNovaRequest({ admin, userId, requestId, leaseId, response, actualUSD,
    outcome: response.httpStatus === 200 ? 'success' : 'failed' })
  if (finalized.status !== 'completed') return unavailable(requestId)
  console.info('[nova_request]', JSON.stringify({ request_id: requestId, attempts,
    request_total_ms: Date.now() - started, status: response.httpStatus,
    estimated_cost_usd: Math.round(actualUSD * 1e9) / 1e9 }))
  return response
}

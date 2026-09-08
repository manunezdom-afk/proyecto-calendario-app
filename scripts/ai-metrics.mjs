// Read-only telemetry summaries. A provider success is never a persistence receipt.
const CHAT = new Set(['nova_message', 'nova_premium_message'])
const MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']
const number = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null
const model = value => typeof value === 'string' && value.trim() ? (value.trim() === 'gpt-5.6' ? 'gpt-5.6-sol' : value.trim()) : 'unknown'
const time = value => value instanceof Date ? (Number.isFinite(value.getTime()) ? value.getTime() : null)
  : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
const percent = (count, total) => total ? count * 100 / total : null
const sum = values => values.reduce((total, value) => total + value, 0)
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] : null
const stats = values => ({ measured: values.length, sum: values.length ? sum(values) : null,
  mean: values.length ? sum(values) / values.length : null, p50: percentile(values, .5), p95: percentile(values, .95) })
const countBy = values => Object.fromEntries([...new Set(values)].sort().map(key => [key, values.filter(value => value === key).length]))
const distribution = values => Object.fromEntries([...new Set([...MODELS, ...values])].map(key => [key,
  { count: values.filter(value => value === key).length, percent: percent(values.filter(value => value === key).length, values.length) }]))
const indexOfAttempt = row => number(row.metadata?.attempt_index ?? row.metadata?.retry_attempt)
const measuredUsage = row => row.metadata?.usage_source !== 'unavailable' && (row.metadata?.cost_basis === 'provider_usage' ||
  (!row.metadata?.cost_basis && ['openai_usage', 'anthropic_usage', 'deepseek_usage', 'provider_usage'].includes(row.metadata?.usage_source)))
const costOf = row => row.metadata?.usage_source === 'unavailable' && row.metadata?.cost_basis !== 'reservation'
  ? null : number(row.estimated_cost_usd)

export function summarizeCostEvidence(rows) {
  const known = rows.map(costOf).filter(value => value !== null)
  const measured = rows.filter(row => measuredUsage(row) && costOf(row) !== null)
  const reserved = rows.filter(row => row.metadata?.cost_basis === 'reservation' && costOf(row) !== null)
  return { rows: rows.length, known_cost_rows: known.length, unknown_cost_rows: rows.length - known.length,
    cost_usd: rows.length && known.length === rows.length ? sum(known) : null,
    known_cost_usd: known.length ? sum(known) : null,
    provider_usage_cost_usd: measured.length ? sum(measured.map(costOf)) : null,
    reservation_cost_usd: reserved.length ? sum(reserved.map(costOf)) : null,
    unknown_cost_basis_rows: rows.filter(row => !['provider_usage', 'reservation'].includes(row.metadata?.cost_basis)).length }
}

function calendarWindows(rows, { now, coverageSince, cost = costOf, unattributedAttempts = 0 } = {}) {
  const end = time(now ?? new Date())
  if (end === null) throw new TypeError('Invalid metric clock')
  const date = new Date(end)
  const starts = { today_utc: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    month_utc: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) }
  const missingDates = rows.filter(row => time(row.created_at) === null).length
  return Object.fromEntries(Object.entries(starts).map(([label, start]) => {
    const selected = rows.filter(row => { const timestamp = time(row.created_at); return timestamp !== null && timestamp >= start && timestamp <= end })
    const known = selected.map(cost).filter(value => value !== null)
    const coverage = time(coverageSince) !== null && time(coverageSince) <= start && missingDates === 0 && unattributedAttempts === 0
    return [label, { from: new Date(start).toISOString(), through: new Date(end).toISOString(),
      coverage_complete: coverage, observed_attempts: selected.length, unknown_date_attempts: missingDates, unattributed_attempts: unattributedAttempts,
      unknown_cost_attempts: selected.length - known.length, observed_known_cost_usd: sum(known),
      cost_usd: coverage && known.length === selected.length ? sum(known) : null }]
  }))
}

export function summarizeAIMetrics(rows, options = {}) {
  const attempts = rows.filter(row => CHAT.has(row.action_type))
  const groups = new Map()
  attempts.forEach((row, index) => {
    const owner = row.user_id || 'unknown-owner'
    const key = row.metadata?.admission_lease_id ? `${owner}:lease:${row.metadata.admission_lease_id}`
      : row.metadata?.request_id && row.user_id ? `${owner}:request:${row.metadata.request_id}` : `unknown-${index}`
    const group = groups.get(key) || []; group.push({ row, index }); groups.set(key, group)
  })
  const requests = [...groups.values()].map(group => group.sort((a, b) => {
    const ai = indexOfAttempt(a.row), bi = indexOfAttempt(b.row)
    if (ai !== null && bi !== null && ai !== bi) return ai - bi
    const at = time(a.row.created_at), bt = time(b.row.created_at)
    return at !== null && bt !== null && at !== bt ? at - bt : a.index - b.index
  }).map(item => item.row))
  const final = requests.map(group => group.at(-1))
  const initialModels = requests.map(group => model(group[0].metadata?.initial_model ||
    (indexOfAttempt(group[0]) > 0 ? null : group[0].model_used)))
  const finalModels = final.map(row => model(row.model_used))
  const attemptModels = attempts.map(row => model(row.model_used))
  const solRequests = requests.filter(group => group.some(row => model(row.model_used) === MODELS[2])).length
  const solAttempts = attempts.filter(row => model(row.model_used) === MODELS[2])
  const escalations = requests.flatMap(group => group.filter((row, i) => {
    const current = MODELS.indexOf(model(row.model_used)), prior = MODELS.indexOf(model(group[i - 1]?.model_used))
    return row.metadata?.tier === 'premium' || row.metadata?.escalated === true || row.metadata?.is_escalation === true || (i > 0 && prior >= 0 && current > prior)
  }))
  const escalationSet = new Set(escalations)
  const evidence = summarizeCostEvidence(attempts)
  const providerTimes = stats(attempts.map(row => number(row.metadata?.duration_ms)).filter(value => value !== null))
  // request_elapsed_ms is measured BEFORE settlement: never relabel it total latency.
  const requestTimes = stats(final.map(row => number(row.metadata?.request_total_ms)).filter(value => value !== null))
  const elapsedTimes = stats(final.map(row => number(row.metadata?.request_elapsed_ms)).filter(value => value !== null))
  const usage = attempts.filter(measuredUsage)
  const inputs = stats(usage.map(row => number(row.input_tokens)).filter(value => value !== null))
  const outputs = stats(usage.map(row => number(row.output_tokens)).filter(value => value !== null))
  const reasoning = stats(usage.map(row => number(row.metadata?.output_reasoning_tokens ?? row.metadata?.reasoning_tokens)).filter(value => value !== null))
  const reads = usage.map(row => number(row.metadata?.cache_read_tokens)).filter(value => value !== null)
  const writes = usage.map(row => number(row.metadata?.cache_creation_tokens ?? row.metadata?.cache_write_tokens)).filter(value => value !== null)
  const completeCache = usage.filter(row => {
    const input = number(row.input_tokens), read = number(row.metadata?.cache_read_tokens), write = number(row.metadata?.cache_creation_tokens ?? row.metadata?.cache_write_tokens)
    return input !== null && read !== null && write !== null && read + write <= input && MODELS.includes(model(row.model_used))
  })
  const cacheInput = sum(completeCache.map(row => number(row.input_tokens)))
  const cacheRead = sum(completeCache.map(row => number(row.metadata.cache_read_tokens)))
  const savingsRows = usage.filter(row => number(row.metadata?.cache_read_savings_usd) !== null && number(row.metadata?.cache_write_premium_usd) !== null)
  const readSavings = savingsRows.length ? sum(savingsRows.map(row => number(row.metadata.cache_read_savings_usd))) : null
  const writePremium = savingsRows.length ? sum(savingsRows.map(row => number(row.metadata.cache_write_premium_usd))) : null
  return {
    nova_requests: requests.length, nova_provider_attempts: attempts.length,
    nova_success: final.filter(row => row.metadata?.success === true).length,
    nova_failure: final.filter(row => row.metadata?.success === false).length,
    nova_outcome_unknown: final.filter(row => typeof row.metadata?.success !== 'boolean').length,
    nova_retry: attempts.filter(row => indexOfAttempt(row) > 0).length,
    nova_escalation: escalations.length,
    nova_escalated_requests: requests.filter(group => group.some(row => escalationSet.has(row))).length,
    nova_clarification: final.filter(row => row.metadata?.clarification === true).length,
    nova_invalid_schema: attempts.filter(row => ['invalid_json', 'invalid_schema'].includes(row.metadata?.error_type)).length,
    nova_cost_usd: evidence.cost_usd,
    mean_request_cost_usd: requests.length && evidence.cost_usd !== null ? evidence.cost_usd / requests.length : null,
    cost_evidence: evidence,
    usage_measured_attempts: usage.length,
    reserved_cost_attempts: attempts.filter(row => row.metadata?.cost_basis === 'reservation').length,
    mean_input_tokens: inputs.mean, mean_output_tokens: outputs.mean,
    input_measured_attempts: inputs.measured, output_measured_attempts: outputs.measured,
    provider_attempt_p50_ms: providerTimes.p50, provider_attempt_p95_ms: providerTimes.p95,
    provider_latency_measured_attempts: providerTimes.measured,
    request_p50_ms: requestTimes.p50, request_p95_ms: requestTimes.p95,
    request_latency_measured_requests: requestTimes.measured,
    request_partial_elapsed_p50_ms: elapsedTimes.p50, request_partial_elapsed_p95_ms: elapsedTimes.p95,
    request_partial_elapsed_measured_requests: elapsedTimes.measured,
    model_distribution: { initial_request_model: distribution(initialModels), final_observed_request_model: distribution(finalModels),
      provider_attempt_model: distribution(attemptModels),
      denominators: { initial_request_model: requests.length, final_observed_request_model: requests.length, provider_attempt_model: attempts.length },
      final_model_basis: 'Last recorded attempt, ordered by attempt index then timestamp. This is not evidence of durable request completion.' },
    sol_requests: solRequests, sol_request_percent: percent(solRequests, requests.length),
    sol_provider_attempts: solAttempts.length, sol_attempt_percent: percent(solAttempts.length, attempts.length),
    requests_with_unknown_model: requests.filter(group => group.some(row => model(row.model_used) === 'unknown')).length,
    sol_telemetry_calendar_cost: calendarWindows(solAttempts, { ...options, unattributedAttempts: attemptModels.filter(value => value === 'unknown').length }),
    escalation_reasons: countBy(escalations.map(row => row.metadata?.escalation_reason || row.metadata?.routing_reason || 'unknown')),
    routing_reasons: countBy(attempts.map(row => row.metadata?.routing_reason || row.metadata?.escalation_reason || 'unknown')),
    reasoning_effort_attempts: countBy(attempts.map(row => row.metadata?.reasoning_effort || 'unknown')),
    output_reasoning_tokens: reasoning.sum, output_reasoning_measured_attempts: reasoning.measured,
    cache: { measured_usage_attempts: usage.length,
      read_measured_attempts: reads.length, read_hit_attempts: reads.filter(value => value > 0).length,
      read_hit_percent: percent(reads.filter(value => value > 0).length, reads.length),
      write_measured_attempts: writes.length, write_attempts: writes.filter(value => value > 0).length,
      write_percent: percent(writes.filter(value => value > 0).length, writes.length),
      read_tokens: reads.length ? sum(reads) : null, write_tokens: writes.length ? sum(writes) : null,
      openai_complete_breakdown_attempts: completeCache.length,
      openai_cached_read_input_percent: percent(cacheRead, cacheInput),
      savings_measured_attempts: savingsRows.length, read_savings_usd: readSavings, write_premium_usd: writePremium,
      net_savings_usd: readSavings !== null && writePremium !== null ? readSavings - writePremium : null,
      savings_basis: 'Recorded per-attempt price calculation only; missing usage, breakdown or price evidence is unknown. Net savings subtract cache-write premiums.' },
    nova_tool_success: null, nova_tool_failure: null,
    measurement_scope: 'Provider telemetry only; success/failure describe the last observed provider attempt, not durable server completion or client persistence. Missing dimensions are unknown; model shares include unknown/legacy model buckets. No client receipts, rejected admissions or unrecorded paid attempts are inferred. Calendar cost is complete only with supplied coverage from UTC period start. Never add these telemetry costs to the admission ledger.',
  }
}

// Separate budget ledger: do not add this to ai_usage_events or focus_ai_requests.
export function summarizeModelLedger(rows, options = {}) {
  if (!Array.isArray(rows)) return { available: false, reason: 'Model attempt ledger unavailable' }
  const ledgerCost = row => number(row.actual_usd) ?? number(row.reserved_usd)
  const totals = list => ({ attempts: list.length, requests: new Set(list.map(row => row.request_row_id).filter(Boolean)).size,
    unknown_request_id_attempts: list.filter(row => !row.request_row_id).length,
    budget_accounted_usd: list.every(row => ledgerCost(row) !== null) ? sum(list.map(ledgerCost)) : null,
    unresolved_attempts: list.filter(row => row.state !== 'settled').length,
    reservation_fallback_attempts: list.filter(row => number(row.actual_usd) === null).length })
  return { available: true, ...totals(rows), by_model: Object.fromEntries([...new Set([...MODELS, ...rows.map(row => model(row.model))])]
    .map(key => [key, totals(rows.filter(row => model(row.model) === key))])),
    sol_calendar_cost: calendarWindows(rows.filter(row => model(row.model) === MODELS[2]), { ...options, cost: ledgerCost, unattributedAttempts: rows.filter(row => model(row.model) === 'unknown').length }),
    measurement_scope: 'Budget accounting from focus_ai_model_attempts only (actual_usd ?? reserved_usd). A settled amount can still be a conservative reservation when provider usage was unavailable; it is not an invoice. Calendar UTC windows differ from rolling 30-day enforcement.' }
}

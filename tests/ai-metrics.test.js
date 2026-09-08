import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeAIMetrics } from '../scripts/ai-metrics.mjs'
test('logical retries share one request, include both costs and never claim tool execution', () => {
  const row = { user_id:'synthetic', action_type:'nova_message', input_tokens:100, output_tokens:20 }
  const report=summarizeAIMetrics([
    {...row,estimated_cost_usd:.01,metadata:{admission_lease_id:'lease',success:false,error_type:'invalid_json',retry_attempt:0,duration_ms:100,cost_basis:'provider_usage'}},
    {...row,estimated_cost_usd:.03,metadata:{admission_lease_id:'lease',success:true,retry_attempt:1,tier:'premium',duration_ms:300,cost_basis:'provider_usage',clarification:true}},
  ])
  assert.equal(report.nova_requests,1);assert.equal(report.nova_provider_attempts,2)
  assert.equal(report.nova_success,1);assert.equal(report.nova_failure,0)
  assert.equal(report.nova_retry,1);assert.equal(report.nova_escalation,1)
  assert.equal(report.nova_clarification,1);assert.equal(report.nova_invalid_schema,1)
  assert.equal(report.nova_cost_usd,.04);assert.equal(report.mean_request_cost_usd,.04)
  assert.equal(report.provider_attempt_p95_ms,300);assert.equal(report.nova_tool_success,null)
})
test('missing usage or legacy identifiers are unknown and do not merge unrelated requests', () => {
  const report=summarizeAIMetrics([{action_type:'nova_message'}, {action_type:'nova_message'}])
  assert.equal(report.nova_requests,2);assert.equal(report.usage_measured_attempts,0)
  assert.equal(report.nova_success,0);assert.equal(report.provider_attempt_p95_ms,null)
  assert.equal(report.nova_tool_failure,null)
})

const now = '2026-09-08T12:00:00.000Z'
const model = tier => `gpt-5.6-${tier}`
const attempt = (request, tier, index = 0, extra = {}) => ({
  user_id: 'synthetic', action_type: 'nova_message', model_used: model(tier),
  created_at: now, input_tokens: 1000, output_tokens: 200, estimated_cost_usd: .01,
  ...extra, metadata: { admission_lease_id: request, retry_attempt: index, tier,
    success: true, cost_basis: 'provider_usage', ...extra.metadata },
})

test('model shares distinguish first/final/any-Sol requests from attempts and sort retries', () => {
  const report = summarizeAIMetrics([
    attempt('a', 'terra', 1, { metadata: { escalated: true, escalation_reason: 'invalid_schema' } }),
    attempt('b', 'sol'),
    attempt('c', 'sol', 1, { metadata: { escalated: true, escalation_reason: 'low_confidence' } }),
    attempt('a', 'luna', 0, { metadata: { success: false } }),
    attempt('c', 'luna', 0, { metadata: { success: false } }),
  ], { now })
  assert.equal(report.nova_requests, 3)
  assert.equal(report.nova_provider_attempts, 5)
  assert.equal(report.model_distribution.initial_request_model[model('luna')].count, 2)
  assert.equal(report.model_distribution.final_observed_request_model[model('sol')].count, 2)
  assert.equal(report.model_distribution.provider_attempt_model[model('sol')].percent, 40)
  assert.equal(report.sol_requests, 2)
  assert.equal(report.sol_request_percent, 200 / 3)
  assert.equal(report.sol_attempt_percent, 40)
  assert.equal(report.nova_escalation, 2) // Starting directly on Sol is not an escalation.
  assert.equal(report.nova_success, 3)
  assert.deepEqual(report.escalation_reasons, { invalid_schema: 1, low_confidence: 1 })
})

test('cache, reasoning and complete request latency require their own measured evidence', () => {
  const report = summarizeAIMetrics([
    attempt('measured', 'luna', 0, { metadata: { duration_ms: 100, request_total_ms: 600,
      cache_read_tokens: 800, cache_creation_tokens: 100,
      cache_read_savings_usd: .000144, cache_write_premium_usd: .000005,
      output_reasoning_tokens: 40, reasoning_effort: 'low' } }),
    attempt('reserved', 'sol', 0, { input_tokens: 0, output_tokens: 0,
      metadata: { cost_basis: 'reservation', usage_source: 'unavailable', duration_ms: 300, request_elapsed_ms: 400, success: false } }),
  ], { now })
  assert.equal(report.mean_input_tokens, 1000)
  assert.equal(report.mean_output_tokens, 200)
  assert.equal(report.input_measured_attempts, 1)
  assert.equal(report.cache.read_hit_percent, 100) // Denominator is one measured read, not two attempts.
  assert.equal(report.cache.openai_cached_read_input_percent, 80)
  assert.equal(report.cache.savings_measured_attempts, 1)
  assert.ok(Math.abs(report.cache.net_savings_usd - .000139) < 1e-12)
  assert.equal(report.output_reasoning_tokens, 40)
  assert.equal(report.output_reasoning_measured_attempts, 1)
  assert.equal(report.provider_attempt_p95_ms, 300)
  assert.equal(report.request_p95_ms, 600)
  assert.equal(report.request_latency_measured_requests, 1)
  assert.equal(report.request_partial_elapsed_p95_ms, 400)
  assert.equal(summarizeAIMetrics([attempt('partial', 'luna', 0, { metadata: { request_elapsed_ms: 400 } })]).request_p95_ms, null)
})

test('missing costs, unavailable zero usage, missing cache and reasoning remain unknown', () => {
  const report = summarizeAIMetrics([
    attempt('known', 'luna'),
    attempt('unknown', 'sol', 0, { estimated_cost_usd: null, metadata: { cost_basis: 'reservation' } }),
  ])
  assert.equal(report.nova_cost_usd, null)
  assert.equal(report.mean_request_cost_usd, null)
  assert.equal(report.cost_evidence.known_cost_usd, .01)
  assert.equal(report.cost_evidence.unknown_cost_rows, 1)
  assert.equal(report.cache.read_hit_percent, null)
  assert.equal(report.cache.net_savings_usd, null)
  assert.equal(report.output_reasoning_tokens, null)
  const legacy = summarizeAIMetrics([{ action_type: 'nova_message', estimated_cost_usd: 0, input_tokens: 0, output_tokens: 0,
    metadata: { usage_source: 'unavailable' } }])
  assert.equal(legacy.nova_cost_usd, null)
  assert.equal(legacy.mean_input_tokens, null)
  assert.equal(legacy.nova_outcome_unknown, 1)
})

test('calendar UTC boundaries exclude August and future attempts; incomplete coverage is not zero', () => {
  const rows = [
    attempt('aug', 'sol', 0, { created_at: '2026-08-31T23:59:59Z', estimated_cost_usd: .4 }),
    attempt('sep', 'sol', 0, { created_at: '2026-09-01T00:00:00Z', estimated_cost_usd: .1 }),
    attempt('today', 'sol', 0, { created_at: '2026-09-07T23:30:00-04:00', estimated_cost_usd: .2 }),
    attempt('future', 'sol', 0, { created_at: '2026-09-08T13:00:00Z', estimated_cost_usd: .8 }),
  ]
  const report = summarizeAIMetrics(rows, { now, coverageSince: '2026-08-31T00:00:00Z' })
  assert.equal(report.sol_telemetry_calendar_cost.today_utc.cost_usd, .2)
  assert.ok(Math.abs(report.sol_telemetry_calendar_cost.month_utc.cost_usd - .3) < 1e-12)
  assert.equal(summarizeAIMetrics([], { now }).sol_telemetry_calendar_cost.month_utc.cost_usd, null)
  assert.equal(summarizeAIMetrics([], { now, coverageSince: '2026-09-01T00:00:00Z' }).sol_telemetry_calendar_cost.month_utc.cost_usd, 0)
  assert.equal(summarizeAIMetrics([...rows, attempt('no-date', 'sol', 0, { created_at: null })],
    { now, coverageSince: '2026-08-31T00:00:00Z' }).sol_telemetry_calendar_cost.month_utc.cost_usd, null)
})

test('partial retry history cannot invent the initial model or merge owners', () => {
  const rows = [attempt('same-lease', 'sol', 1), attempt('same-lease', 'luna', 0, { user_id: 'another' })]
  const report = summarizeAIMetrics(rows, { now })
  assert.equal(report.nova_requests, 2)
  assert.equal(report.model_distribution.initial_request_model.unknown.count, 1)
  assert.equal(report.model_distribution.initial_request_model[model('luna')].count, 1)
})

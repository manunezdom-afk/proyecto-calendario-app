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

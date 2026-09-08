// Provider attempts and logical requests are distinct; plans are not receipts.
export function summarizeAIMetrics(rows) {
  const attempts = rows.filter(row => row.action_type === 'nova_message' || row.action_type === 'nova_premium_message')
  const groups = new Map()
  attempts.forEach((row, index) => {
    const key = row.metadata?.admission_lease_id || `${row.user_id}:${row.metadata?.request_id || `legacy-${index}`}`
    const group = groups.get(key) || []; group.push(row); groups.set(key, group)
  })
  const requests = [...groups.values()]
  const final = requests.map(group => group[group.length - 1])
  const durations = attempts.map(row => row.metadata?.duration_ms).filter(value => Number.isFinite(value) && value >= 0).sort((a,b) => a-b)
  const percentile = p => durations.length ? durations[Math.max(0, Math.ceil(durations.length * p) - 1)] : null
  const sum = (list, key) => list.reduce((total, row) => total + (Number(row[key]) || 0), 0)
  const cost = sum(attempts, 'estimated_cost_usd')
  return {
    nova_requests: requests.length, nova_provider_attempts: attempts.length,
    nova_success: final.filter(row => row.metadata?.success === true).length,
    nova_failure: final.filter(row => row.metadata?.success === false).length,
    nova_retry: attempts.filter(row => row.metadata?.retry_attempt > 0).length,
    nova_escalation: attempts.filter(row => row.metadata?.tier === 'premium').length,
    nova_escalated_requests: requests.filter(group => group.some(row => row.metadata?.tier === 'premium')).length,
    nova_clarification: final.filter(row => row.metadata?.clarification === true).length,
    nova_invalid_schema: attempts.filter(row => ['invalid_json','invalid_schema'].includes(row.metadata?.error_type)).length,
    nova_cost_usd: cost, mean_request_cost_usd: requests.length ? cost / requests.length : null,
    usage_measured_attempts: attempts.filter(row => row.metadata?.cost_basis === 'provider_usage').length,
    reserved_cost_attempts: attempts.filter(row => row.metadata?.cost_basis === 'reservation').length,
    mean_input_tokens: attempts.length ? sum(attempts, 'input_tokens') / attempts.length : null,
    mean_output_tokens: attempts.length ? sum(attempts, 'output_tokens') / attempts.length : null,
    provider_attempt_p50_ms: percentile(.5), provider_attempt_p95_ms: percentile(.95),
    nova_tool_success: null, nova_tool_failure: null,
    measurement_scope: 'Provider telemetry only. Tool persistence comes from client receipts; absent client receipts are unknown, never zero failures. Historical rows can lack new dimensions. Admission rejections occur before paid attempt telemetry.',
  }
}

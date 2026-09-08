import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAICostReport, reportWindow, readReportRows, main } from '../scripts/ai-cost-report.mjs'
import { summarizeModelLedger } from '../scripts/ai-metrics.mjs'

const now = '2026-09-08T12:00:00.000Z'
const row = (created_at, cost, tier = 'sol') => ({ user_id: 'synthetic-account', action_type: 'nova_message',
  created_at, model_used: `gpt-5.6-${tier}`, estimated_cost_usd: cost,
  metadata: { request_id: created_at, success: true, cost_basis: 'provider_usage' } })

test('report fetch includes the whole UTC calendar month despite a one-day display range', () => {
  const window = reportWindow({ now, days: 1 })
  assert.equal(window.query_since, '2026-09-01T00:00:00.000Z')
  const report = buildAICostReport([row('2026-09-01T10:00:00Z', .01), row(now, .02)],
    { now, days: 1, coverageSince: window.query_since })
  assert.equal(report.total.rows, 1)
  assert.equal(report.total.cost_usd, .02)
  assert.equal(report.metrics.nova_requests, 1)
  assert.equal(report.metrics.sol_telemetry_calendar_cost.month_utc.cost_usd, .03)
  assert.equal(report.model_ledger.available, false)
  assert.equal(report.conversion_clp_per_usd, null)
  assert.throws(() => reportWindow({ days: Infinity }), /days/)
})

test('budget ledger remains separate from telemetry and labels reservation fallback', () => {
  const ledger = [{ request_row_id: 'req1', attempt_index: 0, model: 'gpt-5.6-sol', tier: 'sol',
    reserved_usd: '.05', actual_usd: null, state: 'started', created_at: now },
  { request_row_id: 'req1', attempt_index: 1, model: 'gpt-5.6-terra', tier: 'terra',
    reserved_usd: '.03', actual_usd: '.01', state: 'settled', created_at: now }]
  const report = buildAICostReport([row(now, .02)], { now, days: 7, modelAttempts: ledger, coverageSince: '2026-09-01T00:00:00Z' })
  assert.equal(report.total.cost_usd, .02)
  assert.ok(Math.abs(report.model_ledger.budget_accounted_usd - .06) < 1e-12)
  assert.equal(report.model_ledger.requests, 1)
  assert.equal(report.model_ledger.attempts, 2)
  assert.equal(report.model_ledger.unresolved_attempts, 1)
  assert.equal(report.model_ledger.reservation_fallback_attempts, 1)
  assert.equal(report.model_ledger.sol_calendar_cost.today_utc.cost_usd, .05)
  assert.equal(summarizeModelLedger(null).available, false)
})

test('unknown models and missing dates cannot certify zero Sol calendar cost', () => {
  const report = buildAICostReport([row(now, null, 'luna'), { ...row(now, .01), model_used: null }],
    { now, coverageSince: '2026-09-01T00:00:00Z', modelAttempts: [{ model: null, created_at: now, reserved_usd: .05 }] })
  assert.equal(report.total.cost_usd, null)
  assert.equal(report.total.unknown_cost_rows, 1)
  assert.equal(report.metrics.sol_telemetry_calendar_cost.month_utc.cost_usd, null)
  assert.equal(report.model_ledger.sol_calendar_cost.month_utc.cost_usd, null)
})

test('read pagination uses a fixed time boundary and deterministic tie ordering', async () => {
  const logs = []
  const values = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const admin = { from(table) {
    const query = { select() { return this }, gte(...args) { logs.push(['gte', ...args]); return this },
      lte(...args) { logs.push(['lte', ...args]); return this }, order(...args) { logs.push(['order', ...args]); return this },
      range(from, to) { logs.push(['range', from, to]); return Promise.resolve({ data: values.slice(from, to + 1), error: null }) } }
    logs.push(['from', table]); return query
  } }
  const window = reportWindow({ now })
  const result = await readReportRows(admin, 'ai_usage_events', '*', window, { pageSize: 2 })
  assert.deepEqual(result, values)
  assert.equal(logs.filter(entry => entry[0] === 'order' && entry[1] === 'id').length, 2)
  assert.equal(logs.filter(entry => entry[0] === 'lte' && entry[2] === now).length, 2)
  await assert.rejects(() => readReportRows(admin, 'ai_usage_events', '*', window, { pageSize: 0 }), /page size/)
})

test('offline import and invalid CLI configuration never initialize an authenticated client', async () => {
  let calls = 0
  const errors = []
  const options = { env: {}, output: { error(message) { errors.push(message) } }, makeClient() { calls++; throw new Error('No network permitted') } }
  assert.equal(await main({ ...options, args: [] }), 1)
  assert.equal(await main({ ...options, args: ['Infinity'] }), 1)
  assert.equal(calls, 0)
  assert.equal(errors.length, 2)
})

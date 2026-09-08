import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateBenchmarkOutput, verifyBenchmarkReplay, summarizeBenchmarkCosts, benchmarkSourceHashes } from '../scripts/ai-router-benchmark.mjs'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createGrader } from '../scripts/ai-benchmark-grade.mjs'
import { buildDateContext } from '../api/_lib/dateContext.js'

const { evaluate } = createGrader(buildDateContext(Date.parse('2026-09-08T15:00Z'), 'America/Santiago'))
const conversation = { id: 'F60', input: 'lo veo en la tarde', expect: { kind: 'chat', allowClarify: true } }
const result = () => ({ httpStatus: 200, body: { reply: 'De acuerdo.', actions: [], proposed_actions: [],
  mode: 'chat_only', validation: { ok: true, issues: [] } } })

test('HTTP failures cannot pass a conversational benchmark case', () => {
  for (const httpStatus of [400, 409, 429, 503]) {
    const output = { httpStatus, body: { error: 'assistant_unavailable', actions: [], proposed_actions: [] } }
    // The unchanged interpretation grader has no HTTP knowledge.
    assert.equal(evaluate(conversation, output.body).pass, true)
    assert.deepEqual(evaluateBenchmarkOutput(conversation, output, evaluate), { pass: false, fails: [`runtime_http_${httpStatus}`] })
  }
})

test('the runtime contract must be valid before the interpretation grader runs', () => {
  let graded = 0
  const grader = () => { graded++; return { pass: true, fails: [] } }
  for (const transform of [
    output => { delete output.body.validation },
    output => { output.body.validation.ok = false },
    output => { output.body.actions = {} },
    output => { delete output.body.proposed_actions },
    output => { output.body.reply = null },
    output => { output.body.mode = 'unknown' },
  ]) {
    const output = result(); transform(output)
    assert.equal(evaluateBenchmarkOutput(conversation, output, grader).pass, false)
  }
  assert.equal(graded, 0)
  assert.equal(evaluateBenchmarkOutput(conversation, result(), grader).pass, true)
  assert.equal(graded, 1)
})

test('a valid clarification retains the original grader expectations', () => {
  const output = result()
  Object.assign(output.body, { mode: 'clarification', shouldAskUser: true, reply: '¿A qué hora?' })
  assert.deepEqual(evaluateBenchmarkOutput(conversation, output, evaluate), evaluate(conversation, output.body))
})

test('JSON object key ordering does not invalidate a durable SQL replay', () => {
  const output = result()
  const reordered = { body: { validation: { issues: [], ok: true }, mode: 'chat_only', proposed_actions: [],
    actions: [], reply: 'De acuerdo.' }, httpStatus: 200 }
  assert.notEqual(JSON.stringify(output), JSON.stringify(reordered))
  assert.equal(verifyBenchmarkReplay(output, reordered, 1, 1), true)
  assert.equal(verifyBenchmarkReplay(output, reordered, 1, 2), false)
})

test('replay comparison rejects changed plans, action order and HTTP status', () => {
  const output = result(); output.body.actions = [{ actionId: 'request:0' }, { actionId: 'request:1' }]
  const reorderedActions = structuredClone(output); reorderedActions.body.actions.reverse()
  assert.equal(verifyBenchmarkReplay(output, reorderedActions, 1, 1), false)
  const changedStatus = structuredClone(output); changedStatus.httpStatus = 503
  assert.equal(verifyBenchmarkReplay(output, changedStatus, 1, 1), false)
  const changedReply = structuredClone(output); changedReply.body.reply = 'Algo distinto.'
  assert.equal(verifyBenchmarkReplay(output, changedReply, 1, 1), false)
})

const interaction = count => ({ attempted: true, attempts: Array.from({ length: count }, () => ({})) })
const usageCost = (cost, basis = 'provider_usage') => ({ estimated_cost_usd: cost,
  metadata: { cost_basis: basis, usage_source: basis === 'provider_usage' ? 'openai_usage' : 'unavailable' } })

test('observed interaction cost includes all paid attempts only when every usage is measured', () => {
  const cost = summarizeBenchmarkCosts([interaction(2), interaction(1)], [usageCost(.01), usageCost(.02), usageCost(.03)])
  assert.equal(cost.costObservationSufficient, true); assert.equal(cost.observedCostAttemptCount, 3)
  assert.equal(cost.unobservedCostAttemptCount, 0); assert.equal(cost.totalObservedCostUSD, .06)
  assert.equal(cost.meanInteractionCostUSD, .03); assert.equal(cost.totalTrackedCostUSD, .06)
})

test('reservation accounting is never reported as observed interaction cost', () => {
  const cost = summarizeBenchmarkCosts([interaction(2)], [usageCost(.01), usageCost(.05, 'reservation')])
  assert.equal(cost.costObservationSufficient, false); assert.equal(cost.observedCostAttemptCount, 1)
  assert.equal(cost.unobservedCostAttemptCount, 1)
  assert.ok(Math.abs(cost.totalTrackedCostUSD - .06) < 1e-12)
  assert.equal(cost.totalObservedCostUSD, null); assert.equal(cost.meanInteractionCostUSD, null)
})

test('missing, malformed or duplicated telemetry cannot establish complete observed cost', () => {
  for (const telemetry of [[usageCost(.01)], [usageCost(.01), usageCost(null)], [usageCost(.01), usageCost('')],
    [usageCost(.01), usageCost(-1)], [usageCost(.01), usageCost(.02), usageCost(.03)]]) {
    const cost = summarizeBenchmarkCosts([interaction(2)], telemetry)
    assert.equal(cost.costObservationSufficient, false)
    assert.equal(cost.meanInteractionCostUSD, null); assert.equal(cost.totalObservedCostUSD, null)
  }
})

test('offline inventory and blocked admissions do not invent zero observed cost', () => {
  for (const rows of [[], [{ attempted: false, attempts: [] }], [interaction(0)]]) {
    const cost = summarizeBenchmarkCosts(rows, [])
    assert.equal(cost.costObservationSufficient, false); assert.equal(cost.observedCostAttemptCount, 0)
    assert.equal(cost.totalTrackedCostUSD, null); assert.equal(cost.totalObservedCostUSD, null)
    assert.equal(cost.meanInteractionCostUSD, null)
  }
})

test('source hashes include exact runner, harness and used SQL migration bytes', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const hashes = benchmarkSourceHashes(root, ['021_ai_admission.sql', '022_openai_model_admission.sql'])
  for (const path of ['scripts/ai-router-benchmark.mjs', 'scripts/lib/ephemeral-ai-database.mjs',
    'supabase/migrations/021_ai_admission.sql', 'supabase/migrations/022_openai_model_admission.sql']) {
    assert.equal(hashes[path], createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex'))
  }
  assert.equal(benchmarkSourceHashes(root)['supabase/migrations/022_openai_model_admission.sql'], undefined)
})

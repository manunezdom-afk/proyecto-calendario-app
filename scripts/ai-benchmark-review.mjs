#!/usr/bin/env node
// Human review is deliberately separate from objective/provider measurements.
// --report path --template path creates an unscored form. --reviews path scores it.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const args = process.argv.slice(2)
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null
const reportPath = option('--report')
if (!reportPath) throw new Error('Provide --report benchmark.json')
const report = JSON.parse(readFileSync(resolve(reportPath), 'utf8'))
const criteria = ['understood', 'correctPlan', 'natural', 'concise', 'necessaryClarification']
if (option('--template')) {
  const rows = report.rows.filter(row => row.httpStatus === 200)
  const selected = rows.filter(row => ['conversacion','informal','contexto','complejos'].includes(row.category)).slice(0, 12)
  const form = { reviewer: null, reviewedAt: null, benchmark: reportPath,
    instructions: 'Score each criterion 0–4. Assess the plan and reply, not unverified persistence. necessaryClarification: 4 = asks only when needed; 0 = needless or missing clarification. Actual client execution is tested separately. Preserve null until reviewed.',
    reviews: selected.map(row => ({ id: row.id, input: row.input, reply: row.output?.reply,
      mode: row.output?.mode, actions: [...(row.output?.actions || []), ...(row.output?.proposed_actions || [])],
      ...Object.fromEntries(criteria.map(key => [key, null])), note: '' })) }
  writeFileSync(resolve(option('--template')), JSON.stringify(form, null, 2) + '\n')
  console.log(`Created ${selected.length} unscored review cases.`)
} else {
  const reviewsPath = option('--reviews')
  if (!reviewsPath) throw new Error('Provide --template or --reviews')
  const form = JSON.parse(readFileSync(resolve(reviewsPath), 'utf8'))
  if (!form.reviewer || !form.reviewedAt || !form.reviews?.length) throw new Error('Human review is incomplete')
  const values = form.reviews.flatMap(review => criteria.map(key => review[key]))
  if (values.some(value => !Number.isInteger(value) || value < 0 || value > 4)) throw new Error('Every criterion must be scored 0–4')
  const ids = new Set(report.rows.map(row => row.id))
  if (form.reviews.some(review => !ids.has(review.id)) || new Set(form.reviews.map(review => review.id)).size !== form.reviews.length) throw new Error('Review IDs must uniquely match the benchmark')
  if (![report.summary.objectivePassRate, report.summary.meanCostUSD, report.summary.p95Ms].every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('Benchmark has incomplete measured evidence')
  const reliability = report.summary.objectivePassRate * 100
  // Fixed anchors, not cohort-relative scores: comparable across future runs.
  const cost = Math.max(0, 100 * (1 - report.summary.meanCostUSD / 0.01))
  const latency = Math.max(0, 100 * (1 - report.summary.p95Ms / 10000))
  const conversation = 25 * values.reduce((sum, value) => sum + value, 0) / values.length
  if (![reliability, cost, latency, conversation].every(Number.isFinite) || !report.summary.costMeasuredRequests || !report.summary.p95Ms) throw new Error('Benchmark has incomplete measured evidence')
  console.log(JSON.stringify({ reviewer: form.reviewer, reviewedCases: form.reviews.length,
    score: .5 * reliability + .2 * cost + .15 * latency + .15 * conversation,
    components: { reliability, cost, latency, conversation },
    weights: { reliability: .5, cost: .2, latency: .15, conversation: .15 },
    anchors: { costZeroScoreUSD: .01, latencyZeroScoreP95Ms: 10000 },
    limitation: 'Plan quality benchmark; persistence and device latency require separate client tests.' }, null, 2))
}

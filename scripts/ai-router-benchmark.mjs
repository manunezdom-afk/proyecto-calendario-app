#!/usr/bin/env node
// Production router + actual admission SQL + actual OpenAI Responses adapter.
// Accounts, agenda and conversations are synthetic; nothing is sent to Supabase.
// Default is offline inventory; --live permits bounded metered calls.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { parseEnv, isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import { buildDateContext } from '../api/_lib/dateContext.js'
import { executeNovaRequest, selectNovaRoutes } from '../api/_lib/novaRuntime.js'
import { sanitizeNovaRequest } from '../api/_lib/novaSafety.js'
import { callOpenAINova, extractResponsesText } from '../api/_lib/openaiNova.js'
import { createGrader } from './ai-benchmark-grade.mjs'
import { summarizeAIMetrics } from './ai-metrics.mjs'
import { ephemeralAIDatabase } from './lib/ephemeral-ai-database.mjs'

export function evaluateBenchmarkOutput(c, output, evaluate) {
  if (output?.httpStatus !== 200) return { pass: false, fails: [`runtime_http_${output?.httpStatus ?? 'missing'}`] }
  const plan = output.body
  if (plan?.validation?.ok !== true || !Array.isArray(plan.actions) || !Array.isArray(plan.proposed_actions)
    || typeof plan.reply !== 'string' || !['chat_only','chat_with_action','proposal','clarification'].includes(plan.mode)) {
    return { pass: false, fails: ['invalid_runtime_contract'] }
  }
  return evaluate(c, plan)
}

export function verifyBenchmarkReplay(original, replay, attemptsBefore, attemptsAfter) {
  // PostgreSQL jsonb may reorder object keys; ordering of action arrays still matters.
  return isDeepStrictEqual(original, replay) && attemptsBefore === attemptsAfter
}

export function benchmarkSourceHashes(root, sqlMigrations = []) {
  const paths = ['api/_lib/novaRuntime.js','api/_lib/novaRouter.js','api/_lib/openaiNova.js','api/_lib/novaPrompt.js',
    'api/_lib/novaContract.js','api/_lib/novaAdmission.js','api/_lib/novaSafety.js','api/_lib/aiPricing.js',
    'api/_lib/aiUsageTracking.js','api/_lib/dateContext.js','api/_lib/usageLimits.js','api/_lib/assistantBrand.js',
    'scripts/ai-router-benchmark.mjs','scripts/lib/ephemeral-ai-database.mjs','scripts/ai-benchmark-grade.mjs',
    'scripts/ai-metrics.mjs','tests/nova-battery/cases.json', ...sqlMigrations.map(name => `supabase/migrations/${name}`)]
  return Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')]))
}

export function summarizeBenchmarkCosts(rows, telemetry) {
  const attempted = rows.filter(row => row.attempted)
  const paidCount = attempted.reduce((count, row) => count + (row.attempts?.length || 0), 0)
  const costOf = row => ['number','string'].includes(typeof row.estimated_cost_usd)
    && String(row.estimated_cost_usd).trim() !== '' && Number.isFinite(Number(row.estimated_cost_usd)) && Number(row.estimated_cost_usd) >= 0
    ? Number(row.estimated_cost_usd) : null
  const tracked = telemetry.filter(row => costOf(row) !== null)
  const observed = tracked.filter(row => row.metadata?.cost_basis === 'provider_usage' && row.metadata?.usage_source === 'openai_usage')
  const sufficient = paidCount > 0 && telemetry.length === paidCount && observed.length === paidCount
  const totalObserved = sufficient ? observed.reduce((total, row) => total + costOf(row), 0) : null
  return {
    totalTrackedCostUSD: telemetry.length > 0 && tracked.length === telemetry.length ? tracked.reduce((total, row) => total + costOf(row), 0) : null,
    trackedCostBasis: 'Recorded telemetry accounting, including conservative reservations; not an observed provider bill.',
    costObservationSufficient: sufficient, observedCostAttemptCount: observed.length,
    unobservedCostAttemptCount: Math.max(0, paidCount - observed.length),
    totalObservedCostUSD: totalObserved,
    meanInteractionCostUSD: sufficient && attempted.length ? totalObserved / attempted.length : null,
    meanInteractionCostBasis: 'Provider-reported token usage priced for every paid attempt, divided by attempted interactions; null when any usage or telemetry is missing. Not an invoice.',
  }
}

export async function main(args = process.argv.slice(2)) {
const root = resolve(new URL('../', import.meta.url).pathname)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const live = args.includes('--live')
const budget = Number(option('--budget', '1'))
const limit = Number(option('--limit', '100'))
if (!(budget > 0 && budget <= 2 && Number.isInteger(limit) && limit > 0 && limit <= 211)) throw new Error('Budget must be <= $2; cases 1–211')
const now = option('--now', '2026-09-08T15:00:00.000Z'), timezone = 'America/Santiago'
const dateContext = buildDateContext(Date.parse(now), timezone)
const { evaluate, resolveDateToken } = createGrader(dateContext)
const source = JSON.parse(readFileSync(resolve(root,'tests/nova-battery/cases.json'))).cases
const groups = [...new Set(source.map(c => c.cat))].map(cat => source.filter(c => c.cat === cat))
let selected = []
for (let index = 0; groups.some(group => group[index]); index++) for (const group of groups) if (group[index]) selected.push(group[index])
const only = option('--only','').split(',').filter(Boolean)
if (only.length) selected = selected.filter(c => only.includes(c.id))
selected = selected.slice(0,limit)
const reportPath = resolve(root,option('--report','docs/focus-2/qa/ai-openai-router.json'))
let hashes = benchmarkSourceHashes(root)
// Import ONLY the server key. Never import remote quota, provider or debug overrides.
if (live && !process.env.OPENAI_API_KEY) for (const path of [option('--env-file',''),'.env.local','.env'].filter(Boolean)) {
  if (!existsSync(resolve(root,path))) continue
  const value = parseEnv(readFileSync(resolve(root,path),'utf8')).OPENAI_API_KEY
  if (value) { process.env.OPENAI_API_KEY = value; break }
}
if (!live) process.env.OPENAI_API_KEY ||= 'offline-inventory-no-provider-call'
process.env.AI_PAID_CALLS_ENABLED = 'true'
// Isolated SQL budget applies to the whole run, including unknown billed attempts.
process.env.AI_DAILY_BUDGET_USD = String(budget)
process.env.AI_MONTHLY_BUDGET_USD = String(budget)
const rows = [], telemetry = []
let stopped = null, keyCheck = null, sqlMigrations = []
const percentile = (values,p) => values.length ? [...values].sort((a,b) => a-b)[Math.max(0,Math.ceil(values.length*p)-1)] : null
function save() {
  const attempted = rows.filter(row => row.attempted)
  const successfulHTTP = attempted.filter(row => row.httpStatus === 200)
  const latencies = successfulHTTP.map(row => row.latencyMs)
  const paid = attempted.flatMap(row => row.attempts || [])
  const summary = { selected: selected.length, attempted: attempted.length, providerAttempts: paid.length,
    objectivePass: attempted.filter(row => row.verdict?.pass).length,
    objectivePassRate: attempted.length ? attempted.filter(row => row.verdict?.pass).length / attempted.length : null,
    ...summarizeBenchmarkCosts(rows, telemetry),
    p50Ms: percentile(latencies,.5), p95Ms: percentile(latencies,.95), latencyPopulation: 'successful_http_200',
    replayChecks: attempted.filter(row => row.replayVerified).length,
    humanConversationScore: null, weightedScore: null,
    categories: Object.fromEntries([...new Set(attempted.map(row=>row.category))].map(cat => {
      const subset = attempted.filter(row=>row.category===cat);return [cat,{attempted:subset.length,pass:subset.filter(row=>row.verdict?.pass).length}]
    })), metrics: summarizeAIMetrics(telemetry) }
  mkdirSync(dirname(reportPath),{recursive:true})
  writeFileSync(reportPath,JSON.stringify({version:1,mode:live?'live-production-router-local-sql':'offline-router-inventory',
    runAt:new Date().toISOString(),fixedNow:now,timezone,budgetUSD:budget,sourceHashes:hashes,sqlMigrations,
    measurementScope:live
      ? 'Real production runtime and OpenAI adapter; real PostgreSQL WASM admission, attempt, settlement, tracking and replay. Synthetic accounts; no remote Supabase, Vercel HTTP, native persistence or human quality rating implied.'
      : 'Pure production router inventory only. No provider, runtime execution, SQL, replay, model quality or latency was measured.',
    selectedCases:selected.map(c=>c.id),keyCheck,stopped,summary,rows},null,2)+'\n')
  return summary
}
if (live) {
  if (!process.env.OPENAI_API_KEY) stopped = 'missing_OPENAI_API_KEY'
  else {
    try {
      const response=await fetch('https://api.openai.com/v1/models/gpt-5.6-luna',{headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(10000)})
      const result=await response.json();keyCheck={httpStatus:response.status,model:result.id||null,errorCode:result.error?.code||null}
      if(!response.ok) stopped=`credential_check_http_${response.status}`
    } catch { stopped='credential_check_unavailable' }
  }
}
if (stopped) { console.log(JSON.stringify(save(),null,2)); console.log(`Stopped: ${stopped}. No inference calls made.`) }
else {
  const database=live?await ephemeralAIDatabase():null
  sqlMigrations=database?.migrations||[]
  hashes=benchmarkSourceHashes(root,sqlMigrations)
  try {
    for (const c of selected) {
      const raw = {message:c.input,clientNow:Date.parse(now),clientTimezone:timezone,
        events:(c.events||[]).map(event=>({...event,date:resolveDateToken(event.date)||event.date})),tasks:c.tasks||[],history:c.history||[],
        userMemories:(c.memories||[]).map(memory=>typeof memory==='string'?memory:memory.content||''),discussedEventIds:c.discussed||[]}
      const {body,error}=sanitizeNovaRequest(raw)
      if(error) throw new Error(`Invalid synthetic case: ${c.id}: ${error}`)
      const row={id:c.id,category:c.cat,input:c.input,expect:c.expect,attempted:live,attempts:[],routes:selectNovaRoutes(body)}
      if(!live) { rows.push(row);continue }
      const userId=randomUUID(),requestId=randomUUID()
      await database.db.query('INSERT INTO auth.users(id) VALUES($1)',[userId])
      const started=performance.now(), before=database.events.length
      const callProviders={openai:async options=>{
        const attempt={model:options.model,reasoningEffort:options.reasoningEffort||options.reasoning?.effort||null}
        row.attempts.push(attempt)
        try {
          const response=await callOpenAINova(options);attempt.httpStatus=200;attempt.usage=response.usage||null
          try{attempt.rawParsed=JSON.parse(extractResponsesText(response))}catch{attempt.jsonValid=false}
          return response
        } catch(error){attempt.httpStatus=error.status||null;attempt.errorCode=error.code||'provider_failure';throw error}
      }}
      const output=await executeNovaRequest({admin:database.admin,userId,requestId,body,plan:'free',callProviders})
      row.latencyMs=Math.round(performance.now()-started);row.httpStatus=output.httpStatus;row.output=output.body
      row.verdict=evaluateBenchmarkOutput(c,output,evaluate)
      if(database.events.length>before) database.events.at(-1).metadata.request_total_ms=row.latencyMs
      if(output.httpStatus===200 || output.body.request_completed===true) {
        const paidCount=row.attempts.length
        const replay=await executeNovaRequest({admin:database.admin,userId,requestId,body,plan:'free',callProviders})
        row.replayVerified=verifyBenchmarkReplay(output,replay,paidCount,row.attempts.length)
        if(!row.replayVerified) row.verdict={pass:false,fails:[...(row.verdict.fails||[]),'replay_mismatch']}
      }
      // Include unexpected replay attempts in spending even when replay fails.
      telemetry.push(...database.events.slice(before))
      rows.push(row);save()
      console.log(`${c.id} ${row.verdict.pass?'PASS':'FAIL'} ${row.latencyMs}ms ${row.attempts.map(a=>a.model).join('→')}`)
      if(row.attempts.some(attempt=>[400,401,403,404,429].includes(attempt.httpStatus))){stopped='provider_configuration_or_quota';break}
      if(output.body.error==='ai_budget_reached'){stopped='run_budget_cap';break}
    }
  } finally { await database?.close(); console.log(JSON.stringify(save(),null,2));console.log(`Report: ${reportPath}`) }
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()

#!/usr/bin/env node
// Synthetic, reproducible provider benchmark. No Supabase, account or live agenda.
// node scripts/ai-benchmark.mjs --provider openai --model gpt-5.6-luna --limit 100 --budget 1
// Default is offline inventory. --live explicitly permits metered API calls.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { buildDateContext } from '../api/_lib/dateContext.js'
import { buildOpenAISystemPrompt, NOVA_OPENAI_SCHEMA, convertOpenAIToBackendResponse } from '../api/_lib/openaiNova.js'
import { normalizeDeepSeekPayload, buildDeepSeekJsonAppendix } from '../api/_lib/deepseekNova.js'
import { createGrader } from './ai-benchmark-grade.mjs'
import { calculateAICost, getModelPricing, PRICING_VERIFIED_AT } from '../api/_lib/aiPricing.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceHashes = Object.fromEntries(['api/_lib/novaPrompt.js','api/_lib/novaContract.js','api/_lib/aiPricing.js','tests/nova-battery/cases.json'].map(path=>[path,createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')]))
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const provider = option('--provider', 'openai')
const defaults = { openai: 'gpt-5.6-luna', anthropic: 'claude-haiku-4-5-20251001', deepseek: 'deepseek-v4-flash' }
const model = option('--model', defaults[provider])
const pricing = getModelPricing(model, { conservative: true, requireCurrent: true })
if (!defaults[provider] || !pricing || pricing.provider !== provider) throw new Error('Unsupported provider/model or pricing requires review')
const budget = Number(option('--budget', '1'))
const limit = Number(option('--limit', '100'))
if (!(budget > 0 && budget <= 5 && limit > 0 && limit <= 1000)) throw new Error('Invalid bound: budget <= $5, cases <= 1000')
const now = option('--now', '2026-09-08T15:00:00.000Z')
const tz = option('--timezone', 'America/Santiago')
const dateContext = buildDateContext(Date.parse(now), tz)
const { evaluate, resolveDateToken } = createGrader(dateContext)
const source = JSON.parse(readFileSync(resolve(root, 'tests/nova-battery/cases.json'), 'utf8')).cases
// Round-robin categories: a short run still samples every domain.
const groups = [...new Set(source.map(c => c.cat))].map(cat => source.filter(c => c.cat === cat))
let cases = []
for (let i = 0; groups.some(g => g[i]); i++) for (const g of groups) if (g[i]) cases.push(g[i])
const only = option('--only', '').split(',').filter(Boolean)
if (only.length) cases = cases.filter(c => only.includes(c.id))
const category = option('--cat', '')
if (category) cases = cases.filter(c => c.cat === category)
cases = cases.slice(0, limit)
const live = args.includes('--live')
const reportPath = resolve(root, option('--report', `docs/focus-2/qa/ai-${provider}-${model}.json`))
const keyName = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', deepseek: 'DEEPSEEK_API_KEY' }[provider]
let apiKey = process.env[keyName]
// Read only the exact provider key, never import/export other environment settings.
if (live && !apiKey) for (const name of ['.env.local', '.env']) {
  const path = resolve(root, name)
  if (!existsSync(path)) continue
  const line = readFileSync(path, 'utf8').split('\n').find(l => l.startsWith(`${keyName}=`))
  if (line) { apiKey = line.slice(keyName.length + 1).trim().replace(/^['"]|['"]$/g, ''); break }
}
if (live && !apiKey) throw new Error(`Missing ${keyName}; no calls made`)
const maxOutput = Number(option('--output-tokens', '1024'))
if (!(maxOutput >= 256 && maxOutput <= 2048)) throw new Error('Invalid output token cap')
const rows = []
let charged = 0
let conservativeSpend = 0
let stopped = null
const quantile = (xs, p) => xs.length ? [...xs].sort((a,b) => a-b)[Math.max(0, Math.ceil(xs.length*p)-1)] : null

function save() {
  const attempted = rows.filter(r => r.attempted)
  const measured = attempted.filter(r => r.costUSD != null)
  const latencies = attempted.filter(r => r.httpStatus === 200).map(r => r.latencyMs)
  const pass = attempted.filter(r => r.verdict?.pass).length
  const summary = {
    attempted: attempted.length, objectivePass: pass, objectivePassRate: attempted.length ? pass / attempted.length : null,
    clarifications: attempted.filter(r => r.output?.mode === 'clarification').length,
    permittedClarifications: attempted.filter(r => r.verdict?.note === 'clarify aceptado').length,
    providerErrors: attempted.filter(r => r.errorCode).length,
    modelJsonValid: attempted.filter(r => r.jsonValid).length,
    costMeasuredRequests: measured.length, totalCostUSD: charged, conservativeSpendUSD: conservativeSpend,
    meanCostUSD: measured.length ? charged/measured.length : null,
    p50Ms: quantile(latencies, .5), p95Ms: quantile(latencies, .95), retries: 0,
    // Conversational naturalness requires human review; no fabricated subjective score.
    humanConversationScore: null, weightedScore: null,
    categories: Object.fromEntries([...new Set(attempted.map(r=>r.category))].map(cat=> {
      const subset = attempted.filter(r=>r.category===cat)
      return [cat, { attempted: subset.length, pass: subset.filter(r=>r.verdict?.pass).length }]
    })),
  }
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, JSON.stringify({ version: 1, mode: live ? 'live-provider' : 'offline-inventory', runAt: new Date().toISOString(), fixedNow: now, timezone: tz, provider, model, budgetUSD: budget, maxOutputTokens: maxOutput, pricingDate: PRICING_VERIFIED_AT, pricing, sourceHashes, selectionPolicy: 'category-round-robin', sourceCases: source.length, selectedCases: cases.map(c=>c.id), stopped, summary, rows }, null, 2)+'\n')
  return summary
}

for (const c of cases) {
  const events = (c.events || []).map(e => ({ ...e, date: resolveDateToken(e.date) || e.date }))
  const history = c.history || []
  const memories = (c.memories || []).map(m => typeof m === 'string' ? m : m.content || '')
  const prompt = buildOpenAISystemPrompt({ ...dateContext, memories, events, tasks: c.tasks || [], discussedEventIds: c.discussed || [] })
  const system = provider === 'deepseek' ? prompt + buildDeepSeekJsonAppendix(dateContext.todayISO) : prompt
  const messages = [...history, { role: 'user', content: c.input }]
  // UTF-8 bytes are a conservative token ceiling for these byte-based tokenizers.
  const inputCeiling = Buffer.byteLength(system + JSON.stringify(messages) + JSON.stringify(NOVA_OPENAI_SCHEMA.schema), 'utf8') + 512
  const maxInputRate = Math.max(pricing.input, pricing.cacheWrite || 0, pricing.cacheWrite5m || 0, pricing.cacheWrite1h || 0)
  const reservation = (inputCeiling * maxInputRate + maxOutput * pricing.output) / 1e6
  if (conservativeSpend + reservation > budget) { stopped = 'budget_cap'; break }
  const row = { id: c.id, category: c.cat, input: c.input, expect: c.expect, attempted: live, inputTokenCeiling: inputCeiling, reservedUSD: reservation, memoryCharacters: memories.join('\n').length, promptCharacters: system.length }
  if (!live) { rows.push(row); continue }
  const started = performance.now()
  let raw
  try {
    const schema = NOVA_OPENAI_SCHEMA.schema
    const url = { openai: 'https://api.openai.com/v1/responses', anthropic: 'https://api.anthropic.com/v1/messages', deepseek: 'https://api.deepseek.com/chat/completions' }[provider]
    const body = provider === 'openai' ? {
      model, store: false, max_output_tokens: maxOutput, reasoning: { effort: 'none' },
      input: [{ role: 'system', content: system }, ...messages],
      text: { format: { type: 'json_schema', name: NOVA_OPENAI_SCHEMA.name, strict: true, schema } },
    } : provider === 'anthropic' ? {
      model, max_tokens: maxOutput, system, messages,
      output_config: { format: { type: 'json_schema', schema } },
    } : {
      model, max_tokens: maxOutput, thinking: { type: 'disabled' }, temperature: .2,
      messages: [{ role: 'system', content: system }, ...messages], response_format: { type: 'json_object' },
    }
    const headers = provider === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${apiKey}` }
    const response = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) })
    row.httpStatus = response.status
    raw = await response.json()
    if (!response.ok) {
      row.errorCode = raw.error?.code || raw.error?.type || 'provider_http_error'
      // Synthetic runner only: format rejection helps debug schema compilation.
      // Never retain authentication errors, headers, credentials or provider bodies.
      if (response.status === 400 && typeof raw.error?.message === 'string') {
        row.providerValidationMessage = raw.error.message.replaceAll(apiKey, '[redacted]').replace(/sk-[a-zA-Z0-9_-]+/g,'[redacted]').slice(0,600)
      }
      throw new Error('provider_http_error')
    }
    const text = provider === 'openai' ? (raw.output || []).flatMap(o => o.content || []).filter(t => t.type === 'output_text').map(t => t.text).join('') : provider === 'anthropic' ? (raw.content || []).filter(t => t.type === 'text').map(t => t.text).join('') : raw.choices?.[0]?.message?.content
    row.stopReason = raw.status || raw.stop_reason || raw.choices?.[0]?.finish_reason
    const parsed = JSON.parse(text)
    row.jsonValid = true
    row.rawParsed = parsed
    row.output = convertOpenAIToBackendResponse({ openaiPayload: provider === 'deepseek' ? normalizeDeepSeekPayload(parsed) : parsed, userMessage: c.input, history, events, tasks: c.tasks || [], discussedEventIds: c.discussed || [], memories, dateContext, reqId: randomUUID() })
    row.verdict = evaluate(c, row.output)
  } catch (error) {
    row.errorCode ||= error.name === 'TimeoutError' ? 'timeout' : error instanceof SyntaxError ? 'invalid_json' : 'provider_failure'
    row.verdict = { pass: false, fails: [row.errorCode] }
  } finally {
    row.latencyMs = Math.round(performance.now() - started)
    const u = raw?.usage
    if (u) {
      const input = Number(u.input_tokens ?? u.prompt_tokens ?? 0)
      const output = Number(u.output_tokens ?? u.completion_tokens ?? 0)
      const cached = Number(u.input_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens ?? 0)
      // Anthropic input_tokens excludes cache read; others include cache hits.
      const cacheWrite = Number(u.cache_creation_input_tokens ?? u.input_tokens_details?.cache_write_tokens ?? 0)
      row.tokens = { input, output, cached, cacheWrite }
      row.billing = calculateAICost({ model, input_tokens: input, output_tokens: output, cached_input_tokens: cached,
        cache_creation_input_tokens: cacheWrite,
        cache_creation_5m_input_tokens: u.cache_creation?.ephemeral_5m_input_tokens,
        cache_creation_1h_input_tokens: u.cache_creation?.ephemeral_1h_input_tokens,
        conservative: false })
      row.costUSD = row.billing.cost_usd_unrounded
      charged += row.costUSD
      conservativeSpend += row.costUSD
    } else { row.costUSD = null; row.usageUnknown = true; conservativeSpend += reservation }
    rows.push(row)
    save()
    console.log(`${c.id} ${row.verdict.pass ? 'PASS' : 'FAIL'} ${row.latencyMs}ms cost=${row.costUSD?.toFixed(6) ?? 'unknown'} ${row.errorCode || ''}`)
  }
  // Authentication/model/quota failures stop immediately, never repeated paid probing.
  if ([400,401,403,404,429].includes(row.httpStatus)) { stopped = `provider_http_${row.httpStatus}`; break }
}
console.log(JSON.stringify(save(), null, 2))
console.log(`Report: ${reportPath}`)

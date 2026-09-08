#!/usr/bin/env node
// Read-only report. Importing this module never reads credentials or calls Supabase.
// CLI: node scripts/ai-cost-report.mjs [days=7]
// Server env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; optional CLP_PER_USD.
import { createClient } from '@supabase/supabase-js'
import { pathToFileURL } from 'node:url'
import { summarizeAIMetrics, summarizeCostEvidence, summarizeModelLedger } from './ai-metrics.mjs'
import { ASSISTANT_NAME } from '../api/_lib/assistantBrand.js'

const DAY = 86_400_000
const validDays = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 366 ? Number(value) : null
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
const finiteRate = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null
const usd = value => value === null || value === undefined ? 'desconocido' : `$${value.toFixed(6)}`
const clp = (value, rate) => value !== null && rate ? `${Math.round(value * rate).toLocaleString('es-CL')} CLP` : 'CLP sin evidencia o tipo de cambio configurado'

export function reportWindow({ days = 7, now = new Date() } = {}) {
  if (!validDays(days)) throw new TypeError('days must be an integer from 1 to 366')
  const date = new Date(now)
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid report clock')
  const since = date.getTime() - days * DAY
  const month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  return { since: new Date(since).toISOString(), query_since: new Date(Math.min(since, month)).toISOString(), through: date.toISOString() }
}

function grouped(rows, keyFn) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyFn(row) || 'unknown'
    const group = groups.get(key) || []; group.push(row); groups.set(key, group)
  }
  return [...groups.entries()].map(([key, values]) => ({ key, ...summarizeCostEvidence(values) }))
    .sort((a, b) => (b.known_cost_usd ?? -1) - (a.known_cost_usd ?? -1))
}

export function buildAICostReport(rows, { days = 7, now = new Date(), coverageSince, modelAttempts = null, clpPerUSD = null } = {}) {
  const window = reportWindow({ days, now })
  const within = row => timestamp(row.created_at) !== null && timestamp(row.created_at) >= Date.parse(window.since) && timestamp(row.created_at) <= Date.parse(window.through)
  const selected = rows.filter(within)
  const options = { now: window.through, coverageSince }
  const metrics = summarizeAIMetrics(selected, { ...options, coverageSince: window.since })
  // Full calendar costs use the broader fetch, not only a shorter display window.
  metrics.sol_telemetry_calendar_cost = summarizeAIMetrics(rows, options).sol_telemetry_calendar_cost
  const ledger = summarizeModelLedger(Array.isArray(modelAttempts) ? modelAttempts.filter(within) : null, options)
  if (ledger.available) ledger.sol_calendar_cost = summarizeModelLedger(modelAttempts, options).sol_calendar_cost
  return { window, requested_days: days, conversion_clp_per_usd: finiteRate(clpPerUSD),
    total: summarizeCostEvidence(selected), assistant: ASSISTANT_NAME, metrics, model_ledger: ledger,
    by_day_utc: grouped(selected, row => new Date(row.created_at).toISOString().slice(0, 10)).sort((a, b) => a.key.localeCompare(b.key)),
    by_model: grouped(selected, row => row.model_used),
    by_tier: grouped(selected, row => row.metadata?.tier),
    top_users: grouped(selected, row => row.user_id).slice(0, 10).map(group => ({ ...group, key: group.key === 'unknown' ? 'unknown' : `${group.key.slice(0, 8)}…` })),
    unplaceable_telemetry_rows: rows.filter(row => timestamp(row.created_at) === null).length,
    unplaceable_ledger_rows: Array.isArray(modelAttempts) ? modelAttempts.filter(row => timestamp(row.created_at) === null).length : null,
    scope: 'ai_usage_events describes attempts of all AI features; chat metrics include only nova_message/nova_premium_message. The model ledger is separate budget accounting, never an amount to add to telemetry. UTC calendar month is not rolling 30-day budget enforcement. Missing ledger/usage is unknown, not zero expense.' }
}

export async function readReportRows(admin, table, columns, window, { pageSize = 1000 } = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new TypeError('Invalid page size')
  const rows = []
  for (let offset = 0; ; offset += pageSize) {
    let query = admin.from(table).select(columns).gte('created_at', window.query_since).lte('created_at', window.through)
      .order('created_at', { ascending: true }).order(table === 'focus_ai_model_attempts' ? 'request_row_id' : 'id', { ascending: true })
    if (table === 'focus_ai_model_attempts') query = query.order('attempt_index', { ascending: true })
    if (typeof query.abortSignal === 'function') query = query.abortSignal(AbortSignal.timeout(15000))
    const { data, error } = await query.range(offset, offset + pageSize - 1)
    if (error) throw Object.assign(new Error(`Cannot read ${table}`), { code: error.code || 'query_failed' })
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return rows
  }
}

export async function main({ args = process.argv.slice(2), env = process.env, output = console, makeClient = createClient } = {}) {
  const days = validDays(args[0] ?? 7)
  if (days === null) { output.error('Indica un número de días entre 1 y 366.'); return 1 }
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { output.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor.'); return 1 }
  const window = reportWindow({ days })
  const admin = makeClient(url, key, { auth: { persistSession: false } })
  const [telemetryRead, ledgerRead] = await Promise.allSettled([
    readReportRows(admin, 'ai_usage_events', 'id,user_id,action_type,model_used,input_tokens,output_tokens,estimated_cost_usd,metadata,created_at', window),
    readReportRows(admin, 'focus_ai_model_attempts', 'request_row_id,attempt_index,model,tier,reason,state,reserved_usd,actual_usd,outcome,created_at,settled_at', window),
  ])
  if (telemetryRead.status !== 'fulfilled') { output.error('No se pudo consultar la telemetría. El gasto es desconocido; no se presenta como cero.'); return 1 }
  const rows = telemetryRead.value
  const ledger = ledgerRead.status === 'fulfilled' ? ledgerRead.value : null
  if (ledgerRead.status !== 'fulfilled') output.error('Registro de presupuestos por modelo no disponible. Sus cifras se mostrarán como desconocidas. Verifica la migración 022 y los permisos del servidor.')
  const report = buildAICostReport(rows, { days, now: window.through, coverageSince: window.query_since, modelAttempts: ledger, clpPerUSD: env.CLP_PER_USD })
  output.log(`\nCosto de IA — últimos ${days} días: ${report.total.rows} intentos registrados`)
  output.log(`Costo registrado: ${usd(report.total.cost_usd)} USD; ${clp(report.total.cost_usd, report.conversion_clp_per_usd)}`)
  output.log(`${ASSISTANT_NAME}: ${report.metrics.nova_requests} solicitudes con ${report.metrics.nova_provider_attempts} intentos`)
  output.log(`Solicitudes con Sol: ${report.metrics.sol_requests}/${report.metrics.nova_requests}; intentos Sol: ${report.metrics.sol_provider_attempts}/${report.metrics.nova_provider_attempts}`)
  output.log(JSON.stringify(report, null, 2))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main()
}

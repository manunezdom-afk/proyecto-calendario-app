#!/usr/bin/env node
// Reporte de costos de IA sobre `ai_usage_events` (read-only, no llama a
// ningún LLM). Responde: ¿cuánto se gastó, en qué modelo, por qué tier, y
// cuánto cuesta el mensaje promedio?
//
// Uso:
//   node scripts/ai-cost-report.mjs            → últimos 7 días
//   node scripts/ai-cost-report.mjs 30         → últimos 30 días
//
// Env requeridas (mismas que el backend): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Opcional: CLP_PER_USD (default 940, dólar aproximado 2026-07).

import { createClient } from '@supabase/supabase-js'

const DAYS = Math.max(1, Number(process.argv[2]) || 7)
const CLP_PER_USD = Number(process.env.CLP_PER_USD) || 940

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.')
  console.error('Tip: source las env de Vercel o usa `vercel env pull` primero.')
  process.exit(1)
}

const admin = createClient(url, key, { auth: { persistSession: false } })
const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()

// Paginamos por si hay más de 1000 filas (límite default de PostgREST).
const rows = []
for (let fromIdx = 0; ; fromIdx += 1000) {
  const { data, error } = await admin
    .from('ai_usage_events')
    .select('user_id, action_type, model_used, input_tokens, output_tokens, estimated_cost_usd, metadata, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .range(fromIdx, fromIdx + 999)
  if (error) {
    console.error('Error consultando ai_usage_events:', error.message)
    process.exit(1)
  }
  rows.push(...(data || []))
  if (!data || data.length < 1000) break
}

if (rows.length === 0) {
  console.log(`Sin eventos de IA en los últimos ${DAYS} días.`)
  process.exit(0)
}

const usd = n => `$${n.toFixed(4)}`
const clp = n => `${Math.round(n * CLP_PER_USD).toLocaleString('es-CL')} CLP`
const pct = (a, b) => b ? `${((100 * a) / b).toFixed(1)}%` : '0%'

const groupSum = (keyFn) => {
  const out = new Map()
  for (const r of rows) {
    const k = keyFn(r) || '(desconocido)'
    const g = out.get(k) || { count: 0, cost: 0, input: 0, output: 0 }
    g.count += 1
    g.cost += Number(r.estimated_cost_usd || 0)
    g.input += Number(r.input_tokens || 0)
    g.output += Number(r.output_tokens || 0)
    out.set(k, g)
  }
  return [...out.entries()].sort((a, b) => b[1].cost - a[1].cost)
}

const total = rows.reduce((s, r) => s + Number(r.estimated_cost_usd || 0), 0)
const chatRows = rows.filter(r => r.action_type === 'nova_message' || r.action_type === 'nova_premium_message')
const premiumRows = rows.filter(r =>
  r.action_type === 'nova_premium_message' || r.metadata?.tier === 'hard')

console.log(`\n══ Costo de IA — últimos ${DAYS} días (${rows.length} llamadas) ══`)
console.log(`Total: ${usd(total)} USD ≈ ${clp(total)}  (dólar ${CLP_PER_USD} CLP)`)
console.log(`Promedio por llamada: ${usd(total / rows.length)}`)
if (chatRows.length) {
  const chatCost = chatRows.reduce((s, r) => s + Number(r.estimated_cost_usd || 0), 0)
  console.log(`Mensajes Nova: ${chatRows.length} — costo promedio por mensaje: ${usd(chatCost / chatRows.length)} ≈ ${clp(chatCost / chatRows.length)}`)
}
console.log(`Fallback premium (gpt-5.5 / Sonnet): ${premiumRows.length} llamadas = ${pct(premiumRows.length, rows.length)} del total`)

console.log('\n── Por día ──')
for (const [day, g] of groupSum(r => String(r.created_at).slice(0, 10)).sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`${day}  ${String(g.count).padStart(5)} llamadas  ${usd(g.cost).padStart(10)}  ≈ ${clp(g.cost)}`)
}

console.log('\n── Por modelo ──')
for (const [model, g] of groupSum(r => r.model_used)) {
  console.log(`${model.padEnd(28)} ${String(g.count).padStart(5)} llamadas  ${usd(g.cost).padStart(10)}  in ${g.input.toLocaleString()} tok / out ${g.output.toLocaleString()} tok`)
}

console.log('\n── Por tier (router) ──')
for (const [tier, g] of groupSum(r => r.metadata?.tier || r.metadata?.provider || r.action_type)) {
  console.log(`${tier.padEnd(28)} ${String(g.count).padStart(5)} llamadas  ${usd(g.cost).padStart(10)}`)
}

console.log('\n── Top 10 usuarios por costo ──')
for (const [user, g] of groupSum(r => r.user_id).slice(0, 10)) {
  console.log(`${String(user).slice(0, 8)}…  ${String(g.count).padStart(5)} llamadas  ${usd(g.cost).padStart(10)}  ≈ ${clp(g.cost)}`)
}
console.log('')

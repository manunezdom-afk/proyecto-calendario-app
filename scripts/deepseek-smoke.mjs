#!/usr/bin/env node
// Batería PEQUEÑA de humo contra DeepSeek real — máx 12 requests, ~$0.01-0.02
// USD en total. Mide por caso: JSON válido, acciones correctas (aserción
// suave), costo real cache-aware, latencia y modelo. NO corre sin
// DEEPSEEK_API_KEY. Pensada para ejecutarse UNA vez tras cargar saldo.
//
// Uso:
//   DEEPSEEK_API_KEY=sk-... node scripts/deepseek-smoke.mjs
//   node scripts/deepseek-smoke.mjs --dry   (lista los casos, no llama a nada)
//
// NO añadir casos masivos acá: para baterías grandes usar mocks
// (tests/deepseek-router.test.js) o pedir autorización explícita del dueño.

import {
  buildDeepSeekJsonAppendix,
  callDeepSeekNova,
  extractDeepSeekText,
  normalizeDeepSeekPayload,
  estimateDeepSeekCostUSD,
} from '../api/_lib/deepseekNova.js'
import { buildOpenAISystemPrompt } from '../api/_lib/openaiNova.js'

const CLP_PER_USD = Number(process.env.CLP_PER_USD) || 940
const DRY = process.argv.includes('--dry')

// Contexto fijo: Santiago de Chile, "hoy" real del reloj local.
const now = new Date()
const iso = (d) => d.toISOString().slice(0, 10)
const todayISO = iso(now)
const tomorrow = iso(new Date(now.getTime() + 86_400_000))
const dayAfter = iso(new Date(now.getTime() + 2 * 86_400_000))
const weekDates = {}
const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
for (let i = 0; i < 7; i++) {
  const d = new Date(now.getTime() + i * 86_400_000)
  weekDates[dayNames[d.getDay()]] = iso(d)
}
const currentTime24 = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

// Los 10 casos que Martin definió como "no se puede romper" + 2 extra.
// expect: chequeos suaves sobre las actions (tipo/hora/subtítulo).
const CASES = [
  { msg: 'mañana a las 8 reunión con Juan Pablo por asistencia y certificado médico',
    expect: a => a.some(x => x.type === 'create_event' && x.time === '08:00' && x.dateISO === tomorrow && x.subtitle) },
  { msg: 'hoy tipo 7 jugar counter con los cabros, tengo que cargar el mouse antes',
    expect: a => a.some(x => (x.type === 'create_event' || x.type === 'create_reminder') && x.time === '19:00') },
  { msg: 'fútbol a las 5 acordarme de llevar la pelota',
    expect: a => a.some(x => x.time === '17:00' && (x.dateISO === todayISO || x.dateText?.toLowerCase().includes('hoy'))) },
  { msg: 'acuérdame en 35 minutos revisar si Claude terminó lo de los subtítulos',
    expect: a => a.some(x => x.type === 'create_reminder') },
  { msg: 'mañana temprano tengo que mandar el certificado a la U',
    expect: a => a.some(x => (x.type === 'create_reminder' || x.type === 'create_task') && x.durationMinutes === 0) },
  { msg: 'el viernes a las 5 estudiar comunicación, teoría crítica y estudios culturales',
    expect: a => a.some(x => x.time === '17:00' && x.subtitle) },
  { msg: 'mañana a las 5 me junto con Agus para conversar de cómo estuvo su día',
    expect: a => a.some(x => x.type === 'create_event' && x.time === '17:00' && x.dateISO === tomorrow) },
  { msg: 'tengo que llamar al médico',
    expect: a => a.some(x => x.type === 'create_task' && !x.time) },
  { msg: 'la agustina es mi polola',
    expect: a => a.some(x => x.type === 'save_memory') },
  { msg: 'qué tengo hoy?',
    expect: a => a.every(x => x.type === 'chat_only' || x.type === 'clarify') },
  { msg: 'gym a las 7 con recordatorio media hora antes',
    expect: a => a.some(x => x.type === 'create_event' && x.reminderOffsetMinutes != null) },
  { msg: 'estoy colapsado con la semana, ayúdame a ordenarme',
    expect: a => true }, // conversacional — solo importa que el JSON salga válido
]

if (CASES.length > 12) {
  console.error('Máximo 12 casos en el smoke — para más, pedir autorización.')
  process.exit(1)
}

if (DRY) {
  CASES.forEach((c, i) => console.log(`${i + 1}. ${c.msg}`))
  process.exit(0)
}

const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
if (!apiKey) {
  console.error('Falta DEEPSEEK_API_KEY en el entorno. No se gastó nada.')
  console.error('Cuando la key esté en Vercel/local: DEEPSEEK_API_KEY=... node scripts/deepseek-smoke.mjs')
  process.exit(1)
}

const basePrompt = buildOpenAISystemPrompt({
  tz: 'America/Santiago', todayISO, tomorrow, dayAfter, currentTime24, weekDates,
  memories: ['agus es Agustina, la polola del usuario'],
  events: [], tasks: [], discussedEventIds: [],
})
const systemPrompt = basePrompt + buildDeepSeekJsonAppendix(todayISO)

let totalCost = 0
let passed = 0
let jsonValid = 0

console.log(`\n══ Smoke DeepSeek — ${CASES.length} casos (deepseek-v4-flash) ══\n`)
for (const [i, c] of CASES.entries()) {
  const start = Date.now()
  let status = 'FAIL'
  let detail = ''
  try {
    const data = await callDeepSeekNova({
      message: c.msg, systemPrompt, model: 'deepseek-v4-flash', apiKey,
      reqId: `smoke-${i + 1}`, history: [], maxOutputTokens: 900,
    })
    const latency = Date.now() - start
    const cost = estimateDeepSeekCostUSD(data?.model || 'deepseek-v4-flash', data?.usage) || 0
    totalCost += cost
    let payload
    try {
      payload = normalizeDeepSeekPayload(JSON.parse(extractDeepSeekText(data)))
      jsonValid++
    } catch (e) {
      detail = `JSON inválido: ${e.message.slice(0, 80)}`
      console.log(`${String(i + 1).padStart(2)}. ✗ ${c.msg.slice(0, 55)}… — ${detail} (${latency}ms, $${cost.toFixed(5)})`)
      continue
    }
    const ok = c.expect(payload.actions)
    if (ok) { status = 'OK'; passed++ } else {
      detail = `actions: ${payload.actions.map(a => `${a.type}@${a.time || 's/h'}`).join(', ') || '(ninguna)'}`
    }
    const hit = data?.usage?.prompt_cache_hit_tokens ?? 0
    console.log(`${String(i + 1).padStart(2)}. ${status === 'OK' ? '✓' : '✗'} ${c.msg.slice(0, 55)}… — ${latency}ms, $${cost.toFixed(5)} (${Math.round(cost * CLP_PER_USD * 100) / 100} CLP), cache-hit ${hit} tok${detail ? ` — ${detail}` : ''}`)
  } catch (e) {
    console.log(`${String(i + 1).padStart(2)}. ✗ ${c.msg.slice(0, 55)}… — ERROR ${e.status || ''}: ${e.message.slice(0, 100)}`)
  }
}

console.log(`\nResultado: ${passed}/${CASES.length} aserciones OK · JSON válido ${jsonValid}/${CASES.length}`)
console.log(`Costo total del smoke: $${totalCost.toFixed(5)} USD ≈ ${(totalCost * CLP_PER_USD).toFixed(1)} CLP\n`)

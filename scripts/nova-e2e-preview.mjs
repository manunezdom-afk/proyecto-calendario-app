#!/usr/bin/env node
// E2E de Nova contra un deployment de Vercel (preview) — máx 12 requests.
// Valida el flujo COMPLETO: auth Supabase → cuotas → presupuesto → router
// DeepSeek → JSON → acciones → logging en ai_usage_events.
//
// Crea un usuario de prueba desechable (email @e2e.usefocus.me), obtiene su
// access token, dispara los casos y BORRA el usuario al final. No imprime
// ningún secreto ni token.
//
// Uso:
//   node --env-file=.env scripts/nova-e2e-preview.mjs https://<preview-url>
//
// Env necesarias (ya están en .env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// VITE_SUPABASE_ANON_KEY. Opcional: CLP_PER_USD (default 940).

import { createClient } from '@supabase/supabase-js'

const BASE_URL = (process.argv[2] || '').replace(/\/$/, '')
if (!/^https:\/\//.test(BASE_URL)) {
  console.error('Uso: node --env-file=.env scripts/nova-e2e-preview.mjs https://<deployment-url>')
  process.exit(1)
}
const CLP_PER_USD = Number(process.env.CLP_PER_USD) || 940
const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
if (!supaUrl || !serviceKey || !anonKey) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY (corre con --env-file=.env).')
  process.exit(1)
}

// Los 10 casos críticos de Martin + 2 extra. Aserciones suaves sobre el shape
// que recibe iOS (add_event/add_task/save_memory + time 12h "H:MM AM/PM").
const CASES = [
  { msg: 'mañana a las 8 reunión con Juan Pablo por asistencia y certificado médico',
    check: r => r.actions.some(a => a.type === 'add_event' && /8:00\s*AM/i.test(a.time || '') && (a.subtitle || a.description)) },
  { msg: 'hoy tipo 7 jugar counter con los cabros, tengo que cargar el mouse antes',
    check: r => r.actions.some(a => a.type === 'add_event' && /7:00\s*PM/i.test(a.time || '')) },
  { msg: 'fútbol a las 5 acordarme de llevar la pelota',
    check: r => r.actions.some(a => a.type === 'add_event' && /5:00\s*PM/i.test(a.time || '')) },
  { msg: 'acuérdame en 35 minutos revisar si Claude terminó lo de los subtítulos',
    check: r => r.actions.some(a => a.type === 'add_event' && a.icon === 'alarm') },
  { msg: 'mañana temprano tengo que mandar el certificado a la U',
    check: r => r.actions.some(a => (a.type === 'add_event' && a.icon === 'alarm') || a.type === 'add_task') },
  { msg: 'el viernes a las 5 estudiar comunicación, teoría crítica y estudios culturales',
    check: r => r.actions.some(a => a.type === 'add_event' && /5:00\s*PM/i.test(a.time || '')) },
  { msg: 'mañana a las 5 me junto con Agus para conversar de cómo estuvo su día',
    check: r => r.actions.some(a => a.type === 'add_event' && /5:00\s*PM/i.test(a.time || '')) },
  { msg: 'tengo que llamar al médico',
    check: r => r.actions.some(a => a.type === 'add_task') },
  { msg: 'la agustina es mi polola',
    check: r => r.actions.some(a => a.type === 'save_memory') },
  { msg: 'qué tengo hoy?',
    check: r => typeof r.reply === 'string' && r.reply.length > 0 && r.actions.every(a => !String(a.type).startsWith('add_')) },
  { msg: 'gym a las 7 con recordatorio media hora antes',
    check: r => r.actions.some(a => a.type === 'add_event') },
  { msg: 'estoy colapsado con la semana, ayúdame a ordenarme',
    check: r => typeof r.reply === 'string' && r.reply.length > 0 },
]
if (CASES.length > 12) { console.error('Máx 12 casos.'); process.exit(1) }

const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } })
const anon = createClient(supaUrl, anonKey, { auth: { persistSession: false } })

// Usuario desechable — password aleatoria fuerte, jamás impresa.
const stamp = Date.now()
const email = `e2e-${stamp}@e2e.usefocus.me`
const password = crypto.randomUUID() + crypto.randomUUID()

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
})
if (createErr) { console.error('No pude crear usuario de prueba:', createErr.message); process.exit(1) }
const testUserId = created.user.id
console.log(`Usuario de prueba creado (${email}).`)

let token = null
try {
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password })
  if (signErr) throw new Error(`signIn: ${signErr.message}`)
  token = session.session.access_token

  const tz = 'America/Santiago'
  const clientNow = new Date().toISOString()
  let ok = 0, jsonOk = 0, totalLatency = 0
  const history = []

  console.log(`\n══ E2E Nova vía ${BASE_URL} — ${CASES.length} casos ══\n`)
  for (const [i, c] of CASES.entries()) {
    const start = Date.now()
    let line = `${String(i + 1).padStart(2)}. `
    try {
      const res = await fetch(`${BASE_URL}/api/focus-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: c.msg, events: [], tasks: [], history: [],
          clientNow, clientTimezone: tz,
          userMemories: ['agus es Agustina, la polola del usuario'],
        }),
      })
      const latency = Date.now() - start
      totalLatency += latency
      const bodyText = await res.text()
      let body
      try { body = JSON.parse(bodyText); jsonOk++ } catch {
        console.log(line + `✗ HTTP ${res.status} — respuesta no-JSON: ${bodyText.slice(0, 80)}`)
        continue
      }
      if (!res.ok) {
        console.log(line + `✗ HTTP ${res.status} ${body.error || ''} — ${String(body.message || body.reply || '').slice(0, 70)} (${latency}ms)`)
        continue
      }
      const passed = c.check(body)
      if (passed) ok++
      const acts = body.actions?.map(a => `${a.type}${a.time ? '@' + a.time : ''}`).join(',') || 'sin acciones'
      console.log(line + `${passed ? '✓' : '✗'} "${c.msg.slice(0, 48)}…" → ${acts} (${latency}ms)${passed ? '' : ` | reply: ${String(body.reply || '').slice(0, 60)}`}`)
    } catch (e) {
      console.log(line + `✗ ERROR red: ${e.message.slice(0, 90)}`)
    }
  }

  console.log(`\nResultado: ${ok}/${CASES.length} casos OK · respuestas JSON ${jsonOk}/${CASES.length} · latencia media ${Math.round(totalLatency / CASES.length)}ms`)
  console.log('Costo real: revisar con `npm run ai:cost-report 1` (queda logueado en ai_usage_events).')
} finally {
  // Limpieza: borrar el usuario de prueba y sus eventos de uso quedan como
  // registro de costo (user_id huérfano, sin PII).
  const { error: delErr } = await admin.auth.admin.deleteUser(testUserId)
  console.log(delErr ? `⚠ No pude borrar el usuario de prueba: ${delErr.message}` : 'Usuario de prueba borrado.')
}

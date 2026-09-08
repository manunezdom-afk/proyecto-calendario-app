// Executes the actual migration on ephemeral PostgreSQL WASM (PGlite).
// npm install --prefix /tmp/focus-ai-sql-validation @electric-sql/pglite
// FOCUS_PGLITE_MODULE=/tmp/focus-ai-sql-validation/node_modules/@electric-sql/pglite/dist/index.js node scripts/ai-admission-sql-test.mjs
// This validates SQL execution and sequential invariants. PGlite has one
// connection; multi-process lock contention needs a staging PostgreSQL run.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const modulePath = process.env.FOCUS_PGLITE_MODULE
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : '@electric-sql/pglite')
const db = new PGlite()
const root = fileURLToPath(new URL('../', import.meta.url))
const checks = []
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`)
for (const name of ['010_ai_usage.sql','013_ai_usage_events.sql','020_atomic_ai_usage.sql','021_ai_admission.sql']) {
  await db.exec(readFileSync(resolve(root,'supabase/migrations',name),'utf8'))
}
await db.exec(readFileSync(resolve(root,'supabase/migrations/021_ai_admission.sql'),'utf8'))
checks.push('migration applies and reapplies in PostgreSQL')
const user = '00000000-0000-4000-8000-000000000001'
const second = '00000000-0000-4000-8000-000000000002'
await db.query('INSERT INTO auth.users(id) VALUES ($1),($2)',[user,second])
const policy = { requests_per_minute: 30,max_concurrent: 2,daily_budget_usd: 5,monthly_budget_usd:50,user_daily_budget_usd:1,user_monthly_budget_usd:5,lease_seconds:55 }
const limits = { daily: 20 }
const fingerprint = 'a'.repeat(64)
async function admit(id, options={}) {
  const { rows } = await db.query('SELECT public.focus_ai_admit($1,$2,$3,$4,$5,$6,$7) AS result',
    [options.user || user,id,options.fingerprint || fingerprint,'nova_message',JSON.stringify(options.limits || limits),options.reserve ?? .03,JSON.stringify({...policy,...options.policy})])
  return rows[0].result
}
async function finish(id, lease, cost=.01, response={reply:'Synthetic replay',actions:[]}) {
  return (await db.query('SELECT public.focus_ai_finish($1,$2,$3,$4,$5,$6) AS result',
    [user,id,lease,JSON.stringify(response),cost,'success'])).rows[0].result
}
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`) }
let first
await check('first request reserves and consumes one message', async()=> {
  first = await admit('first'); assert.equal(first.status,'admitted')
  assert.equal((await db.query('SELECT count FROM public.ai_usage WHERE user_id=$1',[user])).rows[0].count,1)
})
await check('same pending ID does not admit or consume twice', async()=> {
  assert.equal((await admit('first')).status,'in_progress')
  assert.equal((await db.query('SELECT count FROM public.ai_usage WHERE user_id=$1',[user])).rows[0].count,1)
})
await check('same ID with changed content conflicts', async()=>assert.equal((await admit('first',{fingerprint:'b'.repeat(64)})).status,'conflict'))
let other
await check('two leases allowed and third rejected',async()=> {
  other=await admit('second'); assert.equal(other.status,'admitted')
  assert.equal((await admit('third')).status,'concurrency')
})
await check('forged lease cannot settle or clear reservation',async()=> {
  assert.equal((await finish('first','00000000-0000-4000-8000-000000000099',0)).status,'unavailable')
  assert.equal((await admit('third')).status,'concurrency')
})
await check('replay survives completion and repeated finish cannot lower recorded cost',async()=> {
  assert.equal((await finish('first',first.lease_id,.02)).status,'completed')
  await finish('first',first.lease_id,0)
  const replay=await admit('first'); assert.equal(replay.status,'replay'); assert.equal(replay.response.reply,'Synthetic replay')
  assert.equal(Number((await db.query("SELECT actual_usd FROM public.focus_ai_requests WHERE request_id='first'")).rows[0].actual_usd),.02)
})
await check('premium quota consumption is idempotent per request',async()=> {
  const consume=async()=> (await db.query('SELECT public.focus_ai_consume($1,$2,$3,$4,$5) AS result',[user,'second',other.lease_id,'nova_premium_message','{"daily":1}'])).rows[0].result
  assert.equal((await consume()).status,'ok'); assert.equal((await consume()).status,'ok')
  assert.equal((await db.query("SELECT count FROM public.ai_usage WHERE endpoint='nova_premium_message'")).rows[0].count,1)
})
await check('unknown billing settles at full reservation',async()=> {
  await finish('second',other.lease_id,null)
  assert.equal(Number((await db.query("SELECT actual_usd FROM public.focus_ai_requests WHERE request_id='second'")).rows[0].actual_usd),.03)
})
await check('quota includes admitted requests atomically',async()=>assert.equal((await admit('quota',{limits:{daily:2}})).status,'quota'))
await check('per-user rate is durable across requests',async()=>assert.equal((await admit('rate',{policy:{requests_per_minute:2}})).status,'rate'))
await check('global budget includes reservations and cannot overshoot',async()=>assert.equal((await admit('budget',{user:second,reserve:.03,policy:{daily_budget_usd:.07}})).status,'budget'))
await check('75 percent enters alert and 90 percent enters economy',async()=> {
  const alert=await admit('alert',{reserve:.03,policy:{daily_budget_usd:.1}}); assert.equal(alert.budget_level,'alert')
  const economy=await admit('economy',{reserve:.015,policy:{daily_budget_usd:.1}}); assert.equal(economy.budget_level,'economy')
  await finish('alert',alert.lease_id,.03); await finish('economy',economy.lease_id,.015)
})
await check('usage telemetry for same request does not double-charge budget',async()=> {
  await db.query("INSERT INTO public.ai_usage_events(user_id,action_type,model_used,estimated_cost_usd,metadata) VALUES($1,'focus-assistant','synthetic',.02,$2)",[user,JSON.stringify({request_id:'first',admission_lease_id:first.lease_id})])
  const accepted=await admit('not-double',{user:second,reserve:.004,policy:{daily_budget_usd:.1}})
  assert.equal(accepted.status,'admitted')
})
await check('expired lease counts as money spent and never reruns same ID',async()=> {
  await db.exec("UPDATE public.focus_ai_requests SET lease_until=now()-interval '1 minute' WHERE request_id='not-double'")
  assert.equal((await admit('not-double',{user:second})).status,'conflict')
  assert.equal((await admit('expired-cost',{reserve:.002,policy:{daily_budget_usd:.1}})).status,'budget')
})
await check('expired replay is scrubbed and remains a no-recharge tombstone',async()=> {
  await db.exec("UPDATE public.focus_ai_requests SET response_expires_at=now()-interval '1 minute' WHERE request_id='first'")
  assert.equal((await admit('first')).status,'conflict')
  assert.equal((await db.query("SELECT response FROM public.focus_ai_requests WHERE request_id='first'")).rows[0].response,null)
})
await check('service purge removes expired content and preserves active replay and cost',async()=> {
  await db.exec("UPDATE public.focus_ai_requests SET response_expires_at=now()-interval '1 minute' WHERE request_id='second'")
  const result = await db.query('SELECT public.focus_ai_purge_replays() AS purged')
  assert.equal(Number(result.rows[0].purged),1)
  const expired=(await db.query("SELECT response,actual_usd FROM public.focus_ai_requests WHERE request_id='second'")).rows[0]
  assert.equal(expired.response,null); assert.equal(Number(expired.actual_usd),.03)
  assert.ok((await db.query("SELECT response FROM public.focus_ai_requests WHERE request_id='alert'")).rows[0].response)
})
await check('a colliding client ID cannot conceal a legacy provider charge',async()=> {
  await db.query("INSERT INTO public.ai_usage_events(user_id,action_type,model_used,estimated_cost_usd,metadata) VALUES($1,'focus-assistant','legacy',.5,'{\"request_id\":\"first\"}')",[user])
  assert.equal((await admit('legacy-collision',{user:second,reserve:.002,policy:{daily_budget_usd:.5}})).status,'budget')
})
await check('anonymous clients cannot invoke service RPC or read cache',async()=> {
  await db.exec('SET ROLE anon')
  await assert.rejects(()=>db.query('SELECT * FROM public.focus_ai_requests'),/permission denied/)
  await assert.rejects(()=>admit('unauthorized'),/permission denied/)
  await assert.rejects(()=>db.query('SELECT public.focus_ai_purge_replays()'),/permission denied/)
  await db.exec('RESET ROLE')
})
await check('deleting an account scrubs replay while retaining anonymous cost',async()=> {
  await db.query('DELETE FROM auth.users WHERE id=$1',[user])
  const rows=(await db.query("SELECT id,request_id,user_id,response,fingerprint,actual_usd FROM public.focus_ai_requests WHERE lease_id=$1",[other.lease_id])).rows
  assert.equal(rows.length,1);assert.equal(rows[0].user_id,null);assert.equal(rows[0].response,null);assert.equal(rows[0].fingerprint,'');assert.equal(Number(rows[0].actual_usd),.03);assert.equal(rows[0].request_id,rows[0].id)
})
await check('missing policy and unknown limits fail closed',async()=> {
  assert.equal((await admit('invalid',{user:second,limits:{unknown:50}})).status,'unavailable')
  assert.equal((await admit('invalid2',{user:second,policy:{daily_budget_usd:null}})).status,'unavailable')
})
await db.close()
const report={engine:'PGlite / PostgreSQL WASM',runAt:new Date().toISOString(),passed:checks.length,checks,
  limitation:'Single database connection: execution, privileges and sequential invariants verified; multi-process advisory lock contention requires staging PostgreSQL.'}
writeFileSync(resolve(root,'docs/focus-2/qa/ai-admission-sql.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))

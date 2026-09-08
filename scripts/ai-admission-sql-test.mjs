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
for (const name of ['010_ai_usage.sql','013_ai_usage_events.sql','020_atomic_ai_usage.sql','021_ai_admission.sql','022_openai_model_admission.sql']) {
  await db.exec(readFileSync(resolve(root,'supabase/migrations',name),'utf8'))
}
await db.exec(readFileSync(resolve(root,'supabase/migrations/022_openai_model_admission.sql'),'utf8'))
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
// 022: exercise the exact model-attempt RPCs on fresh synthetic owners.
const modelUser = '00000000-0000-4000-8000-000000000003'
const modelOther = '00000000-0000-4000-8000-000000000004'
await db.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [modelUser,modelOther])
const modelPolicy = { ...policy, daily_budget_usd:100,monthly_budget_usd:1000,user_daily_budget_usd:100,user_monthly_budget_usd:1000,
  request_budget_usd:.5,model_attempts_required:true,sol_enabled:true,sol_daily_budget_usd:.5,sol_monthly_budget_usd:3,
  sol_user_daily_requests:2,sol_user_monthly_requests:10,alert_percentages:[50,75,90],economy_percent:90,
  sol_share_alert_percent:5,sol_share_min_requests:20 }
const leases = new Map()
async function modelAdmit(id, extra={}) {
  const pol={...modelPolicy,...extra.policy}; const owner=extra.user||modelUser
  const result=await admit(id,{user:owner,reserve:extra.reserve??.20,limits:{daily:1000},policy:pol})
  if(result.status==='admitted')leases.set(id,{lease:result.lease_id,owner,policy:pol})
  return result
}
async function begin(id,index,tier,reserve,extra={}) {
  const entry=leases.get(id)
  return (await db.query('SELECT public.focus_ai_begin_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
    [entry.owner,id,extra.lease||entry.lease,index,extra.model||'gpt-5.6-'+tier,tier,reserve,JSON.stringify(extra.policy||entry.policy),'schema_retry'])).rows[0].result
}
async function settle(id,index,cost=null,extra={}) {
  const entry=leases.get(id)
  return (await db.query('SELECT public.focus_ai_settle_attempt($1,$2,$3,$4,$5,$6) AS result',
    [entry.owner,id,extra.lease||entry.lease,index,cost,'success'])).rows[0].result
}
async function modelFinish(id,cost=0) {
  const entry=leases.get(id)
  return (await db.query('SELECT public.focus_ai_finish($1,$2,$3,$4,$5,$6) AS result',
    [entry.owner,id,entry.lease,JSON.stringify({httpStatus:200,body:{actions:[]}}),cost,'success'])).rows[0].result
}
async function metrics(pol=modelPolicy) { return (await db.query('SELECT public.focus_ai_model_metrics($1) AS result',[JSON.stringify(pol)])).rows[0].result }
await check('022 requires exact model, finite reservation, sequential attempt and genuine lease',async()=> {
  assert.equal((await modelAdmit('attempts')).status,'admitted')
  assert.equal((await begin('attempts',0,'luna',.02,{model:'gpt-6-astra'})).status,'unavailable')
  assert.equal((await begin('attempts',0,'luna',.02,{lease:'00000000-0000-4000-8000-000000000099'})).status,'unavailable')
  assert.equal((await begin('attempts',0,'luna',.02,{policy:{}})).status,'unavailable')
  assert.equal((await begin('attempts',1,'terra',.05)).status,'unavailable')
  assert.equal((await begin('attempts',0,'luna',.02)).status,'started')
  assert.equal((await begin('attempts',0,'luna',.02)).status,'already_started')
  assert.equal((await begin('attempts',1,'terra',.05)).status,'in_progress')
})
await check('022 unknown attempt charges its reservation and finish cannot hide it',async()=> {
  assert.equal((await settle('attempts',0,null)).status,'settled')
  assert.equal(Number((await settle('attempts',0,0)).actual_usd),.02)
  assert.equal((await begin('attempts',1,'terra',.05)).status,'started')
  assert.equal((await settle('attempts',1,.03)).status,'settled')
  assert.equal((await begin('attempts',2,'sol',.01)).status,'unavailable')
  assert.equal((await modelFinish('attempts',0)).status,'completed')
  assert.equal(Number((await db.query("SELECT actual_usd FROM public.focus_ai_requests WHERE request_id='attempts'")).rows[0].actual_usd),.05)
  assert.equal((await modelAdmit('attempts')).status,'replay')
})
await check('022 reserves Sol only when started and limits one Sol attempt per request',async()=> {
  const before=await metrics();assert.equal(Number(before.model_metrics.sol_monthly_spent_usd),0)
  await modelAdmit('sol-first')
  assert.equal(Number((await metrics()).model_metrics.sol_monthly_spent_usd),0)
  assert.equal((await begin('sol-first',0,'sol',.08)).status,'started')
  assert.equal(Number((await metrics()).model_metrics.sol_daily_spent_usd),.08)
  await settle('sol-first',0,.03)
  assert.equal((await begin('sol-first',1,'sol',.08)).status,'model_quota')
  await modelFinish('sol-first')
})
await check('022 independent Sol daily and monthly money caps permit a cheaper same-index fallback',async()=> {
  await modelAdmit('sol-daily',{policy:{sol_daily_budget_usd:.10}})
  assert.equal((await begin('sol-daily',0,'sol',.08)).status,'model_budget')
  assert.equal((await begin('sol-daily',0,'terra',.04)).status,'started')
  await settle('sol-daily',0,.01);await modelFinish('sol-daily')
  await modelAdmit('sol-monthly',{policy:{sol_monthly_budget_usd:.04}})
  assert.equal((await begin('sol-monthly',0,'sol',.02)).status,'model_budget')
  await modelFinish('sol-monthly')
})
await check('022 Sol user daily/monthly attempt quotas do not block Luna',async()=> {
  for(const period of ['daily','monthly']) {
    const id='sol-quota-'+period
    await modelAdmit(id,{policy:{['sol_user_'+period+'_requests']:1}})
    assert.equal((await begin(id,0,'sol',.01)).status,'model_quota')
    assert.equal((await begin(id,0,'luna',.01)).status,'started')
    await settle(id,0,.001);await modelFinish(id)
  }
})
await check('022 logical contention includes another owner pending Sol cost and releases no unknown money',async()=> {
  await modelAdmit('sol-pending',{policy:{sol_daily_budget_usd:.10}})
  assert.equal((await begin('sol-pending',0,'sol',.06)).status,'started')
  await modelAdmit('sol-other',{user:modelOther,policy:{sol_daily_budget_usd:.10}})
  assert.equal((await begin('sol-other',0,'sol',.02)).status,'model_budget')
  await settle('sol-pending',0,null); await modelFinish('sol-pending')
  assert.equal((await begin('sol-other',0,'sol',.02)).status,'model_budget')
  await modelFinish('sol-other')
})
await check('022 economy at 90 percent blocks Sol before any model row while Luna remains available',async()=> {
  const spent=Number((await metrics()).daily_spent_usd)
  const result=await modelAdmit('economy-model',{reserve:.1,policy:{daily_budget_usd:(spent+.1)/.92}})
  assert.equal(result.budget_level,'economy')
  assert.equal((await begin('economy-model',0,'sol',.08)).status,'economy')
  assert.equal((await begin('economy-model',0,'luna',.01)).status,'started')
  await settle('economy-model',0,.001);await modelFinish('economy-model')
})
await check('022 configurable monthly alerts are persisted once and returned as structured events',async()=> {
  const spent=Number((await metrics()).monthly_spent_usd)
  const result=await modelAdmit('alert-model',{reserve:.1,policy:{monthly_budget_usd:(spent+.1)/.80,alert_percentages:[51,76,91]}})
  assert.deepEqual(result.budget_alerts.filter(alert=>alert.scope==='global_monthly').map(alert=>Number(alert.threshold_percent)).sort((a,b)=>a-b),[51,76])
  const started=await begin('alert-model',0,'luna',.01)
  assert.equal(started.budget_alerts.filter(alert=>alert.scope==='global_monthly').length,0)
  assert.equal(Number((await db.query("SELECT count(*) FROM public.focus_ai_budget_alerts WHERE scope='global_monthly' AND threshold_percent IN (51,76)")).rows[0].count),2)
  await settle('alert-model',0,.001);await modelFinish('alert-model')
})
await check('022 explicit disabled Sol and malformed alert configuration fail closed',async()=> {
  await modelAdmit('sol-disabled',{policy:{sol_enabled:false}})
  assert.equal((await begin('sol-disabled',0,'sol',.01)).status,'model_budget')
  await modelFinish('sol-disabled')
  assert.equal((await modelAdmit('bad-alert',{policy:{alert_percentages:[]}})).status,'unavailable')
  assert.equal((await modelAdmit('bad-sol-cap',{policy:{sol_monthly_budget_usd:null}})).status,'unavailable')
})
await check('022 overrun is immediately visible to global admission and cannot be reduced at finish',async()=> {
  await modelAdmit('overrun',{reserve:.05})
  await begin('overrun',0,'luna',.02)
  assert.equal((await settle('overrun',0,.08)).reservation_overrun,true)
  assert.equal(Number((await db.query("SELECT actual_usd FROM public.focus_ai_requests WHERE request_id='overrun'")).rows[0].actual_usd),.08)
  assert.equal((await begin('overrun',1,'terra',.01)).status,'unavailable')
  await modelFinish('overrun',0)
  assert.equal(Number((await db.query("SELECT actual_usd FROM public.focus_ai_requests WHERE request_id='overrun'")).rows[0].actual_usd),.08)
})
await check('022 invalid settlement cannot finish or release a request with no authorized model',async()=> {
  await modelAdmit('invalid-finish')
  for(const cost of [-1,'NaN','Infinity']) assert.equal((await modelFinish('invalid-finish',cost)).status,'unavailable')
  const row=(await db.query("SELECT state,actual_usd FROM public.focus_ai_requests WHERE request_id='invalid-finish'")).rows[0]
  assert.equal(row.state,'in_progress');assert.equal(row.actual_usd,null)
  assert.equal((await modelFinish('invalid-finish',0)).status,'completed')
  assert.equal(Number((await db.query("SELECT actual_usd FROM public.focus_ai_requests WHERE request_id='invalid-finish'")).rows[0].actual_usd),0)
})
await check('022 database kill immediately denies new admission and leased attempts while preserving private replay',async()=> {
  const control=async enabled=>(await db.query('SELECT public.focus_ai_set_control($1) AS result',[enabled])).rows[0].result
  await modelAdmit('kill-pending')
  assert.equal((await control(false)).paid_enabled,false)
  assert.equal((await modelAdmit('kill-new')).reason,'paid_ai_disabled')
  assert.equal((await begin('kill-pending',0,'luna',.01)).reason,'paid_ai_disabled')
  assert.equal((await modelAdmit('attempts')).status,'replay')
  assert.equal((await admit('attempts',{user:modelUser,fingerprint:'b'.repeat(64)})).status,'conflict')
  await db.exec(readFileSync(resolve(root,'supabase/migrations/022_openai_model_admission.sql'),'utf8'))
  assert.equal((await db.query('SELECT public.focus_ai_get_control() AS result')).rows[0].result.paid_enabled,false)
  assert.equal((await control(true)).paid_enabled,true)
  assert.equal((await begin('kill-pending',0,'luna',.01)).status,'started')
  await settle('kill-pending',0,0);await modelFinish('kill-pending')
  for(const role of ['anon','authenticated']) {
    await db.exec('SET ROLE '+role)
    await assert.rejects(()=>db.query('SELECT public.focus_ai_set_control(true)'),/permission denied/)
    await assert.rejects(()=>db.query('SELECT public.focus_ai_get_control()'),/permission denied/)
    await assert.rejects(()=>db.query('SELECT * FROM public.focus_ai_control'),/permission denied/)
    await db.exec('RESET ROLE')
  }
})
await check('022 Sol metrics remain anonymous after account deletion and all operational tables are private',async()=> {
  const before=(await metrics()).model_metrics
  await db.query('DELETE FROM auth.users WHERE id=$1',[modelUser])
  const after=(await metrics()).model_metrics
  assert.equal(Number(after.sol_monthly_spent_usd),Number(before.sol_monthly_spent_usd))
  assert.equal(Number(after.sol_request_count),Number(before.sol_request_count))
  await db.exec('SET ROLE anon')
  await assert.rejects(()=>db.query('SELECT * FROM public.focus_ai_model_attempts'),/permission denied/)
  await assert.rejects(()=>db.query('SELECT * FROM public.focus_ai_budget_alerts'),/permission denied/)
  await assert.rejects(()=>metrics(),/permission denied/)
  await db.exec('RESET ROLE')
})
await db.close()
const report={engine:'PGlite / PostgreSQL WASM',runAt:new Date().toISOString(),passed:checks.length,checks,
  limitation:'Single database connection: execution, privileges and sequential invariants verified; multi-process advisory lock contention requires staging PostgreSQL.'}
writeFileSync(process.env.FOCUS_AI_SQL_REPORT || resolve(root,'docs/focus-2/qa/ai-admission-sql.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))

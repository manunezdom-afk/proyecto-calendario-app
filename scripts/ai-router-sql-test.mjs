// Integration: production runtime and real admission SQL; provider is synthetic.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ephemeralAIDatabase } from './lib/ephemeral-ai-database.mjs'
import { executeNovaRequest } from '../api/_lib/novaRuntime.js'
import { sanitizeNovaRequest } from '../api/_lib/novaSafety.js'
import { wireAction, wirePlan } from '../tests/helpers/novaFixtures.js'
import { writeFileSync } from 'node:fs'
process.env.OPENAI_API_KEY='offline-synthetic-provider-only'
process.env.AI_PAID_CALLS_ENABLED='true'
const database=await ephemeralAIDatabase(), checks=[]
const response=plan=>({status:'completed',output_text:JSON.stringify(plan),usage:{input_tokens:1000,output_tokens:200,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}}})
async function context(message='comprar pan') {
  const userId=randomUUID(),requestId=randomUUID()
  await database.db.query('INSERT INTO auth.users(id) VALUES($1)',[userId])
  return {admin:database.admin,userId,requestId,plan:'free',body:sanitizeNovaRequest({message,clientNow:Date.parse('2026-09-08T15:00Z'),clientTimezone:'America/Santiago'}).body}
}
async function check(name,run){await run();checks.push(name);console.log(`PASS ${name}`)}
try {
  await check('create plan settles its SQL attempt and replays with no second provider call',async()=>{
    const ctx=await context();let paid=0
    const callProviders={openai:async()=>{paid++;return response(wirePlan([wireAction()]))}}
    const out=await executeNovaRequest({...ctx,callProviders})
    assert.equal(out.httpStatus,200);assert.equal(out.body.actions[0].task.label,'Comprar pan')
    const again=await executeNovaRequest({...ctx,callProviders});assert.deepEqual(again,out);assert.equal(paid,1)
    const row=(await database.db.query('SELECT state,actual_usd,reserved_usd FROM public.focus_ai_requests WHERE user_id=$1',[ctx.userId])).rows[0]
    assert.equal(row.state,'completed');assert.ok(Number(row.actual_usd)<Number(row.reserved_usd))
  })
  await check('invalid JSON escalates once and accounts for both real SQL attempt rows',async()=>{
    const ctx=await context();let paid=0
    const out=await executeNovaRequest({...ctx,callProviders:{openai:async()=>++paid===1?{...response({}),output_text:'invalid json'}:response(wirePlan([wireAction()]))}})
    assert.equal(out.httpStatus,200);assert.equal(paid,2)
    const rows=(await database.db.query('SELECT a.* FROM public.focus_ai_model_attempts a JOIN public.focus_ai_requests r ON r.id=a.request_row_id WHERE r.user_id=$1',[ctx.userId])).rows
    assert.equal(rows.length,2);assert.equal(database.events.filter(row=>row.user_id===ctx.userId).length,2)
  })
  await check('401 stops after one call and stores a safe terminal replay',async()=>{
    const ctx=await context();let paid=0
    const callProviders={openai:async()=>{paid++;throw Object.assign(new Error('synthetic authentication failure'),{status:401})}}
    const out=await executeNovaRequest({...ctx,callProviders});assert.equal(out.httpStatus,503);assert.equal(paid,1)
    assert.equal(out.body.request_completed,true);assert.deepEqual(out.body.actions,[])
    assert.deepEqual(await executeNovaRequest({...ctx,callProviders}),out);assert.equal(paid,1)
  })
  await check('tracking failure cannot return executable actions or release unknown cost',async()=>{
    const ctx=await context()
    const out=await executeNovaRequest({...ctx,track:async()=>({ok:false}),callProviders:{openai:async()=>response(wirePlan([wireAction()]))}})
    assert.equal(out.httpStatus,503);assert.deepEqual(out.body.actions,[])
    const row=(await database.db.query('SELECT actual_usd FROM public.focus_ai_requests WHERE user_id=$1',[ctx.userId])).rows[0]
    assert.ok(Number(row.actual_usd)>0)
  })
  await check('atomic quota denial never reaches provider',async()=>{
    const ctx=await context();let paid=0
    await database.db.query("INSERT INTO public.ai_usage(user_id,endpoint,day,count) VALUES($1,'nova_message',(now() AT TIME ZONE 'UTC')::date,20)",[ctx.userId])
    const out=await executeNovaRequest({...ctx,callProviders:{openai:async()=>{paid++;return response(wirePlan([]))}}})
    assert.equal(out.httpStatus,429);assert.equal(paid,0)
  })
  await check('disabled Sol downgrades safely before any Sol call',async()=>{
    process.env.AI_SOL_ENABLED='false'
    try {
      const ctx=await context('Organízame toda la semana considerando universidad, gimnasio, Focus, mis pendientes y sueño; no quiero estudiar después de las 8 y deja viernes y sábado libres.')
      const models=[]
      const out=await executeNovaRequest({...ctx,callProviders:{openai:async({model})=>{models.push(model);return response(wirePlan([]))}}})
      assert.ok(models.every(model=>model!=='gpt-5.6-sol'));assert.equal(out.httpStatus,200);assert.ok(models.length>0)
    }finally{delete process.env.AI_SOL_ENABLED}
  })
  const report={runAt:new Date().toISOString(),passed:checks.length,checks,migrations:database.migrations,provider:'synthetic only',database:'real PostgreSQL WASM',productionVerified:false}
  writeFileSync(new URL('../docs/focus-2/qa/ai-router-sql.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
}finally{await database.close()}

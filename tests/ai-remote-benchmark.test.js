import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync,writeFileSync,statSync,existsSync } from 'node:fs'
import { parseRemoteBenchmarkOptions,runRemoteBenchmark,vercelFocusFetch,mayStartRemoteRequest } from '../scripts/ai-remote-benchmark.mjs'
import { EXPECTED_SUPABASE_URL } from '../scripts/ai-remote-check.mjs'
const origin='https://focus-app-test-manunezdom-9658s-projects.vercel.app'
const env={SUPABASE_URL:EXPECTED_SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:'private-service',SUPABASE_ANON_KEY:'private-anon',FOCUS_VERCEL_BYPASS:'private-bypass'}
const cases=Array.from({length:3},(_,i)=>({id:'T'+i,cat:'tasks',input:'comprar pan',expect:{kind:'task',titleIncludes:['pan']}}))
const options=(extra=[])=>parseRemoteBenchmarkOptions(['--live','--base-url',origin,'--limit','3','--users','1',...extra])
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status})

function fake({cost=.01,uncertain=false,legacy=false,ownerMismatch=false,extraReplay=false,terminalFailure=false}={}) {
 const users=new Map(),ledger=new Map(),attempts=[],events=[],calls=[];let paid=0
 const fetchImpl=async(url,request={})=>{
  const u=new URL(url),path=u.pathname,body=request.body?JSON.parse(request.body):{},method=request.method||'GET'
  calls.push({path,method,body,headers:request.headers})
  if(u.origin===origin) {
   assert.equal(request.redirect,'error');assert.equal(request.headers['x-vercel-protection-bypass'],'private-bypass')
   if(path==='/api/ai-capabilities')return reply({runtime:legacy?'old':'focus-openai-v1',chat_provider:'openai'})
   assert.equal(path,'/api/focus-assistant')
   const id=request.headers['X-Request-Id'],userId=request.headers.Authorization.replace('Bearer private-token-','')
   let row=[...ledger.values()].find(r=>r.request_id===id)
   if(!row){
    paid++;row={id:randomUUID(),request_id:id,lease_id:randomUUID(),user_id:userId,state:uncertain?'in_progress':terminalFailure?'failed':'completed',actual_usd:uncertain?null:cost,reserved_usd:.25,fingerprint:'synthetic'}
    row.response={requestId:id,reply:'Pendiente para guardar.',mode:'chat_with_action',actions:[{type:'add_task',task:{label:'Comprar pan'}}],proposed_actions:[],validation:{ok:true,issues:[]}};if(terminalFailure)row.response={requestId:id,error:'assistant_unavailable',request_completed:true,request_retryable:true,actions:[],proposed_actions:[]};ledger.set(row.id,row)
    attempts.push({request_row_id:row.id,model:'gpt-5.6-luna',attempt_index:0,state:uncertain?'started':'settled',actual_usd:row.actual_usd,reserved_usd:.25})
    if(!uncertain)events.push({user_id:userId,action_type:'nova_message',model_used:'gpt-5.6-luna',input_tokens:1000,output_tokens:200,estimated_cost_usd:cost,metadata:{request_id:id,admission_lease_id:row.lease_id,cost_basis:'provider_usage',usage_source:'openai_usage'}})
    if(uncertain)throw new Error('private-token unknown transport')
   }else if(extraReplay){paid++;attempts.push({request_row_id:row.id,model:'gpt-5.6-terra',attempt_index:1,state:'settled',actual_usd:.02});row.actual_usd+=.02}
   return reply(row.response,terminalFailure?503:200)
  }
  assert.equal(u.origin,EXPECTED_SUPABASE_URL)
  assert.equal(request.headers['x-vercel-protection-bypass'],undefined)
  if(path==='/rest/v1/rpc/focus_ai_get_control')return reply({status:'ok',paid_enabled:true})
  if(path==='/auth/v1/admin/users') {assert.equal(method,'POST');users.set(body.id,{...body});return reply(body)}
  if(path==='/auth/v1/token') {const user=[...users.values()].find(x=>x.email===body.email);return reply({user:{id:user.id},access_token:'private-token-'+user.id})}
  if(path.startsWith('/auth/v1/admin/users/')) {
   const id=path.split('/').at(-1),user=users.get(id)
   if(method==='DELETE'){users.delete(id);for(const row of ledger.values())if(row.user_id===id){row.user_id=null;row.request_id=row.id;row.fingerprint='';row.response=null};return reply({})}
   return reply(ownerMismatch?{...user,user_metadata:{}}:user)
  }
  if(path==='/rest/v1/focus_ai_requests') {
   const id=u.searchParams.get('id')?.slice(3),ids=u.searchParams.get('user_id')?.slice(4,-1).split(',')
   assert.ok(id||ids,'scope required');return reply([...ledger.values()].filter(r=>id?r.id===id:ids.includes(r.user_id)))
  }
  if(path==='/rest/v1/focus_ai_model_attempts') {const ids=u.searchParams.get('request_row_id').slice(4,-1).split(',');return reply(attempts.filter(r=>ids.includes(r.request_row_id)))}
  if(path==='/rest/v1/ai_usage_events') {const ids=u.searchParams.get('user_id').slice(4,-1).split(',');return reply(events.filter(r=>ids.includes(r.user_id)))}
  throw new Error('Unexpected path')
 }
 return {fetchImpl,users,ledger,calls,get paid(){return paid}}
}
const run=(server,opts=options())=>runRemoteBenchmark(opts,{env,fetchImpl:server.fetchImpl,sleep:async()=>{},writeReport:false,cases})

test('offline runner does no network or credential validation',async()=>{
 const report=await runRemoteBenchmark(parseRemoteBenchmarkOptions([]),{env:{},fetchImpl:()=>{throw new Error('network forbidden')},writeReport:false,cases})
 assert.equal(report.status,'not_executed');assert.equal(report.summary.attempted,0);assert.equal(report.summary.totalObservedCostUSD,null)
})
test('host, user capacity and conservative per-run bounds fail closed',()=>{
 for(const args of [['--live'],['--base-url','https://evil.invalid'],['--users','1'],['--budget','.1'],['--budget','1.1'],['--limit','212'],['--users','25'],['--limit','211','--users','23']])assert.throws(()=>parseRemoteBenchmarkOptions(args))
 assert.equal(mayStartRemoteRequest(.75,1),true);assert.equal(mayStartRemoteRequest(.751,1),false);assert.equal(mayStartRemoteRequest(null,1),false)
 assert.equal(parseRemoteBenchmarkOptions(['--limit','1']).users,1)
 assert.equal(parseRemoteBenchmarkOptions(['--limit','100']).users,12)
 assert.equal(parseRemoteBenchmarkOptions(['--limit','211']).users,24)
})
test('real-flow mock uses own users, identical HTTP replay and retains cost after cleanup',async()=>{
 const server=fake(),report=await run(server)
 assert.equal(report.status,'completed',report.errorCode);assert.equal(server.paid,3)
 assert.equal(report.summary.replayChecks,3);assert.equal(report.summary.recordedRunChargeUSD,.03)
 assert.equal(report.summary.costObservationSufficient,true);assert.equal(report.cleanup.verified,1);assert.equal(server.users.size,0)
 assert.ok([...server.ledger.values()].every(row=>row.user_id===null&&row.response===null))
 assert.doesNotMatch(JSON.stringify(report),/private-service|private-anon|private-token|private-bypass|example\.invalid/)
 assert.equal(server.calls.filter(call=>call.path.startsWith('/rest/v1/rpc/')).length,1,'runner must never manipulate quotas or admission RPCs')
})
test('run cap leaves room for the entire next request and stops before overspend',async()=>{
 const server=fake({cost:.2}),report=await run(server,options(['--budget','.5']))
 assert.equal(report.status,'stopped');assert.equal(report.stopped,'run_budget_reservation_cap');assert.equal(server.paid,2)
 assert.equal(report.summary.recordedRunChargeUSD,.4);assert.equal(report.cleanup.verified,1)
})
test('an uncertain response stops paid requests and preserves unresolved reservation during cleanup',async()=>{
 const server=fake({uncertain:true}),report=await run(server)
 assert.equal(report.status,'failed');assert.equal(server.paid,1);assert.equal(report.summary.recordedRunChargeUSD,.25)
 assert.equal(report.summary.providerAttempts,1);assert.equal(report.summary.totalObservedCostUSD,null);assert.equal(report.cleanup.verified,1)
 assert.equal(server.calls.filter(c=>c.path==='/api/focus-assistant').length,1)
 assert.doesNotMatch(JSON.stringify(report),/private-token/)
})
test('wrong runtime causes no account writes and ownership mismatch prevents deletion',async()=>{
 const server=fake({legacy:true}),report=await run(server)
 assert.equal(report.status,'failed');assert.equal(server.paid,0);assert.equal(server.users.size,0)
 const owner=fake({ownerMismatch:true}),failed=await run(owner)
 assert.equal(failed.cleanup.deleted,0);assert.equal(failed.cleanup.pendingSyntheticUserIds.length,1)
})
test('extra replay attempts fail the run and remain in accounting',async()=>{
 const server=fake({extraReplay:true}),report=await run(server)
 assert.equal(report.status,'failed');assert.equal(report.errorCode,'replay_mismatch');assert.equal(server.paid,2)
 assert.equal(report.summary.providerAttempts,2);assert.equal(report.summary.recordedRunChargeUSD,.03)
 assert.equal(report.summary.costObservationSufficient,false)
})
test('Vercel CLI receives only private config path; rejects redirects to other origins',async()=>{
 let configPath
 const transport=vercelFocusFetch(origin,{execImpl:async(binary,args)=>{
  assert.equal(binary,'vercel');assert.doesNotMatch(args.join(' '),/secret-auth|secret-bypass/)
  configPath=args.at(-1);assert.equal(statSync(configPath).mode&0o777,0o600)
  const config=readFileSync(configPath,'utf8');assert.match(config,/secret-auth/)
  const output=JSON.parse(config.match(/^output = (.*)$/m)[1]);writeFileSync(output,'{"ok":true}')
  return {stdout:'200',stderr:'ignored private CLI diagnostics'}
 }})
 const response=await transport(origin+'/api/focus-assistant',{method:'POST',headers:{Authorization:'Bearer secret-auth','x-vercel-protection-bypass':'secret-bypass'},body:'{}'})
 assert.equal(response.status,200);assert.equal(existsSync(configPath),false)
 await assert.rejects(()=>transport('https://evil.invalid/api/focus-assistant'),/focus_request_not_allowed/)
})

test('all 211 cases fit bounded evidence reads and 24 isolated accounts',async()=>{
 const server=fake({cost:.001});const corpus=Array.from({length:211},(_,i)=>({...cases[i%3],id:'FULL'+i}))
 const opts=parseRemoteBenchmarkOptions(['--live','--base-url',origin,'--limit','211'])
 const report=await runRemoteBenchmark(opts,{env,fetchImpl:server.fetchImpl,sleep:async()=>{},writeReport:false,cases:corpus})
 assert.equal(report.status,'completed',report.errorCode);assert.equal(report.summary.attempted,211)
 assert.equal(report.summary.replayChecks,211);assert.equal(report.cleanup.verified,24);assert.equal(server.users.size,0)
 assert.equal(report.summary.providerAttempts,211);assert.ok(report.runnerSourceHashes['scripts/ai-remote-benchmark.mjs'])
 assert.ok(report.summary.recordedRunChargeUSD < 1)
})

test('durable failed requests replay without paying again and remain failed benchmark cases',async()=>{
 const server=fake({terminalFailure:true}),report=await run(server)
 assert.equal(report.status,'completed',report.errorCode);assert.equal(report.summary.objectivePass,0)
 assert.equal(report.summary.attempted,3);assert.equal(report.summary.replayChecks,3);assert.equal(server.paid,3)
 assert.ok(report.rows.every(row=>row.verdict.fails.includes('runtime_http_503')))
 assert.equal(report.cleanup.verified,1);assert.equal(server.users.size,0)
})

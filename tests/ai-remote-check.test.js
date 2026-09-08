import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EXPECTED_SUPABASE_URL,allowedChatOrigin,parseRemoteOptions,remoteConfiguration,remoteTransport,runRemoteCheck } from '../scripts/ai-remote-check.mjs'

const env={SUPABASE_URL:EXPECTED_SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',VITE_SUPABASE_ANON_KEY:'synthetic-anon'}
const reply=(data,status=200)=>({ok:status>=200 && status<300,status,text:async()=>JSON.stringify(data)})

test('default and legacy URL invocations are offline even with credentials',async()=>{
  let called=0
  for(const argv of [[],['https://usefocus.me']]) {
    const result=await runRemoteCheck(parseRemoteOptions(argv),{env,fetchImpl:async()=>{called++}})
    assert.equal(result.status,'not_executed');assert.equal(result.remoteVerified,false)
  }
  assert.equal(called,0)
})
test('chat is explicit and only exact owned HTTPS deployment origins are allowed',()=>{
  assert.throws(()=>parseRemoteOptions(['--chat']),/chat_requires_live_db/)
  for(const value of ['http://usefocus.me','https://usefocus.me.evil.test','https://usefocus.me@evil.test','https://usefocus.me/api','https://usefocus.me?key=x',
    'https://focus-app-other.vercel.app','https://focus-app-x-manunezdom-9658s-projects.vercel.app.evil.test'])assert.equal(allowedChatOrigin(value),null)
  assert.equal(allowedChatOrigin('https://focus-app-abc123-manunezdom-9658s-projects.vercel.app'),'https://focus-app-abc123-manunezdom-9658s-projects.vercel.app')
  assert.equal(parseRemoteOptions(['--live-db','--chat']).chat,true)
})
test('missing credentials and a different Supabase project fail before all networking',async()=>{
  let calls=0
  for(const invalid of [{},{...env,SUPABASE_URL:'https://other.supabase.co'},{...env,SUPABASE_SERVICE_ROLE_KEY:''},{...env,VITE_SUPABASE_ANON_KEY:''}]) {
    await assert.rejects(()=>runRemoteCheck(parseRemoteOptions(['--live-db']),{env:invalid,fetchImpl:async()=>{calls++},writeReport:false}))
  }
  assert.equal(calls,0);assert.equal(remoteConfiguration(env).url,EXPECTED_SUPABASE_URL)
})
test('transport forbids redirects and never exposes private error bodies',async()=>{
  let options
  const request=remoteTransport(remoteConfiguration(env),async(_url,opts)=>{options=opts;throw new Error('secret-key provider-body')})
  await assert.rejects(()=>request('/rest/v1/rpc/focus_ai_model_metrics'),error=>error.message==='remote_transport_failed')
  assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal)
})
test('missing migration fails before any synthetic account write',async()=>{
  const calls=[]
  const report=await runRemoteCheck(parseRemoteOptions(['--live-db']),{env,writeReport:false,fetchImpl:async(url,options)=>{
    calls.push({url,options});return reply({code:'PGRST202',message:'private migration detail'},404)
  }})
  assert.equal(report.status,'failed');assert.equal(report.errorCode,'rpc_unavailable_focus_ai_get_control')
  assert.equal(calls.length,1);assert.equal(report.cleanup.deleted,0);assert.doesNotMatch(JSON.stringify(report),/private migration detail/)
})

function fakeServer({ownershipMismatch=false,chatAttempts=1,legacyRuntime=false,unknownCost=false,conservativeCost=false,heldGlobalReserve=false,reorderReplay=false}={}) {
  const users=new Map(),rows=new Map(),calls=[],attempts=new Map(),telemetry=new Map();let paid=0
  // This preexisting user must never be listed, modified or deleted.
  const unrelated=randomUUID();users.set(unrelated,{id:unrelated,email:'unrelated@example.invalid',user_metadata:{}})
  const fetchImpl=async(value,options={})=>{
    const url=new URL(value),path=url.pathname,body=options.body?JSON.parse(options.body):{},method=options.method||'GET'
    calls.push({path,method,body})
    const service=options.headers?.apikey===env.SUPABASE_SERVICE_ROLE_KEY
    if(path==='/api/ai-capabilities')return reply({runtime:legacyRuntime?'old-runtime':'focus-openai-v1',chat_provider:legacyRuntime?'deepseek':'openai'})
    if(path==='/auth/v1/settings')return reply({external:{email:true}})
    if(path==='/auth/v1/admin/users') {
      assert.equal(method,'POST','the harness must never list all users')
      users.set(body.id,{...body});return reply(body)
    }
    if(path.startsWith('/auth/v1/admin/users/')) {
      const id=path.split('/').at(-1),user=users.get(id)
      assert.notEqual(id,unrelated)
      if(method==='DELETE') {
        assert.equal(body.should_soft_delete,false);users.delete(id)
        for(const row of rows.values())if(row.user_id===id){row.user_id=null;row.response=null;row.fingerprint='';row.request_id=row.id}
        return reply({})
      }
      return user?reply(ownershipMismatch?{...user,user_metadata:{}}:user):reply({},404)
    }
    if(path==='/auth/v1/token') {
      const user=[...users.values()].find(user=>user.email===body.email)
      return reply({user:{id:user.id},access_token:'synthetic-token-'+user.id})
    }
    if(path==='/api/focus-assistant') {
      const userId=options.headers.Authorization.replace('Bearer synthetic-token-',''),requestId=options.headers['X-Request-Id']
      let row=[...rows.values()].find(row=>row.user_id===userId && row.request_id===requestId)
      if(!row) {
        paid++;row={id:randomUUID(),lease_id:randomUUID(),user_id:userId,request_id:requestId,state:'completed',reserved_usd:.05,actual_usd:unknownCost ? null : (conservativeCost || heldGlobalReserve) ? .05 : .004,fingerprint:'chat-fingerprint',response:{body:{requestId,actions:[{type:'add_task',task:{label:'Comprar pan'}}]}}};rows.set(row.id,row)
        attempts.set(row.id,Array.from({length:chatAttempts},()=>({model:'gpt-5.6-luna',state:'settled',actual_usd:.004})))
        telemetry.set(userId,[{id:randomUUID(),metadata:{request_id:requestId,admission_lease_id:row.lease_id,cost_basis:conservativeCost || unknownCost?'reservation':'provider_usage'}}])
      } else if(reorderReplay) {
        return reply({actions:row.response.body.actions.map(a=>({task:a.task,type:a.type})),requestId:row.response.body.requestId})
      }
      return reply(row.response.body)
    }
    if(path.startsWith('/rest/v1/') && !service)return reply({code:'42501'},403)
    if(path.startsWith('/rest/v1/rpc/')) {
      const name=path.split('/').at(-1)
      if(name==='focus_ai_get_control')return reply({status:'ok',paid_enabled:true})
      if(name==='focus_ai_model_metrics')return reply({status:'ok',model_metrics:{},tiers:[]})
      let row=[...rows.values()].find(row=>row.user_id===body.p_user_id && row.request_id===body.p_request_id)
      if(name==='focus_ai_admit') {
        if(!body.p_user_id)return reply({status:'unavailable'})
        if(row)return reply(row.state==='in_progress'?{status:'in_progress'}:{status:'replay',lease_id:row.lease_id,response:row.response})
        const own=[...rows.values()].filter(row=>row.user_id===body.p_user_id)
        if(own.length>=body.p_policy.requests_per_minute)return reply({status:'rate'})
        if(own.some(row=>row.state==='in_progress'))return reply({status:'concurrency'})
        if(own.length>=body.p_limits.daily)return reply({status:'quota'})
        if(body.p_reserve_usd>body.p_policy.user_daily_budget_usd)return reply({status:'budget'})
        row={id:randomUUID(),lease_id:randomUUID(),user_id:body.p_user_id,request_id:body.p_request_id,state:'in_progress',reserved_usd:body.p_reserve_usd,actual_usd:null,response:null,fingerprint:body.p_fingerprint};rows.set(row.id,row)
        return reply({status:'admitted',lease_id:row.lease_id})
      }
      if(!row || row.lease_id!==body.p_lease_id)return reply({status:'unavailable'})
      if(name==='focus_ai_begin_attempt')return reply({status:body.p_policy.sol_enabled===false?'model_budget':'started'})
      if(name==='focus_ai_finish'){row.actual_usd=body.p_actual_usd;row.state='completed';row.response=body.p_response;return reply({status:'completed'})}
      return reply({status:'unavailable'})
    }
    if(path==='/rest/v1/focus_ai_requests') {
      const owner=url.searchParams.get('user_id')?.slice(3),id=url.searchParams.get('id')?.slice(3)
      assert.ok(owner || id,'all ledger reads must be scoped to known synthetic identity')
      return reply([...rows.values()].filter(row=>owner?row.user_id===owner:row.id===id))
    }
    if(path==='/rest/v1/focus_ai_model_attempts')return reply(attempts.get(url.searchParams.get('request_row_id')?.slice(3)) || [])
    if(path==='/rest/v1/ai_usage_events')return reply(telemetry.get(url.searchParams.get('user_id')?.slice(3)) || [])
    throw new Error('Unexpected mock path')
  }
  return {fetchImpl,users,rows,calls,unrelated,get paid(){return paid}}
}
test('offline simulated live flow verifies contention and deletes only its own accounts',async()=>{
  const server=fakeServer(),report=await runRemoteCheck(parseRemoteOptions(['--live-db']),{env,fetchImpl:server.fetchImpl,writeReport:false})
  assert.equal(report.status,'passed',report.errorCode);assert.equal(report.cleanup.deleted,1);assert.equal(report.cleanup.verified,1)
  assert.equal(server.users.size,1);assert.ok(server.users.has(server.unrelated));assert.equal(server.paid,0)
  assert.equal(server.rows.size,3);assert.ok([...server.rows.values()].every(row=>row.user_id===null && row.response===null && row.fingerprint==='' && row.actual_usd===0))
  assert.doesNotMatch(JSON.stringify(report),/synthetic-service|synthetic-anon|example\.invalid|synthetic-token/)
})
test('cleanup refuses deletion when its run marker does not match',async()=>{
  const server=fakeServer({ownershipMismatch:true}),report=await runRemoteCheck(parseRemoteOptions(['--live-db']),{env,fetchImpl:server.fetchImpl,writeReport:false})
  assert.equal(report.status,'failed');assert.equal(report.cleanup.deleted,0);assert.equal(report.cleanup.pendingSyntheticUserIds.length,1)
  assert.equal(server.calls.filter(call=>call.method==='DELETE').length,0)
})
test('explicit chat uses one UUID twice, validates one attempt and preserves anonymous charged cost',async()=>{
  const server=fakeServer(),report=await runRemoteCheck(parseRemoteOptions(['--live-db','--chat']),{env,fetchImpl:server.fetchImpl,writeReport:false})
  assert.equal(report.status,'passed',report.errorCode);assert.equal(server.paid,1);assert.equal(report.chat.taskPersisted,false)
  assert.equal(server.calls.filter(call=>call.path==='/api/focus-assistant').length,2)
  assert.equal(report.cleanup.deleted,2);assert.equal(report.cleanup.verified,2)
  assert.ok([...server.rows.values()].some(row=>row.actual_usd===.004 && row.user_id===null))
})
test('an unexpected second provider attempt fails the check and still cleans up',async()=>{
  const server=fakeServer({chatAttempts:2}),report=await runRemoteCheck(parseRemoteOptions(['--live-db','--chat']),{env,fetchImpl:server.fetchImpl,writeReport:false})
  assert.equal(report.status,'failed');assert.equal(report.errorCode,'chat_attempt_count_failed');assert.equal(report.cleanup.deleted,2)
})
test('legacy runtime is rejected before any account write or paid call',async()=>{
  const server=fakeServer({legacyRuntime:true}),report=await runRemoteCheck(parseRemoteOptions(['--live-db','--chat']),{env,fetchImpl:server.fetchImpl,writeReport:false})
  assert.equal(report.status,'failed');assert.equal(report.errorCode,'deployment_runtime_not_openai');assert.equal(server.paid,0)
  assert.equal(server.calls.length,1);assert.equal(server.users.size,1)
})
test('unknown stored billing remains null with its reservation rather than a false zero',async()=>{
  const server=fakeServer({unknownCost:true}),report=await runRemoteCheck(parseRemoteOptions(['--live-db','--chat']),{env,fetchImpl:server.fetchImpl,writeReport:false})
  assert.equal(report.status,'passed',report.errorCode);assert.equal(report.chat.costUSD,null)
  assert.equal(report.chat.costBasis,'reservation_unknown_actual');assert.equal(report.chat.reservedUSD,.05)
})
test('HTTP replay permits reordered JSON object keys while retaining the same action data',async()=>{
  const server=fakeServer({reorderReplay:true}),report=await runRemoteCheck(parseRemoteOptions(['--live-db','--chat']),{env,fetchImpl:server.fetchImpl,writeReport:false})
  assert.equal(report.status,'passed',report.errorCode);assert.equal(server.paid,1)
})
test('a settled reservation is reported as conservative even when actual_usd is populated',async()=>{
  const server=fakeServer({conservativeCost:true}),report=await runRemoteCheck(parseRemoteOptions(['--live-db','--chat']),{env,fetchImpl:server.fetchImpl,writeReport:false})
  assert.equal(report.status,'passed',report.errorCode);assert.equal(report.chat.costUSD,null)
  assert.equal(report.chat.recordedCostUSD,.05);assert.equal(report.chat.costBasis,'conservative_reservation')
})
test('known attempt usage does not turn a larger retained global hold into measured cost',async()=>{
  const server=fakeServer({heldGlobalReserve:true}),report=await runRemoteCheck(parseRemoteOptions(['--live-db','--chat']),{env,fetchImpl:server.fetchImpl,writeReport:false})
  assert.equal(report.status,'passed',report.errorCode);assert.equal(report.chat.costUSD,null)
  assert.equal(report.chat.recordedCostUSD,.05);assert.equal(report.chat.costBasis,'conservative_reservation')
})

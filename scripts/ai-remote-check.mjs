#!/usr/bin/env node
// Offline by default. --live-db creates disposable users; --chat explicitly
// adds one logical paid request and its HTTP replay. No real-user inspection.
import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { admissionPolicy } from '../api/_lib/novaAdmission.js'

export const EXPECTED_SUPABASE_URL='https://hvwqeemtfoyvfmongwzo.supabase.co'
const PRIVATE_TABLES=['focus_ai_requests','focus_ai_consumptions','focus_ai_model_attempts','focus_ai_budget_alerts','focus_ai_control']
class CheckError extends Error { constructor(code) {super(code);this.code=code} }
const check=(condition,code)=>{if(!condition)throw new CheckError(code)}
const fingerprint=text=>createHash('sha256').update(text.trim()).digest('hex')
const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export function allowedChatOrigin(value) {
  try {
    const u=new URL(value)
    if(u.protocol!=='https:' || u.username || u.password || u.port || u.search || u.hash || !['','/'].includes(u.pathname))return null
    return ['www.usefocus.me','usefocus.me'].includes(u.hostname) || /^focus(?:-app)?(?:-[a-z0-9-]+)?-manunezdom-9658s-projects\.vercel\.app$/.test(u.hostname) ? u.origin : null
  } catch {return null}
}
export function parseRemoteOptions(argv=[]) {
  const out={liveDB:false,chat:false,baseURL:'https://www.usefocus.me',reportPath:null,help:false}
  for(let i=0;i<argv.length;i++) {
    const flag=argv[i]
    if(flag==='--live-db')out.liveDB=true
    else if(flag==='--chat')out.chat=true
    else if(flag==='--help' || flag==='-h')out.help=true
    else if(flag==='--base-url' || flag==='--report') {
      check(typeof argv[i+1]==='string' && !argv[i+1].startsWith('--'),'missing_option_value')
      out[flag==='--base-url'?'baseURL':'reportPath']=argv[++i]
    } else if(i===0 && /^https:\/\//.test(flag))out.baseURL=flag // Legacy URL alone stays dry.
    else throw new CheckError('unknown_option')
  }
  check(!out.chat || out.liveDB,'chat_requires_live_db')
  out.baseURL=allowedChatOrigin(out.baseURL);check(out.baseURL,'deployment_not_allowed')
  return out
}
export function remoteConfiguration(env=process.env) {
  const url=env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const serviceKey=env.SUPABASE_SERVICE_ROLE_KEY?.trim(),anonKey=(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY)?.trim()
  check(url===EXPECTED_SUPABASE_URL,'supabase_project_not_allowed')
  check(serviceKey && anonKey && serviceKey!==anonKey,'missing_or_invalid_credentials')
  return {url,serviceKey,anonKey}
}
export function remoteInventory(options,env=process.env) {
  return {status:'not_executed',remoteVerified:false,mode:options.liveDB?'live_requested':'offline_inventory',project:EXPECTED_SUPABASE_URL,deployment:options.baseURL,
    credentials:{serviceRolePresent:!!env.SUPABASE_SERVICE_ROLE_KEY,anonPresent:!!(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY),expectedProjectConfigured:(env.SUPABASE_URL || env.VITE_SUPABASE_URL)===EXPECTED_SUPABASE_URL},
    plannedChecks:['read-only migration 022 and auth preflight','8 concurrent identical IDs','6 concurrent distinct IDs','quota/rate/budget denial','disabled Sol denial','durable replay','anon/authenticated RLS','scoped synthetic cleanup and anonymous costs'],
    chat:options.chat?{logicalRequests:1,httpRequests:2,maximumProviderAttempts:2,requestCostCapUSD:admissionPolicy().request_budget_usd,taskPersisted:false}:{status:'not_requested'}}
}
export function remoteTransport(config,fetchImpl=fetch) {
  check(config.url===EXPECTED_SUPABASE_URL,'supabase_project_not_allowed')
  return async(path,{method='GET',body,token=config.serviceKey,key=config.serviceKey}={})=>{
    check(path.startsWith('/') && !path.startsWith('//'),'request_path_not_allowed')
    let response
    try {response=await fetchImpl(config.url+path,{method,headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(15000)})}
    catch {throw new CheckError('remote_transport_failed')}
    let data
    try {const text=await response.text();check(text.length<=1000000,'remote_response_too_large');data=text?JSON.parse(text):null}
    catch {throw new CheckError('remote_response_invalid')}
    return {ok:response.ok,status:response.status,data}
  }
}

export async function runRemoteCheck(options,{env=process.env,fetchImpl=fetch,writeReport=true}={}) {
  const report=remoteInventory(options,env)
  if(!options.liveDB)return report
  // Validate every local guard before any network request or write.
  const config=remoteConfiguration(env),policy={...admissionPolicy(),model_attempts_required:true}
  check(allowedChatOrigin(options.baseURL),'deployment_not_allowed')
  check(['daily_budget_usd','monthly_budget_usd','user_daily_budget_usd','user_monthly_budget_usd','request_budget_usd'].every(key=>policy[key]>0),'local_budget_disabled')
  check(policy.requests_per_minute>=3 && policy.max_concurrent===1,'local_policy_incompatible_with_contention_fixture')
  const runId=randomUUID(),request=remoteTransport(config,fetchImpl),created=[]
  const reportPath=resolve(options.reportPath || join(tmpdir(),`focus-ai-remote-check-${runId}.json`))
  Object.assign(report,{status:'running',runId,startedAt:new Date().toISOString(),reportPath,passed:[],cleanup:{pendingSyntheticUserIds:[],deleted:0,verified:0}})
  const checkpoint=()=>{if(writeReport){writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});chmodSync(reportPath,0o600)}}
  const pass=name=>{report.passed.push(name);checkpoint()}
  checkpoint()
  const rpc=async(name,args)=>{
    const r=await request(`/rest/v1/rpc/${name}`,{method:'POST',body:args})
    check(r.ok && typeof r.data?.status==='string','rpc_unavailable_'+name);return r.data
  }
  const args=(owner,id,overrides={})=>({p_user_id:owner,p_request_id:id,p_fingerprint:fingerprint('Synthetic admission check'),p_action_type:'nova_message',p_limits:{daily:20},p_reserve_usd:.001,p_policy:policy,...overrides})
  const finishArgs=(owner,id,lease)=>({p_user_id:owner,p_request_id:id,p_lease_id:lease,p_response:{httpStatus:200,body:{reply:'Synthetic plan only',actions:[]}},p_actual_usd:0,p_outcome:'success'})
  const attemptArgs=(owner,id,lease)=>({p_user_id:owner,p_request_id:id,p_lease_id:lease,p_attempt_index:0,p_model:'gpt-5.6-sol',p_tier:'sol',p_reserve_usd:.001,p_policy:{...policy,sol_enabled:false},p_reason:'synthetic_sol_disabled'})
  async function createSynthetic(kind) {
    const id=randomUUID(),email=`focus-check-${runId}-${kind}@example.invalid`,password=randomBytes(36).toString('base64url')
    // Preassigned IDs permit scoped cleanup after an ambiguous create response.
    const entry={id,email,kind};created.push(entry);report.cleanup.pendingSyntheticUserIds.push(id);checkpoint()
    const r=await request('/auth/v1/admin/users',{method:'POST',body:{id,email,password,email_confirm:true,user_metadata:{focus_ai_remote_check_run:runId}}})
    check(r.ok && (r.data?.id || r.data?.user?.id)===id,'synthetic_user_create_failed')
    const signed=await request('/auth/v1/token?grant_type=password',{method:'POST',key:config.anonKey,token:config.anonKey,body:{email,password}})
    check(signed.ok && signed.data?.user?.id===id && typeof signed.data.access_token==='string','synthetic_signin_failed')
    entry.token=signed.data.access_token;return entry
  }
  async function ownRows(entry) {
    const r=await request(`/rest/v1/focus_ai_requests?select=id,request_id,lease_id,state,user_id,response,fingerprint,actual_usd,reserved_usd&user_id=eq.${entry.id}&limit=100`)
    check(r.ok && Array.isArray(r.data),'synthetic_ledger_read_failed')
    check(r.data.length<100 && r.data.every(row=>row.user_id===entry.id),'synthetic_ledger_scope_failed');return r.data
  }
  async function cleanup() {
    for(const entry of created) {
      try {
        const owned=await request(`/auth/v1/admin/users/${entry.id}`),user=owned.data?.user || owned.data
        check(owned.ok && user?.id===entry.id && user.email===entry.email && user.user_metadata?.focus_ai_remote_check_run===runId,'cleanup_ownership_unconfirmed')
        let rows=await ownRows(entry)
        if(entry.kind==='db') {
          // This account never invokes a provider: even lost admission responses
          // can safely be finalized at zero. Never do this for the chat account.
          for(const row of rows.filter(row=>row.state==='in_progress'))check((await rpc('focus_ai_finish',finishArgs(entry.id,row.request_id,row.lease_id))).status==='completed','cleanup_db_finish_failed')
          rows=await ownRows(entry)
        }
        const removed=await request(`/auth/v1/admin/users/${entry.id}`,{method:'DELETE',body:{should_soft_delete:false}})
        check(removed.ok,'synthetic_user_delete_failed');report.cleanup.deleted++
        for(const previous of rows) {
          const r=await request(`/rest/v1/focus_ai_requests?select=id,request_id,user_id,response,fingerprint,actual_usd,reserved_usd&id=eq.${previous.id}`),row=r.data?.[0]
          check(r.ok && r.data.length===1 && row.user_id===null && row.response===null && row.fingerprint==='' && row.request_id===row.id
            && Number(row.actual_usd ?? row.reserved_usd)===Number(previous.actual_usd ?? previous.reserved_usd),'anonymous_cost_verification_failed')
        }
        report.cleanup.verified++;report.cleanup.pendingSyntheticUserIds=report.cleanup.pendingSyntheticUserIds.filter(id=>id!==entry.id);checkpoint()
      } catch(error){report.cleanup.errorCodes=[...(report.cleanup.errorCodes || []),error instanceof CheckError?error.code:'cleanup_failed'];checkpoint()}
    }
  }
  try {
    if(options.chat) {
      let response,capabilities
      try {
        response=await fetchImpl(options.baseURL+'/api/ai-capabilities',{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)})
        const text=await response.text();check(text.length<=10000,'capabilities_too_large');capabilities=JSON.parse(text)
      } catch {throw new CheckError('deployment_capabilities_unavailable')}
      check(response.ok && capabilities.runtime==='focus-openai-v1' && capabilities.chat_provider==='openai','deployment_runtime_not_openai')
      pass('Unauthenticated deployment capability confirms OpenAI before account writes or paid chat')
    }
    const absent=randomUUID(),lease=randomUUID(),id=randomUUID()
    const control=await rpc('focus_ai_get_control',{})
    check(control.status==='ok' && control.paid_enabled===true,'database_paid_calls_disabled')
    const metrics=await rpc('focus_ai_model_metrics',{p_policy:policy})
    check(metrics.status==='ok' && metrics.model_metrics && Array.isArray(metrics.tiers),'migration_022_missing')
    const probeArgs=[['focus_ai_admit',args(null,id)],['focus_ai_begin_attempt',attemptArgs(absent,id,lease)],
      ['focus_ai_settle_attempt',{p_user_id:absent,p_request_id:id,p_lease_id:lease,p_attempt_index:0,p_actual_usd:0,p_outcome:'failed'}],['focus_ai_finish',finishArgs(absent,id,lease)]]
    const probes=await Promise.all(probeArgs.map(([name,args])=>rpc(name,args)))
    check(probes.every(r=>r.status==='unavailable'),'preflight_rpc_contract_failed')
    const auth=await request('/auth/v1/settings',{key:config.anonKey,token:config.anonKey});check(auth.ok,'anonymous_key_preflight_failed')
    pass('Read-only auth and migration 022 preflight before writes')
    const user=await createSynthetic('db')
    pass('Admin-created synthetic account and session; no email or billing change')
    const sameId=randomUUID(),sameArgs=args(user.id,sameId)
    const same=await Promise.all(Array.from({length:8},()=>rpc('focus_ai_admit',sameArgs)))
    check(same.filter(r=>r.status==='admitted').length===1 && same.filter(r=>r.status==='in_progress').length===7,'same_id_contention_failed')
    const admitted=same.find(r=>r.status==='admitted');check(uuid(admitted.lease_id),'invalid_admission_lease')
    check((await rpc('focus_ai_finish',finishArgs(user.id,sameId,admitted.lease_id))).status==='completed','first_finish_failed')
    const replay=await rpc('focus_ai_admit',sameArgs)
    check(replay.status==='replay' && replay.lease_id===admitted.lease_id && replay.response?.body?.reply==='Synthetic plan only','db_replay_failed')
    pass('Eight simultaneous identical IDs produce one lease and durable replay')
    const ids=Array.from({length:6},()=>randomUUID()),distinct=await Promise.all(ids.map(id=>rpc('focus_ai_admit',args(user.id,id))))
    check(distinct.filter(r=>r.status==='admitted').length===1 && distinct.filter(r=>r.status==='concurrency').length===5,'distinct_id_contention_failed')
    const winner=distinct.findIndex(r=>r.status==='admitted')
    check((await rpc('focus_ai_finish',finishArgs(user.id,ids[winner],distinct[winner].lease_id))).status==='completed','distinct_finish_failed')
    pass('Six simultaneous distinct IDs enforce one active request per user')
    for(const [name,overrides,status] of [
      ['quota',{p_limits:{daily:1}},'quota'],['rate',{p_policy:{...policy,requests_per_minute:1}},'rate'],
      // Tighten only the synthetic user's cap: do not generate fake global alerts.
      ['budget',{p_policy:{...policy,user_daily_budget_usd:.0005}},'budget'],
    ])check((await rpc('focus_ai_admit',args(user.id,randomUUID(),overrides))).status===status,name+'_denial_failed')
    pass('Tightened quota, rate and user budget reject before reservation')
    const solId=randomUUID(),sol=await rpc('focus_ai_admit',args(user.id,solId));check(sol.status==='admitted','sol_fixture_admission_failed')
    check((await rpc('focus_ai_begin_attempt',attemptArgs(user.id,solId,sol.lease_id))).status==='model_budget','sol_disabled_guard_failed')
    check((await rpc('focus_ai_finish',finishArgs(user.id,solId,sol.lease_id))).status==='completed','sol_fixture_finish_failed')
    const rows=await ownRows(user);check(rows.length===3 && rows.every(row=>Number(row.actual_usd)===0),'synthetic_db_cost_not_zero')
    pass('Disabled Sol never starts; database-only fixtures finish at zero cost')
    for(const role of ['anon','authenticated']) {
      const token=role==='anon'?config.anonKey:user.token
      for(const table of PRIVATE_TABLES) {
        const denied=await request(`/rest/v1/${table}?select=*&limit=0`,{key:config.anonKey,token})
        check([401,403].includes(denied.status),'private_ledger_accessible_'+role)
      }
      for(const [name,body] of [...probeArgs,['focus_ai_get_control',{}],['focus_ai_set_control',{p_paid_enabled:null}],['focus_ai_model_metrics',{p_policy:policy}]]) {
        const denied=await request('/rest/v1/rpc/'+name,{method:'POST',key:config.anonKey,token,body})
        check([401,403].includes(denied.status),'private_rpc_accessible_'+role)
      }
    }
    pass('Anon/authenticated roles cannot read private ledgers or execute model RPC')
    if(options.chat) {
      const chatUser=await createSynthetic('chat'),chatId=randomUUID()
      const body={message:'Crea una tarea: comprar pan',events:[],tasks:[],history:[],userMemories:[],memories:[],clientNow:Date.now(),clientTimezone:'America/Santiago'}
      async function chat() {
        let res,data
        try {
          res=await fetchImpl(options.baseURL+'/api/focus-assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${chatUser.token}`,'X-Request-Id':chatId},
            body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(65000)})
          const text=await res.text();check(text.length<=1000000,'chat_response_too_large');data=JSON.parse(text)
        } catch {throw new CheckError('chat_response_uncertain_no_retry')}
        check(res.ok && data.requestId===chatId && Array.isArray(data.actions),'chat_not_successful');return data
      }
      const first=await chat(),repeated=await chat()
      check(isDeepStrictEqual(first,repeated),'http_replay_changed')
      check(first.actions.some(a=>a.type==='add_task' && /comprar pan/i.test(a.task?.label || a.title || a.label || '')),'chat_task_plan_missing')
      const rows=await ownRows(chatUser)
      check(rows.length===1 && rows[0].request_id===chatId && rows[0].state==='completed','chat_lease_count_failed')
      const attempts=await request(`/rest/v1/focus_ai_model_attempts?select=model,state,actual_usd&request_row_id=eq.${rows[0].id}`)
      const events=await request(`/rest/v1/ai_usage_events?select=id,metadata&user_id=eq.${chatUser.id}&metadata->>request_id=eq.${chatId}`)
      check(attempts.ok && attempts.data?.length===1 && attempts.data[0].state==='settled','chat_attempt_count_failed')
      check(events.ok && events.data?.length===1 && events.data[0].metadata?.admission_lease_id===rows[0].lease_id,'chat_telemetry_count_failed')
      // actual_usd is the authoritative ledger charge, but unknown provider
      // usage is intentionally settled at the reservation. Its name alone
      // does not prove that the amount came from observed token usage.
      const recordedCost=rows[0].actual_usd!=null && Number.isFinite(Number(rows[0].actual_usd))?Number(rows[0].actual_usd):null
      const attemptCost=attempts.data[0].actual_usd==null?null:Number(attempts.data[0].actual_usd)
      const providerUsage=recordedCost!=null && Number.isFinite(attemptCost) && Math.abs(recordedCost-attemptCost)<=1e-9
        && events.data[0].metadata?.cost_basis==='provider_usage'
      report.chat={...report.chat,status:'passed',providerAttempts:1,telemetryRows:1,leases:1,costUSD:providerUsage?recordedCost:null,recordedCostUSD:recordedCost,
        reservedUSD:Number(rows[0].reserved_usd),costBasis:providerUsage?'provider_usage':recordedCost==null?'reservation_unknown_actual':'conservative_reservation',taskPersisted:false}
      pass('One task plan and identical HTTP replay produce one attempt and telemetry row; no task persistence claimed')
    }
    report.status='passed';report.remoteVerified=true
  } catch(error){report.status='failed';report.errorCode=error instanceof CheckError?error.code:'unexpected_remote_check_failure'}
  finally {
    await cleanup()
    if(report.cleanup.pendingSyntheticUserIds.length || report.cleanup.errorCodes?.length){report.status='failed';report.remoteVerified=false}
    else if(created.length)pass('Only run-owned accounts hard-deleted; replay scrubbed and anonymous costs retained')
    report.finishedAt=new Date().toISOString();checkpoint()
  }
  return report
}
export async function main(argv=process.argv.slice(2)) {
  try {
    const options=parseRemoteOptions(argv)
    if(options.help){console.log('Usage: node scripts/ai-remote-check.mjs [--live-db] [--chat] [--base-url https://www.usefocus.me] [--report /tmp/check.json]\nDefault: offline inventory. Live needs exact Supabase URL, service-role and anon keys. --chat permits one logical paid request plus replay; no task is saved.');return}
    const report=await runRemoteCheck(options);console.log(JSON.stringify(report,null,2));if(report.status==='failed')process.exitCode=1
  } catch(error){console.error(JSON.stringify({status:'not_executed',errorCode:error instanceof CheckError?error.code:'configuration_failed'}));process.exitCode=1}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()

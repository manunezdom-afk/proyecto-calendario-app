#!/usr/bin/env node
// Offline by default. Live uses only synthetic accounts against an operator-
// verified Focus deployment whose per-request server cap is at most US$0.25.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, mkdtempSync, rmSync, statSync, renameSync, unlinkSync } from 'node:fs'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv, promisify, isDeepStrictEqual } from 'node:util'
import { execFile } from 'node:child_process'
import { allowedChatOrigin, remoteConfiguration, remoteTransport } from './ai-remote-check.mjs'
import { benchmarkSourceHashes, evaluateBenchmarkOutput, verifyBenchmarkReplay, summarizeBenchmarkCosts } from './ai-router-benchmark.mjs'
import { createGrader } from './ai-benchmark-grade.mjs'
import { buildDateContext } from '../api/_lib/dateContext.js'
import { selectNovaRoutes } from '../api/_lib/novaRuntime.js'
import { sanitizeNovaRequest } from '../api/_lib/novaSafety.js'
import { summarizeAIMetrics } from './ai-metrics.mjs'

const root=fileURLToPath(new URL('../',import.meta.url)), MAX_REQUEST_USD=.25
const exec=promisify(execFile)
class BenchError extends Error { constructor(code){super(code);this.code=code} }
const check=(ok,code)=>{if(!ok)throw new BenchError(code)}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const valueNumber=value=>value!=null && Number.isFinite(Number(value)) && Number(value)>=0?Number(value):null
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]:null

// A failed write (including ENOSPC) must leave the last recovery checkpoint
// intact. Rename only after the complete private snapshot has been written.
export function writeAtomicBenchmarkReport(path,report,{write=writeFileSync,rename=renameSync,remove=unlinkSync}={}) {
  mkdirSync(dirname(path),{recursive:true})
  const temporary=path+'.'+randomUUID()+'.tmp'
  try {write(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});rename(temporary,path)}
  finally {try{remove(temporary)}catch(error){if(error.code!=='ENOENT')throw error}}
}

export function parseRemoteBenchmarkOptions(args=[]) {
  const out={live:false,vercelCLI:false,baseURL:null,limit:100,budget:1,users:12,httpIntervalMs:2500,reportPath:null,envFile:null,now:'2026-09-08T15:00:00.000Z'}
  const values={'--base-url':'baseURL','--limit':'limit','--budget':'budget','--users':'users','--report':'reportPath','--env-file':'envFile','--now':'now','--http-interval-ms':'httpIntervalMs'}
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--live')out.live=true
    else if(args[i]==='--vercel-cli')out.vercelCLI=true
    else {const key=values[args[i]];check(key && args[i+1] && !args[i+1].startsWith('--'),'invalid_option');out[key]=args[++i]}
  }
  for(const key of ['limit','users','budget','httpIntervalMs'])out[key]=Number(out[key])
  if(!args.includes('--users'))out.users=Math.ceil(out.limit/9)
  check(Number.isInteger(out.limit)&&out.limit>=1&&out.limit<=211,'invalid_limit')
  check(Number.isInteger(out.users)&&out.users>=1&&out.users<=24&&out.limit<=out.users*9,'invalid_users')
  check(out.budget>=MAX_REQUEST_USD&&out.budget<=1,'invalid_budget')
  check(Number.isInteger(out.httpIntervalMs)&&out.httpIntervalMs>=2500&&out.httpIntervalMs<=10000,'invalid_http_interval')
  check(Number.isFinite(Date.parse(out.now)),'invalid_clock')
  if(out.baseURL) {out.baseURL=allowedChatOrigin(out.baseURL);check(out.baseURL,'deployment_not_allowed')}
  check(!out.live || out.baseURL,'explicit_deployment_required')
  return out
}

export function mayStartRemoteRequest(recordedCost,budget) {
  return valueNumber(recordedCost)!==null && budget<=1 && recordedCost+MAX_REQUEST_USD<=budget+1e-9
}

// Availability is an observed failed case, not an idempotency breach. Continue
// to a DIFFERENT corpus case only when SQL proves the original request is still
// completed, every paid attempt is unchanged/settled and accounting is stable.
// No replay retry, new UUID for the same case, or relaxed semantic grader.
export function settledReplayUnavailable(output,replay,before,after,attemptsBefore,attemptsAfter) {
  return output.httpStatus===200 && replay.httpStatus===503
    && replay.body?.error==='assistant_unavailable' && replay.body?.requestId===output.body?.requestId
    && before?.state==='completed' && after?.state==='completed'
    && ['id','user_id','request_id','lease_id','actual_usd','reserved_usd'].every(key=>before[key]===after[key])
    && valueNumber(after.actual_usd)!==null && attemptsBefore.length>0
    && attemptsBefore.every(attempt=>attempt.state==='settled')
    && isDeepStrictEqual(attemptsBefore,attemptsAfter)
}

// curl's config and response files are private; credentials never enter argv,
// shell strings or console output. Vercel CLI supplies its own protection bypass.
export function vercelFocusFetch(origin,{execImpl=exec}={}) {
  check(allowedChatOrigin(origin)===origin,'deployment_not_allowed')
  return async(url,options={})=>{
    const parsed=new URL(url)
    check(parsed.origin===origin && ['/api/ai-capabilities','/api/focus-assistant'].includes(parsed.pathname)
      && !parsed.search && !parsed.hash,'focus_request_not_allowed')
    const directory=mkdtempSync(join(tmpdir(),'focus-bench-curl-'));chmodSync(directory,0o700)
    const config=join(directory,'curl.conf'),output=join(directory,'response.json'),body=join(directory,'body.json')
    const quoted=value=>JSON.stringify(String(value))
    try {
      writeFileSync(output,'',{mode:0o600})
      const lines=[`request = ${quoted(options.method||'GET')}`,`output = ${quoted(output)}`,
        'write-out = "%{http_code}"','silent','show-error','max-time = 65','connect-timeout = 15','max-redirs = 0','max-filesize = 1000000']
      for(const [key,value] of Object.entries(options.headers||{})) {check(!/[\r\n]/.test(key+value),'invalid_header');lines.push(`header = ${quoted(`${key}: ${value}`)}`)}
      if(options.body!==undefined){writeFileSync(body,String(options.body),{mode:0o600});lines.push(`data-binary = ${quoted('@'+body)}`)}
      writeFileSync(config,lines.join('\n')+'\n',{mode:0o600})
      const result=await execImpl('vercel',['curl',parsed.pathname,'--deployment',origin,'--','--config',config],{timeout:70000,maxBuffer:1000000})
      const status=String(result.stdout).trim();check(/^\d{3}$/.test(status),'vercel_status_unavailable')
      check(statSync(output).size<=1000000,'focus_response_too_large')
      return new Response(readFileSync(output),{status:Number(status)})
    } catch(error){throw new BenchError(error instanceof BenchError?error.code:'vercel_transport_uncertain')}
    finally{rmSync(directory,{recursive:true,force:true})}
  }
}

export async function runRemoteBenchmark(options,{env=process.env,fetchImpl=fetch,focusFetch=null,sleep=wait,writeReport=true,writeSnapshot=writeAtomicBenchmarkReport,cases=null,onProgress=()=>{}}={}) {
  const source=cases||JSON.parse(readFileSync(resolve(root,'tests/nova-battery/cases.json'))).cases
  const groups=[...new Set(source.map(c=>c.cat))].map(cat=>source.filter(c=>c.cat===cat)),selected=[]
  for(let i=0;groups.some(g=>g[i]);i++)for(const group of groups)if(group[i])selected.push(group[i])
  selected.splice(options.limit)
  const runId=randomUUID(),reportPath=resolve(options.reportPath||join(tmpdir(),`focus-ai-remote-benchmark-${runId}.json`))
  const report={version:1,mode:options.live?'remote-http-real-sql':'offline-remote-inventory',status:'not_executed',runId,reportPath,
    deployment:options.baseURL,transport:options.live?(options.vercelCLI?'vercel_cli':'direct_https'):null,httpIntervalMs:options.httpIntervalMs,
    budgetUSD:options.budget,requestReservationBoundUSD:MAX_REQUEST_USD,
    boundEvidence:'Operator must verify this deployment enforces at most US$0.25 per logical request; no global budget or quota is changed by this runner.',
    fixedNow:options.now,sourceHashes:benchmarkSourceHashes(root),
    runnerSourceHashes:Object.fromEntries(['scripts/ai-remote-benchmark.mjs','scripts/ai-remote-check.mjs','api/focus-assistant.js','api/_lib/aiCapabilities.js','vercel.json'].map(path=>[path,createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')])),
    caseCorpusHash:createHash('sha256').update(JSON.stringify(source)).digest('hex'),localExpectedSQLHashes:Object.fromEntries(Object.entries(benchmarkSourceHashes(root,['020_atomic_ai_usage.sql','021_ai_admission.sql','022_openai_model_admission.sql'])).filter(([path])=>path.startsWith('supabase/'))),
    measurementScope:'Remote Focus HTTP and existing remote SQL ledgers; synthetic accounts and fixture context only. Local SQL hashes are expected sources, not proof of remote bytes. No client persistence or human conversation quality is measured.',
    selectedCases:selected.map(c=>c.id),plannedUsers:options.users,rows:[],cleanup:{pendingSyntheticUserIds:[],deleted:0,verified:0},summary:null}
  const telemetry=[],created=[];let lastHTTP=0,recordedCost=0,anonymizedCost=0
  function checkpoint(required=true) {
    const rows=report.rows,attempted=rows.filter(r=>r.attempted),latencies=attempted.filter(r=>r.httpStatus===200).map(r=>r.latencyMs)
    report.summary={selected:selected.length,attempted:attempted.length,objectivePass:attempted.filter(r=>r.verdict?.pass).length,
      objectivePassRate:attempted.length?attempted.filter(r=>r.verdict?.pass).length/attempted.length:null,
      ...summarizeBenchmarkCosts(rows,telemetry),recordedRunChargeUSD:options.live?recordedCost:null,latencyPopulation:'successful_http_200',p50Ms:percentile(latencies,.5),p95Ms:percentile(latencies,.95),
      replayChecks:rows.filter(r=>r.replayVerified).length,replayAvailabilityFailures:rows.filter(r=>r.replayAvailabilityFailure).length,
      providerAttempts:rows.reduce((n,r)=>n+r.attempts.length,0),humanConversationScore:null,metrics:summarizeAIMetrics(telemetry)}
    if(writeReport)try {writeSnapshot(reportPath,report)}catch {
      report.checkpointWriteFailed=true
      if(required)throw new BenchError('checkpoint_write_failed')
    }
  }
  checkpoint();if(!options.live)return report
  const config=remoteConfiguration(env),request=remoteTransport(config,fetchImpl)
  check(allowedChatOrigin(options.baseURL)===options.baseURL,'deployment_not_allowed')
  const focus=focusFetch||(options.vercelCLI?vercelFocusFetch(options.baseURL):fetchImpl)
  async function http(path,{method='GET',body,token}={}) {
    const remaining=(options.httpIntervalMs??2500)-(Date.now()-lastHTTP);if(remaining>0)await sleep(remaining)
    lastHTTP=Date.now()
    const headers={'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}
    if(env.FOCUS_VERCEL_BYPASS)headers['x-vercel-protection-bypass']=env.FOCUS_VERCEL_BYPASS
    if(body?.requestId)headers['X-Request-Id']=body.requestId
    let response,data;const started=Date.now()
    try {
      response=await focus(options.baseURL+path,{method,headers,...(body?{body:JSON.stringify(body.payload)}:{}),redirect:'error',signal:AbortSignal.timeout(65000)})
      const text=await response.text();check(text.length<=1000000,'focus_response_too_large');data=JSON.parse(text)
    } catch {throw new BenchError('focus_response_uncertain_no_retry')}
    return {httpStatus:response.status,body:data,latencyMs:Date.now()-started}
  }
  async function ownedLedger() {
    if(!created.length)return []
    const ids=created.map(c=>c.id),r=await request(`/rest/v1/focus_ai_requests?select=id,user_id,request_id,lease_id,state,actual_usd,reserved_usd&user_id=in.(${ids.join(',')})&limit=500`)
    check(r.ok&&Array.isArray(r.data)&&r.data.length<500&&r.data.every(row=>ids.includes(row.user_id)),'scoped_ledger_unavailable')
    const amounts=r.data.map(row=>valueNumber(row.actual_usd??row.reserved_usd));check(amounts.every(v=>v!==null),'ledger_cost_unknown')
    recordedCost=anonymizedCost+amounts.reduce((sum,v)=>sum+v,0);return r.data
  }
  async function evidence(ledger) {
    if(!ledger.length)return {attempts:[],events:[]}
    const rowIds=ledger.map(r=>r.id),users=created.map(c=>c.id)
    const [a,t]=await Promise.all([
      request(`/rest/v1/focus_ai_model_attempts?select=*&request_row_id=in.(${rowIds.join(',')})&limit=1000`),
      request(`/rest/v1/ai_usage_events?select=*&user_id=in.(${users.join(',')})&limit=1000`),
    ])
    check(a.ok&&t.ok&&Array.isArray(a.data)&&Array.isArray(t.data)&&a.data.length<1000&&t.data.length<1000
      &&a.data.every(row=>rowIds.includes(row.request_row_id))&&t.data.every(row=>users.includes(row.user_id)),'scoped_attempt_evidence_unavailable')
    telemetry.splice(0,telemetry.length,...t.data);return {attempts:a.data,events:t.data}
  }
  try {
    report.status='running';checkpoint()
    const capability=await http('/api/ai-capabilities')
    check(capability.httpStatus===200&&capability.body.runtime==='focus-openai-v1'&&capability.body.chat_provider==='openai','deployment_runtime_not_openai')
    const control=await request('/rest/v1/rpc/focus_ai_get_control',{method:'POST',body:{}})
    check(control.ok&&control.data?.status==='ok'&&control.data.paid_enabled===true,'remote_paid_control_closed')
    for(let i=0;i<options.users;i++) {
      const id=randomUUID(),email=`focus-bench-${runId}-${i}@example.invalid`,password=randomBytes(36).toString('base64url')
      const entry={id,email,count:0,premium:0,creationRequested:false};created.push(entry);report.cleanup.pendingSyntheticUserIds.push(id);checkpoint()
      entry.creationRequested=true
      const made=await request('/auth/v1/admin/users',{method:'POST',body:{id,email,password,email_confirm:true,user_metadata:{focus_ai_benchmark_run:runId}}})
      check(made.ok&&(made.data?.id||made.data?.user?.id)===id,'synthetic_create_failed')
      const signed=await request('/auth/v1/token?grant_type=password',{method:'POST',key:config.anonKey,token:config.anonKey,body:{email,password}})
      check(signed.ok&&signed.data?.user?.id===id&&typeof signed.data.access_token==='string','synthetic_signin_failed');entry.token=signed.data.access_token
    }
    const dateContext=buildDateContext(Date.parse(options.now),'America/Santiago'),{evaluate,resolveDateToken}=createGrader(dateContext)
    for(const c of selected) {
      await ownedLedger()
      if(!mayStartRemoteRequest(recordedCost,options.budget)){report.stopped='run_budget_reservation_cap';break}
      const payload={message:c.input,clientNow:Date.parse(options.now),clientTimezone:'America/Santiago',events:(c.events||[]).map(e=>({...e,date:resolveDateToken(e.date)||e.date})),
        tasks:c.tasks||[],history:c.history||[],userMemories:(c.memories||[]).map(m=>typeof m==='string'?m:m.content||''),discussedEventIds:c.discussed||[]}
      const sanitized=sanitizeNovaRequest(payload);check(!sanitized.error,'invalid_synthetic_case')
      const routes=selectNovaRoutes(sanitized.body),premium=routes[0].tier!=='luna'
      const user=created.filter(u=>u.count<9).sort((a,b)=>(premium?a.premium-b.premium:0)||a.count-b.count)[0]
      check(user,'synthetic_capacity_exhausted');user.count++;if(premium)user.premium++
      const requestId=randomUUID(),row={id:c.id,category:c.cat,input:c.input,expect:c.expect,attempted:true,requestId,attempts:[],routes}
      report.rows.push(row);checkpoint()
      const {latencyMs,...output}=await http('/api/focus-assistant',{method:'POST',body:{requestId,payload},token:user.token})
      row.latencyMs=latencyMs;row.httpStatus=output.httpStatus;row.output=output.body
      row.verdict=evaluateBenchmarkOutput(c,output,evaluate)
      check(output.httpStatus===200||output.body.request_completed===true?output.body.requestId===requestId:!output.body.requestId||output.body.requestId===requestId,'response_identity_mismatch')
      let ledger=await ownedLedger(),observed=await evidence(ledger),requestRow=ledger.find(r=>r.user_id===user.id&&r.request_id===requestId)
      row.attempts=observed.attempts.filter(a=>a.request_row_id===requestRow?.id)
      if(output.httpStatus===200||output.body.request_completed===true) {
        check(output.httpStatus===200 ? requestRow?.state==='completed' : ['completed','failed'].includes(requestRow?.state),'durable_request_missing')
        const attemptsBefore=structuredClone(row.attempts),count=row.attempts.length,
          {latencyMs:replayLatencyMs,...replay}=await http('/api/focus-assistant',{method:'POST',body:{requestId,payload},token:user.token})
        row.replayObservation={...replay,latencyMs:replayLatencyMs}
        ledger=await ownedLedger();observed=await evidence(ledger)
        row.attempts=observed.attempts.filter(a=>a.request_row_id===requestRow.id)
        row.replayVerified=verifyBenchmarkReplay(output,replay,count,row.attempts.length)
        if(!row.replayVerified){
          row.verdict={pass:false,fails:[...(row.verdict.fails||[]),'replay_mismatch']}
          const after=ledger.find(r=>r.id===requestRow.id)
          if(settledReplayUnavailable(output,replay,requestRow,after,attemptsBefore,row.attempts)) {
            row.replayAvailabilityFailure={httpStatus:503,originalStillCompleted:true,attemptsUnchanged:true,
              accountingUnchanged:true,retryPerformed:false,caseStillFailed:true}
          } else throw new BenchError('replay_mismatch')
        }
      }
      checkpoint()
      onProgress({phase:'case',caseId:c.id,httpStatus:row.httpStatus,objectivePass:row.verdict.pass,latencyMs:row.latencyMs,
        providerAttempts:row.attempts.length,recordedRunChargeUSD:recordedCost})
      if(output.httpStatus!==200 && output.body.request_completed!==true){report.stopped='non_successful_http';break}
    }
    report.status=report.rows.length===selected.length&&!report.stopped?'completed':'stopped'
  } catch(error){report.status='failed';report.errorCode=error instanceof BenchError?error.code:'remote_benchmark_failed'}
  finally {
    // Recover evidence after an ambiguous HTTP response before deleting accounts.
    try {
      const ledger=await ownedLedger(),observed=await evidence(ledger)
      for(const row of report.rows){const requestRow=ledger.find(r=>r.request_id===row.requestId);row.attempts=observed.attempts.filter(a=>a.request_row_id===requestRow?.id)}
    } catch {report.evidenceIncomplete=true}
    // Never finalize unknown paid requests at zero. Deletion keeps their
    // conservative charge and scrubs replay through the real SQL trigger.
    for(const user of created)try {
      if(!user.creationRequested){report.cleanup.pendingSyntheticUserIds=report.cleanup.pendingSyntheticUserIds.filter(id=>id!==user.id);continue}
      const owned=await request(`/auth/v1/admin/users/${user.id}`),details=owned.data?.user||owned.data
      check(owned.ok&&details?.id===user.id&&details.email===user.email&&details.user_metadata?.focus_ai_benchmark_run===runId,'cleanup_ownership_unconfirmed')
      const ledger=await ownedLedger(),rows=ledger.filter(r=>r.user_id===user.id)
      const deleted=await request(`/auth/v1/admin/users/${user.id}`,{method:'DELETE',body:{should_soft_delete:false}});check(deleted.ok,'cleanup_delete_failed');report.cleanup.deleted++
      anonymizedCost+=rows.reduce((sum,row)=>sum+Number(row.actual_usd??row.reserved_usd),0)
      for(const row of rows) {
        const verified=await request(`/rest/v1/focus_ai_requests?select=id,user_id,request_id,response,fingerprint,actual_usd,reserved_usd&id=eq.${row.id}`),after=verified.data?.[0]
        check(verified.ok&&verified.data.length===1&&after.user_id===null&&after.response===null&&after.fingerprint===''&&after.request_id===after.id
          &&Number(after.actual_usd??after.reserved_usd)===Number(row.actual_usd??row.reserved_usd),'cleanup_anonymous_charge_failed')
      }
      report.cleanup.verified++;report.cleanup.pendingSyntheticUserIds=report.cleanup.pendingSyntheticUserIds.filter(id=>id!==user.id);checkpoint(false)
    }catch(error){report.cleanup.errorCodes=[...(report.cleanup.errorCodes||[]),error instanceof BenchError?error.code:'cleanup_failed'];checkpoint(false)}
    if(report.cleanup.pendingSyntheticUserIds.length){report.status='failed'}
    report.finishedAt=new Date().toISOString();checkpoint(false)
    if(report.checkpointWriteFailed){report.status='failed';report.errorCode||='checkpoint_write_failed';checkpoint(false)}
  }
  return report
}

export async function main(args=process.argv.slice(2)) {
  try {
    const options=parseRemoteBenchmarkOptions(args),env={...process.env}
    if(options.envFile){const path=resolve(options.envFile);check((statSync(path).mode&0o077)===0,'env_file_not_private');const parsed=parseEnv(readFileSync(path,'utf8'))
      for(const key of ['SUPABASE_URL','VITE_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','VITE_SUPABASE_ANON_KEY','FOCUS_VERCEL_BYPASS'])if(parsed[key])env[key]=parsed[key]}
    const report=await runRemoteBenchmark(options,{env,onProgress:progress=>console.log(JSON.stringify(progress))});console.log(JSON.stringify({status:report.status,reportPath:report.reportPath,errorCode:report.errorCode,stopped:report.stopped,summary:report.summary,cleanup:report.cleanup},null,2))
    if(report.status==='failed')process.exitCode=1
  }catch(error){console.error(JSON.stringify({status:'not_executed',errorCode:error instanceof BenchError?error.code:'configuration_failed'}));process.exitCode=1}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()

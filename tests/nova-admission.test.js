import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  admissionPolicy, budgetAlertPercentages, quotaLimits, reserveAttemptCost, reserveRequestCost,
  admissionRPC, admitNovaRequest, beginNovaAttempt, settleNovaAttempt, finishNovaRequest, novaModelMetrics, novaPaidControl, setNovaPaidControl,
} from '../api/_lib/novaAdmission.js'

const envKeys = ['AI_PAID_CALLS_ENABLED','AI_USER_REQUESTS_PER_MINUTE','AI_DAILY_BUDGET_USD','AI_MONTHLY_BUDGET_USD',
  'AI_USER_DAILY_BUDGET_USD','AI_USER_MONTHLY_BUDGET_USD','AI_MAX_COST_PER_REQUEST_USD','AI_SOL_DAILY_BUDGET_USD',
  'AI_SOL_MONTHLY_BUDGET_USD','AI_SOL_USER_DAILY_REQUESTS','AI_SOL_USER_MONTHLY_REQUESTS','AI_SOL_ENABLED',
  'AI_ECONOMY_BUDGET_PERCENT','AI_BUDGET_ALERT_PERCENTAGES','AI_SOL_SHARE_ALERT_PERCENT','AI_SOL_SHARE_MIN_REQUESTS']
function environment(values = {}) {
  const previous = Object.fromEntries(envKeys.map(key => [key,process.env[key]]))
  envKeys.forEach(key => delete process.env[key]); Object.assign(process.env,values)
  return () => envKeys.forEach(key => previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key])
}
const route = (tier='luna') => ({ provider:'openai',model:`gpt-5.6-${tier}`,tier,inputTokens:12000,maxOutputTokens:1600,reason:'simple_create' })
const identity = {userId:'synthetic-owner',requestId:'synthetic-request',leaseId:'synthetic-lease'}
function database(result = {status:'admitted'}) {
  const calls=[]
  return { calls, async rpc(name,args) { calls.push({name,args});return {data:result,error:null} } }
}
const admit = admin => admitNovaRequest({admin,...identity,message:'  Comprar pan  ',actionType:'nova_message',plan:'free',reserveUSD:.03,modelAttemptsRequired:true})

test('default policy limits global month to 20 USD and Sol independently', () => {
  const restore=environment()
  try {
    const p=admissionPolicy()
    assert.equal(p.monthly_budget_usd,20);assert.equal(p.daily_budget_usd,5)
    assert.equal(p.user_daily_budget_usd,.25);assert.equal(p.user_monthly_budget_usd,5);assert.equal(p.request_budget_usd,.25)
    assert.equal(p.sol_daily_budget_usd,.5);assert.equal(p.sol_monthly_budget_usd,3)
    assert.equal(p.sol_user_daily_requests,2);assert.equal(p.sol_user_monthly_requests,10)
    assert.equal(p.economy_percent,90);assert.deepEqual(p.alert_percentages,[50,75,90])
  } finally { restore() }
})

test('alerts are configurable, sorted and deduplicated; malformed lists fail closed', async () => {
  const restore=environment({AI_BUDGET_ALERT_PERCENTAGES:'90,50,75,50'})
  try {
    assert.deepEqual(budgetAlertPercentages(),[50,75,90])
    for(const invalid of ['',',','0,50','50,101','50,NaN','20,30,40,50,60,70']) {
      process.env.AI_BUDGET_ALERT_PERCENTAGES=invalid
      const admin=database();assert.equal((await admit(admin)).reason,'invalid_alert_policy');assert.equal(admin.calls.length,0)
    }
  } finally { restore() }
})

test('zero or unknown Sol limits preserve base admission but remain closed in its policy', async () => {
  const restore=environment({AI_SOL_DAILY_BUDGET_USD:'0',AI_SOL_MONTHLY_BUDGET_USD:'unknown',AI_SOL_USER_DAILY_REQUESTS:'-1',AI_SOL_ENABLED:'false'})
  try {
    const admin=database();assert.equal((await admit(admin)).status,'admitted')
    const p=admin.calls[0].args.p_policy
    assert.equal(p.sol_daily_budget_usd,0);assert.equal(p.sol_monthly_budget_usd,0);assert.equal(p.sol_user_daily_requests,0);assert.equal(p.sol_enabled,false)
  } finally { restore() }
})

test('exhausted or malformed global and request budgets never reach admission RPC', async () => {
  const restore=environment()
  try {
    for(const key of ['AI_DAILY_BUDGET_USD','AI_MONTHLY_BUDGET_USD','AI_USER_DAILY_BUDGET_USD','AI_USER_MONTHLY_BUDGET_USD','AI_MAX_COST_PER_REQUEST_USD']) {
      for(const value of ['0','-1','Infinity','unknown']) {
        process.env[key]=value
        const admin=database();assert.equal((await admit(admin)).status,'budget');assert.equal(admin.calls.length,0)
      }
      delete process.env[key]
    }
  } finally { restore() }
})

test('admission fingerprints only exact trimmed message and passes durable model requirement', async () => {
  const restore=environment()
  try {
    const admin=database();await admit(admin)
    const {name,args}=admin.calls[0]
    assert.equal(name,'focus_ai_admit');assert.equal(args.p_policy.model_attempts_required,true)
    assert.equal(args.p_fingerprint,createHash('sha256').update('Comprar pan').digest('hex'))
    assert.doesNotMatch(JSON.stringify(args),/Comprar pan/)
    assert.deepEqual(quotaLimits('unknown-plan','unknown-action'),{})
  } finally { restore() }
})

test('reservations include maximum documented cache write price and all bounded attempts', () => {
  const restore=environment()
  try {
    assert.equal(reserveAttemptCost(route()),.005)
    assert.equal(reserveAttemptCost(route('terra')),.050)
    assert.equal(reserveRequestCost([route(),route('terra')]),.055)
    assert.throws(()=>reserveRequestCost([route(),route(),route()]),{code:'invalid_attempt_count'})
    assert.throws(()=>reserveRequestCost([]),{code:'invalid_attempt_count'})
    process.env.AI_MAX_COST_PER_REQUEST_USD='.01'
    assert.throws(()=>reserveRequestCost([route('terra')]),{code:'request_cost_limit'})
  } finally { restore() }
})

test('unknown pricing and invalid token bounds cannot yield a spendable reservation', () => {
  assert.throws(()=>reserveAttemptCost({...route(),model:'gpt-6-astra'}),{code:'pricing_unavailable'})
  assert.throws(()=>reserveAttemptCost({...route(),provider:'anthropic'}),{code:'pricing_unavailable'})
  for(const tokens of [0,-1,NaN,Infinity,1.5]) {
    assert.throws(()=>reserveAttemptCost(route(),tokens),{code:'invalid_token_reservation'})
    assert.throws(()=>reserveAttemptCost({...route(),maxOutputTokens:tokens}),{code:'invalid_token_reservation'})
  }
})

test('attempt authorization uses exact model, index and lease and excludes user text from reason', async () => {
  const restore=environment()
  try {
    const admin=database({status:'started'})
    assert.equal((await beginNovaAttempt({admin,...identity,attemptIndex:1,route:{...route('sol'),reason:'private user text'},reserveUSD:.1})).status,'started')
    assert.deepEqual(admin.calls[0],{name:'focus_ai_begin_attempt',args:{p_user_id:identity.userId,p_request_id:identity.requestId,
      p_lease_id:identity.leaseId,p_attempt_index:1,p_model:'gpt-5.6-sol',p_tier:'sol',p_reserve_usd:.1,p_policy:admissionPolicy(),p_reason:'unspecified'}})
    const invalid=await beginNovaAttempt({admin,...identity,attemptIndex:0,route:{...route(),model:'gpt-5.6-luna-20260908'}})
    assert.equal(invalid.reason,'invalid_model');assert.equal(admin.calls.length,1)
  } finally { restore() }
})

test('kill switch rejects both admission and attempt authorization before RPC', async () => {
  const restore=environment({AI_PAID_CALLS_ENABLED:'false'})
  try {
    const admin=database();assert.equal((await admit(admin)).reason,'paid_ai_disabled')
    assert.equal((await beginNovaAttempt({admin,...identity,attemptIndex:0,route:route()})).reason,'paid_ai_disabled')
    assert.equal(admin.calls.length,0)
  } finally { restore() }
})

test('RPC errors, missing functions and malformed responses are unavailable', async () => {
  for(const admin of [{},{rpc:async()=>{throw new Error('private connection detail')}},{rpc:async()=>({error:{message:'missing migration'}})},
    {rpc:async()=>({data:{}})},{rpc:async()=>({data:null})}]) assert.deepEqual(await admissionRPC(admin,'synthetic',{}),{status:'unavailable'})
  let signal
  const admin={rpc:()=>({abortSignal(value) {signal=value;return Promise.resolve({data:{status:'in_progress'}})}})}
  assert.equal((await admissionRPC(admin,'synthetic',{})).status,'in_progress');assert.ok(signal instanceof AbortSignal)
})

test('settlement retains unknown costs as null and passes failed outcome without coercion', async () => {
  const admin=database({status:'settled'})
  await settleNovaAttempt({admin,...identity,attemptIndex:0,outcome:'failed'})
  assert.equal(admin.calls[0].name,'focus_ai_settle_attempt');assert.equal(admin.calls[0].args.p_actual_usd,null);assert.equal(admin.calls[0].args.p_outcome,'failed')
  await finishNovaRequest({admin,...identity,response:{actions:[]},actualUSD:0,outcome:'success'})
  assert.equal(admin.calls[1].name,'focus_ai_finish');assert.equal(admin.calls[1].args.p_actual_usd,0)
})

test('new persisted budget alerts produce structured operational warnings and metrics use service RPC', async () => {
  const restore=environment();const logs=[];const original=console.warn
  console.warn=(...args)=>logs.push(args)
  try {
    const alert={id:'alert-id',scope:'global_monthly',period_start:'2026-09-01',threshold_percent:75,snapshot:{ratio:.76,rolling_month_days:30}}
    await admissionRPC(database({status:'admitted',budget_alerts:[alert]}),'focus_ai_admit',{})
    assert.equal(logs[0][0],'[ai_budget_alert]');assert.deepEqual(JSON.parse(logs[0][1]),alert)
    const admin=database({status:'ok'});await novaModelMetrics({admin})
    assert.equal(admin.calls[0].name,'focus_ai_model_metrics');assert.deepEqual(admin.calls[0].args,{p_policy:admissionPolicy()})
  } finally { console.warn=original;restore() }
})

test('operator database control uses service RPC without changing deployment flags',async()=>{
  const admin=database({status:'ok',paid_enabled:false}),previous=process.env.AI_PAID_CALLS_ENABLED
  await setNovaPaidControl({admin,enabled:false});await novaPaidControl({admin})
  assert.deepEqual(admin.calls,[{name:'focus_ai_set_control',args:{p_paid_enabled:false}},{name:'focus_ai_get_control',args:{}}])
  assert.equal(process.env.AI_PAID_CALLS_ENABLED,previous)
})

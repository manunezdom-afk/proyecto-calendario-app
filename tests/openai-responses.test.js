import test from 'node:test'
import assert from 'node:assert/strict'
import { callOpenAINova, buildOpenAISystemPrompt, extractResponsesText } from '../api/_lib/openaiNova.js'
import { getModelPricing, calculateAICost } from '../api/_lib/aiPricing.js'
const date='2026-09-08T15:00:00Z'
test('Responses uses exact models, strict schema, standard service and stable explicit cache prefix',async()=>{
 const saved=globalThis.fetch, requests=[]
 globalThis.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({status:'completed',output_text:'{}'})}}
 try {
  for(const todayISO of ['2026-09-08','2026-09-09']) await callOpenAINova({message:'hola',apiKey:'offline-test',model:'gpt-5.6-luna',
   systemPrompt:buildOpenAISystemPrompt({todayISO,memories:['PRIVATE_PERSON_CONTEXT']})})
  const a=requests[0],b=requests[1]
  assert.equal(a.model,'gpt-5.6-luna');assert.equal(a.reasoning.effort,'none');assert.equal(a.store,false)
  assert.equal(a.service_tier,'default');assert.equal(a.truncation,'disabled')
  assert.equal(a.text.format.type,'json_schema');assert.equal(a.text.format.strict,true)
  assert.deepEqual(a.prompt_cache_options,{mode:'explicit',ttl:'30m'})
  assert.deepEqual(a.input[0],b.input[0]);assert.equal(a.prompt_cache_key,b.prompt_cache_key)
  assert.doesNotMatch(a.input[0].content[0].text,/PRIVATE_PERSON_CONTEXT|2026-09-08/)
  assert.match(a.input[1].content,/PRIVATE_PERSON_CONTEXT/)
  assert.equal(a.input[0].content[0].prompt_cache_breakpoint.mode,'explicit')
  assert.equal(a.tools,undefined);assert.equal(a.previous_response_id,undefined)
 } finally {globalThis.fetch=saved}
})
test('unapproved model IDs and excessive reasoning never reach the network',async()=>{
 const saved=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++}
 try {
  for(const model of ['gpt-6-astra','gpt-5.6','gpt-5.6-sol-pro','claude-haiku-4-5','gpt-5.6-luna-20260908']) await assert.rejects(callOpenAINova({model,systemPrompt:'safe',message:'hola'}),/unsupported_model/)
  await assert.rejects(callOpenAINova({reasoningEffort:'max',systemPrompt:'safe',message:'hola'}),/unsupported_reasoning/)
  assert.equal(calls,0)
 } finally {globalThis.fetch=saved}
})
test('response body limits, truncation and refusal cannot expose partial actions',async()=>{
 const saved=globalThis.fetch
 globalThis.fetch=async()=>new Response('x'.repeat(256001),{status:200})
 try {await assert.rejects(callOpenAINova({systemPrompt:'safe',message:'hola',apiKey:'offline-test'}),/output_too_large/)}finally{globalThis.fetch=saved}
 assert.throws(()=>extractResponsesText({status:'incomplete',output_text:'{"actions":[]}'}),/incomplete_output/)
 assert.throws(()=>extractResponsesText({status:'completed',output_text:'{}',output:[{content:[{type:'refusal'}]}]}),/provider_refusal/)
})
test('all three tiers respect separate total output caps including reasoning',async()=>{
 const saved=globalThis.fetch,requests=[]
 globalThis.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({status:'completed',output_text:'{}'})}}
 try {
  for(const model of ['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol']) await callOpenAINova({model,systemPrompt:'safe',message:'hola',apiKey:'offline-test',maxOutputTokens:99999})
  assert.deepEqual(requests.map(r=>r.max_output_tokens),[2048,3072,4096])
  assert.deepEqual(requests.map(r=>r.reasoning.effort),['none','low','medium'])
 }finally{globalThis.fetch=saved}
})
test('Sol prices cover cached writes and long context; new admission stops before promotion expires',()=>{
 const current=getModelPricing('gpt-5.6-sol',{at:date,requireCurrent:true})
 assert.deepEqual([current.input,current.cachedInput,current.output,current.cacheWrite],[4,.4,20,5])
 assert.equal(getModelPricing('gpt-5.6-sol',{at:'2026-11-20T00:00:00Z',requireCurrent:true}),null)
 assert.equal(getModelPricing('gpt-5.6-sol',{at:'2026-11-19T23:59:59Z',requireCurrent:true}).stale,false)
 const long=getModelPricing('gpt-5.6-sol',{at:date,inputTokens:272001})
 assert.deepEqual([long.input,long.cachedInput,long.output,long.cacheWrite],[8,.8,30,10])
 assert.equal(calculateAICost({model:'gpt-5.6-sol',at:date,input_tokens:1000,cached_input_tokens:500,cache_creation_input_tokens:100,output_tokens:200}).cost_usd,.0063)
})

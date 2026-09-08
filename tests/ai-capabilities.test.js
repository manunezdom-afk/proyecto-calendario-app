import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/focus-assistant.js'
import { readFileSync, readdirSync } from 'node:fs'

async function invoke(method='GET') {
  const result={headers:{}}
  const response={setHeader(key,value){result.headers[key]=value},status(value){result.status=value;return this},json(value){result.body=value;return this},end(){return this}}
  await handler({method,headers:{},query:{capabilities:'1'}},response);return result
}
test('capability identifies OpenAI code without exposing credentials or claiming availability',async()=>{
  const result=await invoke()
  assert.equal(result.status,200)
  assert.deepEqual(result.body,{runtime:'focus-openai-v1',chat_provider:'openai'})
  assert.match(result.headers['Cache-Control'],/no-store/)
})
test('capability is read-only and supports CORS preflight',async()=>{
  assert.equal((await invoke('POST')).status,405);assert.equal((await invoke('OPTIONS')).status,200)
})

test('capability rewrite reuses a function within the existing hosting allowance',()=>{
  const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'))
  assert.deepEqual(config.rewrites[0],{source:'/api/ai-capabilities',destination:'/api/focus-assistant?capabilities=1'})
  const count=directory=>readdirSync(directory,{withFileTypes:true}).filter(entry=>!entry.name.startsWith('_')).reduce((sum,entry)=>sum+(entry.isDirectory()?count(new URL(entry.name+'/',directory)):/\.js$/.test(entry.name)?1:0),0)
  assert.ok(count(new URL('../api/',import.meta.url))<=12)
})

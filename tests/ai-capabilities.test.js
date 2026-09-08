import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/ai-capabilities.js'

function invoke(method='GET') {
  const result={headers:{}}
  const response={setHeader(key,value){result.headers[key]=value},status(value){result.status=value;return this},json(value){result.body=value;return this},end(){return this}}
  handler({method,headers:{}},response);return result
}
test('capability identifies OpenAI code without exposing credentials or claiming availability',()=>{
  const result=invoke()
  assert.equal(result.status,200)
  assert.deepEqual(result.body,{runtime:'focus-openai-v1',chat_provider:'openai'})
  assert.match(result.headers['Cache-Control'],/no-store/)
})
test('capability is read-only and supports CORS preflight',()=>{
  assert.equal(invoke('POST').status,405);assert.equal(invoke('OPTIONS').status,200)
})

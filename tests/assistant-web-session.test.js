import test from 'node:test'
import assert from 'node:assert/strict'
import { assistantSessionKey, readAssistantHistory, prepareLogicalRequest, clearLogicalRequest } from '../src/utils/assistantSession.js'

test('request identity survives reload without storing prompt text; account and logical goal changes get new IDs', async () => {
  const data = new Map()
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
  const first = await prepareLogicalRequest(storage, 'A', 'chat', 'Comprar pan')
  assert.equal((await prepareLogicalRequest(storage, 'A', 'chat', 'Comprar pan')).id, first.id)
  assert.ok(![...data.values()].some(value => value.includes('Comprar pan')))
  assert.notEqual((await prepareLogicalRequest(storage, 'B', 'chat', 'Comprar pan')).id, first.id)
  assert.notEqual((await prepareLogicalRequest(storage, 'A', 'chat', 'Comprar leche')).id, first.id)
  clearLogicalRequest(storage, 'A', 'chat')
  assert.notEqual((await prepareLogicalRequest(storage, 'A', 'chat', 'Comprar pan')).id, first.id)
  storage.setItem('nova_history', JSON.stringify([{ role: 'user', content: 'Legacy private A' }]))
  storage.setItem(assistantSessionKey('history', 'A'), JSON.stringify([{ role: 'user', content: 'Literal Nova en mi texto' }]))
  assert.deepEqual(readAssistantHistory(storage, 'B'), [])
  assert.equal(readAssistantHistory(storage, 'A')[0].content, 'Literal Nova en mi texto')
})

test('a blocked persistence write cannot authorize a new paid logical request', async () => {
  await assert.rejects(prepareLogicalRequest({ getItem: () => null, setItem() { throw new Error('disk full') } }, 'A', 'chat', 'Hola'), /disk full/)
})

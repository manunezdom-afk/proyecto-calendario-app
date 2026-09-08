import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAssistantActions } from '../src/utils/assistantContract.js'
import { commitCachedCollection, writeJsonCache } from '../src/utils/verifiedMutation.js'
import { rememberEventReceipt, consumeEventReference, clearEventReference } from '../src/utils/assistantEventReference.js'

const user = 'account-a'
const now = 2_000_000
const storage = () => {
  const values = new Map()
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}
function fixture({ fail = false } = {}) {
  const cache = storage()
  let events = []
  const action = { type: 'add_event', actionId: 'b8e89c63-a57c-48de-9c33-ae7897bb40b8:0', event: { title: 'Gym', date: '2026-09-09', time: '10:00 AM' } }
  const outcome = applyAssistantActions([action], { onAddEvent(event) {
    const disk = fail ? { setItem() { throw Error('disk_full') } } : cache
    return commitCachedCollection([event], next => writeJsonCache(disk, 'events', next), next => { events = next }) ? event : null
  } })
  const history = [{ role: 'user', content: 'pon gym mañana a las 10 AM' }, { role: 'assistant', content: outcome.message }]
  return { cache, events, outcome, history }
}
const consume = f => consumeEventReference(f.cache, user, { message: 'mejor a las 11 AM', events: f.events, history: f.history }, now + 1)

test('a real cache commit grounds exactly the saved ID and the continuation consumes it once', () => {
  const f = fixture()
  assert.equal(rememberEventReceipt(f.cache, user, f.outcome, 'execute', now), true)
  assert.deepEqual(consume(f), [f.events[0].id])
  assert.deepEqual(consume(f), [])
})

test('a verified edit refreshes the reference using the newly persisted snapshot', () => {
  const f = fixture(), old = f.events[0]
  const outcome = applyAssistantActions([{ type: 'edit_event', id: old.id, actionId: 'edit:0', updates: { time: '11:00 AM' } }], {
    events: f.events, onEditEvent(id, updates) {
      const updated = { ...old, ...updates }
      return commitCachedCollection([updated], next => writeJsonCache(f.cache, 'events', next), next => { f.events = next }) ? updated : null
    },
  })
  rememberEventReceipt(f.cache, user, outcome, 'execute', now)
  f.history.push({ role: 'user', content: 'mejor a las 11 AM' }, { role: 'assistant', content: outcome.message })
  assert.deepEqual(consume(f), [old.id])
})

test('failed persistence, partial batches, proposals and reply-only success cannot create references', () => {
  const f = fixture({ fail: true })
  assert.equal(rememberEventReceipt(f.cache, user, f.outcome, 'execute', now), false)
  assert.deepEqual(consume(f), [])
  const good = fixture()
  for (const [outcome, kind] of [[{ ...good.outcome, ok: false }, 'execute'], [good.outcome, 'review'], [{ ok: true, message: 'Guardé Gym.' }, 'execute'], [{ ...good.outcome, receipts: [...good.outcome.receipts, ...good.outcome.receipts] }, 'execute']]) {
    assert.equal(rememberEventReceipt(good.cache, user, outcome, kind, now), false)
    assert.deepEqual(consume(good), [])
  }
})

test('unrelated capture or chat discards a prior event even if a later message is anaphoric', () => {
  for (const message of ['compra pan', 'mejor compra pan', 'mejor una receta', 'mejor el pan', 'mejor a la tienda', 'hola', 'qué más tengo mañana']) {
    const f = fixture()
    rememberEventReceipt(f.cache, user, f.outcome, 'execute', now)
    assert.deepEqual(consumeEventReference(f.cache, user, { message, events: f.events, history: f.history }, now + 1), [])
    assert.deepEqual(consume(f), [])
  }
})

test('manual changes, deleted events, mismatched history and pending proposals refuse stale references', () => {
  for (const mutate of [f => { f.events[0].time = '12:00 PM' }, f => { f.events = [] }, f => { f.history.push({ role: 'assistant', content: 'Otro tema.' }) }, f => { f.pendingProposal = { id: 'pending' } }]) {
    const f = fixture()
    rememberEventReceipt(f.cache, user, f.outcome, 'execute', now)
    mutate(f)
    assert.deepEqual(consumeEventReference(f.cache, user, { ...f, message: 'mejor a las 11 AM' }, now + 1), [])
  }
})

test('account isolation and clearing prevent references from returning after logout', () => {
  const f = fixture()
  rememberEventReceipt(f.cache, user, f.outcome, 'execute', now)
  assert.deepEqual(consumeEventReference(f.cache, 'account-b', { message: 'mejor a las 11 AM', ...f }, now + 1), [])
  clearEventReference(f.cache, user)
  assert.deepEqual(consume(f), [])
})

test('expired references and unavailable session storage fail closed', () => {
  const f = fixture()
  rememberEventReceipt(f.cache, user, f.outcome, 'execute', now)
  assert.deepEqual(consumeEventReference(f.cache, user, { message: 'mejor a las 11 AM', ...f }, now + 30 * 60_000 + 1), [])
  const broken = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') }, removeItem() { throw Error('blocked') } }
  assert.equal(rememberEventReceipt(broken, user, f.outcome, 'execute', now), false)
  assert.deepEqual(consumeEventReference(broken, user, { message: 'mejor a las 11 AM', ...f }, now + 1), [])
})

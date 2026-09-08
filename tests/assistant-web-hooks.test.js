import test from 'node:test'
import assert from 'node:assert/strict'
import { createHookHarness } from './helpers/hookHarness.js'

for (const [filename, hookName, collection, createName, payload] of [
  ['useEvents.js', 'useEvents', 'events', 'addEvent', { id: 'one', title: 'Dentista', date: '2027-09-10', time: '11:00' }],
  ['useTasks.js', 'useTasks', 'tasks', 'addTask', { id: 'one', label: 'Pan', date: '2027-09-10', time: '11:00' }],
]) {
  test(`${hookName}: failed cache writes cannot publish or return an entity receipt`, () => {
    const env = createHookHarness('../../src/hooks/' + filename, hookName)
    try {
      env.rejectWrites = true
      assert.equal(env.render()[createName](payload), null)
      assert.deepEqual(env.render()[collection], [])
      assert.equal(env.calls.length, 0)
      env.rejectWrites = false
      assert.equal(env.render()[createName](payload).id, 'one')
      assert.equal(env.render()[collection].length, 1)
    } finally { env.close() }
  })

  test(`${hookName}: pending A and late A fetch never enter B cache or state`, async () => {
    const env = createHookHarness('../../src/hooks/' + filename, hookName)
    try {
      const firstRead = env.reads.find(read => read.id === 'A')
      env.render()[createName](payload)
      assert.equal(env.render()[collection].length, 1)
      env.setUser('B')
      firstRead.resolve([{ ...payload, id: 'late-A' }])
      const bRead = env.reads.find(read => read.id === 'B')
      assert.ok(bRead)
      bRead.resolve([])
      const state = await env.flush()
      assert.deepEqual(state[collection], [])
      assert.ok(env.writes.filter(write => write.id === 'B').every(write => write.rows.length === 0))
    } finally { env.close() }
  })
}

test('useTasks: explicit completion is idempotent and stale refetch cannot undo committed edits', async () => {
  const env = createHookHarness('../../src/hooks/useTasks.js', 'useTasks')
  try {
    const task = env.render().addTask({ id: 'one', label: 'Pan' })
    assert.equal(env.render().updateTask('one', { done: true }).done, true)
    assert.equal(env.render().updateTask('one', { done: true }).done, true)
    env.reads[0].resolve([task])
    assert.equal((await env.flush()).tasks[0].done, true)
    env.rejectWrites = true
    assert.equal(env.render().updateTask('one', { done: false }), null)
    assert.equal(env.render().tasks[0].done, true)
  } finally { env.close() }
})

for (const [filename, hookName, collection, createName, payload] of [
  ['useUserMemories.js', 'useUserMemories', 'memories', 'addMemory', { id: 'one', subject: 'Café', content: 'Sin azúcar' }],
  ['useSuggestions.js', 'useSuggestions', 'suggestions', 'addSuggestion', { id: 'one', kind: 'add_task', payload: { task: { label: 'Pan' } } }],
]) {
  test(`${hookName}: account-scoped fetch and writes survive A→B without leaking late responses`, async () => {
    const env = createHookHarness('../../src/hooks/' + filename, hookName)
    try {
      const aRead = env.reads[0]
      env.rejectWrites = true
      assert.equal(env.render()[createName](payload), null)
      assert.deepEqual(env.render()[collection], [])
      env.rejectWrites = false
      env.render()[createName](payload)
      env.setUser('B')
      aRead.resolve([{ ...payload, id: 'late-A' }])
      env.reads.find(read => read.id === 'B').resolve([])
      const state = await env.flush()
      assert.deepEqual(state[collection], [])
      assert.ok(env.writes.filter(write => write.id === 'B').every(write => write.rows.length === 0))
      env.setUser('A')
      assert.equal(env.render()[collection][0].id, 'one')
    } finally { env.close() }
  })
}

test('useTasks: distinct assistant IDs keep repeated titles on different days, replay reuses only the same ID', () => {
  const env = createHookHarness('../../src/hooks/useTasks.js', 'useTasks')
  try {
    const first = env.render().addTask({ id: 'mon', label: 'Estudiar', date: '2027-09-06' })
    const second = env.render().addTask({ id: 'tue', label: 'Estudiar', date: '2027-09-07' })
    assert.notEqual(first.id, second.id)
    assert.equal(env.render().tasks.length, 2)
    assert.equal(env.render().addTask({ id: 'mon', label: 'Estudiar', date: '2027-09-06' }).id, first.id)
    assert.equal(env.render().tasks.length, 2)
  } finally { env.close() }
})

test('useUserMemories: alias identity keeps different subjects and updates a repeated key in place', () => {
  const env = createHookHarness('../../src/hooks/useUserMemories.js', 'useUserMemories')
  try {
    const first = env.render().addMemory({ id: 'ana', subject: 'Ana', category: 'relationship', content: 'Compañera de equipo' })
    const second = env.render().addMemory({ id: 'bea', subject: 'Bea', category: 'relationship', content: 'Compañera de equipo' })
    assert.notEqual(first.id, second.id)
    assert.equal(env.render().memories.length, 2)
    const updated = env.render().addMemory({ id: 'new-request', subject: 'ANA', category: 'relationship', content: 'Compañera del equipo de diseño' })
    assert.equal(updated.id, first.id)
    assert.equal(env.render().memories.length, 2)
    assert.equal(env.render().memories.find(memory => memory.id === first.id).content, 'Compañera del equipo de diseño')
    assert.equal(env.render().memories.find(memory => memory.id === second.id).content, 'Compañera de equipo')
  } finally { env.close() }
})

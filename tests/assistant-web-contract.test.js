import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareAssistantResponse, applyAssistantActions, applyConfirmedAction, completedRetryableFailure, stableActionIdentifier } from '../src/utils/assistantContract.js'
import { actionToSuggestion, applySuggestion } from '../src/utils/actionToSuggestion.js'
import { writeJsonCache, commitCachedCollection, mergePendingCollection, advanceAccountEpoch } from '../src/utils/verifiedMutation.js'

const requestId = '7ce8d38b-cea7-4453-b3c8-f82d3d773775'
const task = { id: 'task-1', label: 'Comprar pan', done: false, date: '2027-09-10', time: '09:00' }
const event = { id: 'event-1', title: 'Dentista', date: '2027-09-10', time: '11:00' }
const context = { tasks: [task], events: [event], memories: [{ id: 'memory-1', subject: 'Café', content: 'Sin azúcar' }] }
const prepare = (actions, options = {}) => prepareAssistantResponse({ mode: 'chat_with_action', actions, ...options }, context, { requestId })

test('proposal reads proposed_actions and cannot execute deletion without review', () => {
  const plan = prepare([], { mode: 'proposal', proposed_actions: [{ type: 'delete_task', id: task.id }] })
  assert.equal(plan.kind, 'review')
  let deleted = false
  const result = applyAssistantActions(plan.actions, { ...context, onDeleteTask() { deleted = true; return true } })
  assert.equal(result.ok, false)
  assert.equal(deleted, false)
  const suggestion = actionToSuggestion(plan.actions[0], context)
  assert.equal(applySuggestion(suggestion, { ...context, onDeleteTask: () => true }).ok, true)
})

test('unknown IDs never fall back to a quoted reply or matching title', () => {
  const plan = prepare([{ type: 'delete_event', id: 'not-real', updates: { title: event.title } }], { reply: 'Eliminé "Dentista" a las 11:00' })
  assert.equal(plan.ok, false)
})

test('complete_task sets an explicit state and repeating done true never toggles it', () => {
  const plan = prepare([{ type: 'complete_task', id: task.id, done: true }])
  let current = { ...task }
  let toggles = 0
  const handlers = { ...context, onToggleTask: () => { toggles++ }, onUpdateTask(id, updates) { current = { ...current, ...updates }; return current } }
  assert.equal(applyAssistantActions(plan.actions, handlers).ok, true)
  assert.equal(applyAssistantActions(plan.actions, handlers).ok, true)
  assert.equal(current.done, true)
  assert.equal(toggles, 0)
  assert.equal(prepare([{ type: 'complete_task', id: task.id }]).ok, false)
})

test('edit_task preserves explicit null clearing and requires a real commit receipt', () => {
  const plan = prepare([{ type: 'edit_task', id: task.id, updates: { label: 'Pan integral', date: null } }])
  assert.deepEqual(plan.actions[0].updates, { label: 'Pan integral', date: null, time: null })
  assert.equal(applyAssistantActions(plan.actions, { ...context, onUpdateTask() {} }).ok, false)
  assert.equal(applyAssistantActions(plan.actions, { ...context, onUpdateTask: (id, updates) => ({ ...task, ...updates }) }).ok, true)
})

test('cache rejection leaves published state untouched and cannot produce a creation receipt', () => {
  let rows = []
  const brokenStorage = { setItem() { throw new Error('quota') } }
  const plan = prepare([{ type: 'add_task', task: { label: 'Pan' } }])
  const outcome = applyAssistantActions(plan.actions, { onAddTask(task) {
    return commitCachedCollection([task], value => writeJsonCache(brokenStorage, 'tasks', value), value => { rows = value }) ? task : null
  } })
  assert.equal(outcome.ok, false)
  assert.deepEqual(outcome.receipts, [])
  assert.deepEqual(rows, [])
})

test('reviewed snapshot refuses a manual change before approval', () => {
  const plan = prepare([{ type: 'edit_task', id: task.id, updates: { label: 'Nuevo' } }], { mode: 'proposal', proposed_actions: [{ type: 'edit_task', id: task.id, updates: { label: 'Nuevo' } }] })
  const suggestion = actionToSuggestion(plan.actions[0], context)
  let called = false
  const outcome = applySuggestion(suggestion, { ...context, tasks: [{ ...task, label: 'Manual' }], onUpdateTask() { called = true } })
  assert.equal(outcome.ok, false)
  assert.equal(called, false)
})

test('direct edits retain the requested snapshot and cannot overwrite an intervening change', () => {
  const plan = prepare([{ type: 'edit_event', id: event.id, updates: { time: '12:00' } }])
  assert.equal(plan.kind, 'execute')
  let calls = 0
  const outcome = applyAssistantActions(plan.actions, { ...context,
    events: [{ ...event, time: '13:00' }],
    onEditEvent() { calls++; return { ...event, time: '12:00' } },
  })
  assert.equal(outcome.ok, false)
  assert.equal(calls, 0)
  assert.deepEqual(outcome.receipts, [])
})

test('new save/forget memory actions require review and map the existing memory shape', () => {
  const saved = prepare([{ type: 'save_memory', memory: { key: 'Café', value: 'Sin azúcar', category: 'preference' } }])
  assert.equal(saved.kind, 'review')
  assert.equal(saved.actions[0].memory.content, 'Sin azúcar')
  assert.equal(applyConfirmedAction(saved.actions[0], { onAddMemory: () => null }, { reviewed: true }).ok, false)
  const forgotten = prepare([{ type: 'forget_memory', key: '__all__' }])
  assert.deepEqual(forgotten.actions[0].memoryIds, ['memory-1'])
  assert.equal(applyConfirmedAction(forgotten.actions[0], { ...context, onDeleteMemories: () => true }, { reviewed: true }).ok, true)
})

test('chat/clarification and blocked replies cannot become fake success receipts', () => {
  assert.equal(prepare([], { mode: 'chat_only', reply: 'Listo, guardé la tarea.' }).ok, false)
  assert.equal(prepare([], { smartActionsBlocked: true, smartActionsMessage: 'Nova dice guardado' }).ok, false)
  const chat = prepare([], { mode: 'clarification', reply: '¿Para qué día?', actions: [{ type: 'delete_task', id: task.id }] })
  assert.equal(chat.kind, 'chat')
  assert.deepEqual(chat.actions, [])
})

test('replays keep stable creation/proposal IDs and recurrence reports partial failures honestly', () => {
  assert.equal(stableActionIdentifier(requestId + ':0', 'task'), stableActionIdentifier(requestId + ':0', 'task'))
  const action = { type: 'add_recurring_event', actionId: requestId + ':1', event: { title: 'Clase', date: '2027-09-10', time: '11:00' }, recurrence: { pattern: 'daily', startDate: '2027-09-10', count: 3 } }
  let count = 0
  const outcome = applyConfirmedAction(action, { onAddEvent: row => ++count === 2 ? null : row })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.receipts.length, 1)
  assert.equal(count, 2)
})

test('only matching terminal retry flags permit a new request identity', () => {
  const payload = { requestId, request_completed: true, request_retryable: true }
  assert.equal(completedRetryableFailure(503, payload, requestId), true)
  assert.equal(completedRetryableFailure(503, { ...payload, requestId: 'another' }, requestId), false)
  assert.equal(completedRetryableFailure(503, {}, requestId), false)
  assert.equal(completedRetryableFailure(409, payload, requestId), false)
})

test('pending edits survive stale cloud rows with the same ID, and epochs distinguish A→B→A', () => {
  const pending = new Map([[task.id, { task: { ...task, done: true } }]])
  assert.equal(mergePendingCollection([task], pending, 'task', ['label', 'done']).merged[0].done, true)
  assert.equal(pending.size, 1)
  mergePendingCollection([{ ...task, done: true }], pending, 'task', ['label', 'done'])
  assert.equal(pending.size, 0)
  const a = advanceAccountEpoch(null, 'A')
  const b = advanceAccountEpoch(a, 'B')
  assert.notEqual(advanceAccountEpoch(b, 'A'), a)
})

test('save_memory survives the complete prepare→inbox→approve pipeline', () => {
  const plan = prepare([{ type: 'save_memory', memory: { key: 'Café', value: 'Sin azúcar', category: 'preference' } }])
  const suggestion = actionToSuggestion(plan.actions[0], context)
  assert.ok(suggestion)
  assert.equal(suggestion.payload.memory.content, 'Sin azúcar')
  let saved
  const result = applySuggestion(suggestion, { ...context, onAddMemory: memory => { saved = memory; return memory } })
  assert.equal(result.ok, true)
  assert.equal(saved.subject, 'Café')
})

test('legacy snake-case blocked metadata and unsupported future promises never execute', () => {
  assert.equal(prepare([{ type: 'add_task', task: { label: 'Pan' } }], { smart_actions_blocked: true }).ok, false)
  for (const reply of ['Perfecto, guardé la tarea.', 'Te recordaré comprar pan.', 'Te lo voy a recordar.']) {
    assert.equal(prepare([], { mode: 'chat_only', reply }).ok, false, reply)
  }
})

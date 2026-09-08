import test from 'node:test'
import assert from 'node:assert/strict'
import { pendingCalendarProposal, prepareProposalBatch, appendProposalRequest } from '../src/utils/pendingProposal.js'
import { prepareAssistantResponse, enqueueAssistantReview } from '../src/utils/assistantContract.js'
import { actionToSuggestion, applySuggestion } from '../src/utils/actionToSuggestion.js'
import { commitCachedCollection, writeJsonCache } from '../src/utils/verifiedMutation.js'

const originalRequest = 'Organízame la tarde'
const oldID = '0bf7740c-7744-413e-9b20-01457cd93251'
const nextID = '9e187c11-8e53-46a4-a99d-fd2ebbd2b38f'
const event = (time, endTime) => ({ type: 'add_event', event: { title: 'Estudiar', date: '2027-09-10', time, endTime } })
const response = (requestId, action, replacesProposalId) => ({ requestId, mode: 'proposal', confidence: 1, reply: 'Preparé el plan.', actions: [], proposed_actions: [action], ...(replacesProposalId ? { replacesProposalId } : {}) })
function rows(prepared, batchId, goal = originalRequest) {
  return prepared.actions.map(action => {
    const row = actionToSuggestion(action, { batchId })
    row.payload.proposalContext = { id: batchId, originalRequest: goal }
    return row
  })
}
function initial() {
  const prepared = prepareAssistantResponse(response(oldID, event('19:00', '21:00')), {}, { requestId: oldID })
  return prepareProposalBatch([], rows(prepared, `proposal-${oldID}`)).next
}

test('calendar plan survives refinement as not-saved context, replaces atomically and preserves approved duration/receipt', () => {
  let suggestions = initial()
  let events = []
  const before = suggestions
  const pendingProposal = pendingCalendarProposal(suggestions)
  assert.deepEqual(Object.keys(pendingProposal), ['id', 'originalRequest', 'actions'])
  assert.deepEqual(pendingProposal.actions, [event('19:00', '21:00')])
  const prepared = prepareAssistantResponse(response(nextID, event('18:00', '20:00'), pendingProposal.id), { events, pendingProposal }, { requestId: nextID })
  assert.equal(prepared.kind, 'review')
  let writes = 0
  const result = enqueueAssistantReview(prepared.actions, () => {
    const batch = prepareProposalBatch(suggestions, rows(prepared, `proposal-${nextID}`), { replacesProposalId: pendingProposal.id, expectedProposal: pendingProposal })
    if (!batch || !commitCachedCollection(batch.next, () => { writes++; return true }, value => { suggestions = value })) return null
    return batch.saved
  })
  assert.equal(result.ok, true)
  assert.equal(writes, 1)
  assert.equal(events.length, 0)
  assert.equal(before[0].status, 'pending') // Original snapshot wasn't mutated.
  assert.equal(suggestions.find(item => item.id === before[0].id).status, 'rejected')
  const revised = suggestions.find(item => item.status === 'pending')
  assert.equal(revised.payload.proposalContext.originalRequest, originalRequest)
  assert.notEqual(revised.payload.actionId, before[0].payload.actionId)
  assert.match(revised.previewBody, /18:00.*20:00/)
  const approve = () => applySuggestion(revised, { events, onAddEvent(value) {
    const existing = events.find(item => item.id === value.id)
    if (existing) return existing
    events = [...events, value]
    return value
  } })
  assert.equal(approve().ok, true)
  assert.equal(approve().ok, true)
  assert.equal(events.length, 1)
  assert.equal(events[0].time, '18:00')
  assert.equal(events[0].endTime, '20:00')
})

test('failed cache write cannot retire original proposal or claim successful replacement', () => {
  let suggestions = initial()
  const before = structuredClone(suggestions)
  const expectedProposal = pendingCalendarProposal(suggestions)
  const prepared = prepareAssistantResponse(response(nextID, event('18:00', '20:00'), expectedProposal.id), { pendingProposal: expectedProposal }, { requestId: nextID })
  const result = enqueueAssistantReview(prepared.actions, () => {
    const batch = prepareProposalBatch(suggestions, rows(prepared, `proposal-${nextID}`), { replacesProposalId: expectedProposal.id, expectedProposal })
    const committed = commitCachedCollection(batch.next, next => writeJsonCache({ setItem() { throw new Error('disk full') } }, 'account-scoped', next), next => { suggestions = next })
    return committed ? batch.saved : null
  })
  assert.equal(result.ok, false)
  assert.deepEqual(suggestions, before)
})

test('stale, resolved, changed and nonmatching proposal snapshots cannot be replaced', () => {
  const suggestions = initial()
  const expectedProposal = pendingCalendarProposal(suggestions)
  const prepared = prepareAssistantResponse(response(nextID, event('18:00', '20:00'), expectedProposal.id), { pendingProposal: expectedProposal }, { requestId: nextID })
  const incoming = rows(prepared, `proposal-${nextID}`)
  const options = { replacesProposalId: expectedProposal.id, expectedProposal }
  assert.equal(prepareProposalBatch([{ ...suggestions[0], status: 'approved' }], incoming, options), null)
  assert.equal(prepareProposalBatch([], incoming, options), null) // An account switch exposes no old collection.
  const changed = structuredClone(suggestions)
  changed[0].payload.event.time = '17:00'
  assert.equal(prepareProposalBatch(changed, incoming, options), null)
  assert.equal(prepareProposalBatch(suggestions, incoming, { ...options, replacesProposalId: 'unknown' }), null)
})

test('clarification/error keep proposal; missing/mismatched replacement and direct mutation cannot replace it', () => {
  const suggestions = initial()
  const pendingProposal = pendingCalendarProposal(suggestions)
  for (const mode of ['chat_only', 'clarification']) {
    const result = prepareAssistantResponse({ mode, actions: [], reply: '¿A qué hora quieres empezar?' }, { pendingProposal }, { requestId: nextID })
    assert.equal(result.kind, 'chat')
    assert.deepEqual(pendingCalendarProposal(suggestions), pendingProposal)
  }
  for (const id of [undefined, 'unknown']) assert.equal(prepareAssistantResponse(response(nextID, event('18:00', '20:00'), id), { pendingProposal }, { requestId: nextID }).ok, false)
  assert.equal(prepareAssistantResponse({ mode: 'chat_with_action', actions: [event('18:00', '20:00')] }, { pendingProposal }, { requestId: nextID }).ok, false)
  assert.equal(prepareAssistantResponse({ smartActionsBlocked: true }, { pendingProposal }, { requestId: nextID }).ok, false)
})

test('wire context strips snapshots, action receipts, private metadata and excludes mixed/partly-approved batches', () => {
  const suggestions = initial()
  suggestions[0].payload.reviewedEvent = { secret: 'local snapshot only' }
  suggestions[0].payload.event.reviewed = true
  const encoded = JSON.stringify(pendingCalendarProposal(suggestions))
  assert.equal(encoded.includes('reviewed'), false)
  assert.equal(encoded.includes('actionId'), false)
  assert.equal(encoded.includes('proposalContext'), false)
  assert.equal(pendingCalendarProposal([{ ...suggestions[0], kind: 'delete_event' }]), null)
  assert.equal(pendingCalendarProposal([...suggestions, { ...suggestions[0], id: 'another', status: 'approved' }]), null)
})


test('two accepted refinements retain earlier constraints once, including completed replay', () => {
  let current = initial()
  const cutoff = 'No quiero estudiar después de las 20'
  const firstContext = pendingCalendarProposal(current)
  const prepared = prepareAssistantResponse(response(nextID, event('18:00', '20:00'), firstContext.id), { pendingProposal: firstContext }, { requestId: nextID })
  const firstRows = rows(prepared, `proposal-${nextID}`, appendProposalRequest(firstContext.originalRequest, cutoff))
  const options = { replacesProposalId: firstContext.id, expectedProposal: firstContext }
  current = prepareProposalBatch(current, firstRows, options).next
  const replay = prepareProposalBatch(current, firstRows, options)
  assert.deepEqual(replay.next, current)
  assert.deepEqual(replay.changed, [])
  const afterCutoff = pendingCalendarProposal(current)
  assert.equal(afterCutoff.originalRequest, originalRequest + '\n' + cutoff)
  const secondMessage = 'Prefiero comenzar a las 17'
  const thirdID = '7116935d-bdfe-412d-9f6e-1f5e1c4ee2ed'
  const second = prepareAssistantResponse(response(thirdID, event('17:00', '19:00'), afterCutoff.id), { pendingProposal: afterCutoff }, { requestId: thirdID })
  current = prepareProposalBatch(current, rows(second, `proposal-${thirdID}`, appendProposalRequest(afterCutoff.originalRequest, secondMessage)),
    { replacesProposalId: afterCutoff.id, expectedProposal: afterCutoff }).next
  assert.equal(pendingCalendarProposal(current).originalRequest, originalRequest + '\n' + cutoff + '\n' + secondMessage)
  assert.equal(current.filter(item => item.status === 'pending').length, 1)
  assert.equal(current.filter(item => item.status === 'rejected').length, 2)
})

test('UTF-16 cap rejects a new refinement without truncation or changing the previous snapshot', () => {
  const context = pendingCalendarProposal(initial())
  context.originalRequest = 'Organiza ' + '😀'.repeat(1990)
  const before = structuredClone(context)
  assert.ok(context.originalRequest.length < 4000)
  assert.equal(appendProposalRequest(context.originalRequest, 'No quiero estudiar después de las 20'), null)
  assert.deepEqual(context, before)
  assert.equal(appendProposalRequest('a'.repeat(3998), 'x').length, 4000)
  assert.equal(appendProposalRequest('a'.repeat(3998), '😀'), null)
})

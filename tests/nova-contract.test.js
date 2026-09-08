import test from 'node:test'
import assert from 'node:assert/strict'
import { validateNovaPlan, isNovaWirePlan, civilTimeOccurrences } from '../api/_lib/novaContract.js'
import { buildDateContext } from '../api/_lib/dateContext.js'
import { wireAction, wirePlan } from './helpers/novaFixtures.js'
const check = (actions, userMessage = 'comprar pan', extra = {}) => validateNovaPlan({
  payload: wirePlan(actions), userMessage, requestId: 'request-1', ...extra })
const none = result => { assert.equal(result.actions.length, 0); assert.equal(result.proposed_actions.length, 0); assert.equal(result.validation.ok, false) }

test('date-only task has no invented hour and deterministic receipt ID', () => {
  const out = check([wireAction({ dateISO: '2026-09-09' })])
  assert.equal(out.actions[0].task.date, '2026-09-09'); assert.equal(out.actions[0].task.time, undefined)
  assert.equal(out.actions[0].actionId, 'request-1:0'); assert.doesNotMatch(out.reply, /guardé|creé/)
  assert.deepEqual(out, check([wireAction({ dateISO: '2026-09-09' })]))
})
for (const malformed of [null, {}, [], { ...wirePlan(), surprise: 'instruction' },
  wirePlan([null]), wirePlan([wireAction(), null]), wirePlan([wireAction({ confidence: 'unknown' })]),
  wirePlan([wireAction({ durationMinutes: -1 })]), wirePlan([wireAction({ reminderOffsetMinutes: 10081 })]),
  wirePlan([wireAction({ dateISO: '2026-02-30' })]), wirePlan([wireAction({ time: '99:99' })]),
  wirePlan([wireAction({ sourceText: '' })])]) {
  test(`strict schema and all-or-none reject ${JSON.stringify(malformed).slice(0, 55)}`, () => none(validateNovaPlan({ payload: malformed, userMessage: 'comprar pan' })))
}
test('valid model schema is recognized without coercion', () => assert.equal(isNovaWirePlan(wirePlan([wireAction()])), true))
test('duplicate actions invalidate whole batch', () => none(check([wireAction(), wireAction()])))
test('chat mode cannot smuggle mutations', () => none(check([wireAction()], 'comprar pan', { payload: wirePlan([wireAction()], { mode: 'chat_only' }) })))
test('emotional input cannot become task even with literal source evidence', () => none(check([wireAction({ title: 'Estoy cansado', sourceText: 'estoy cansado' })], 'estoy cansado')))
test('unrelated task title cannot hide behind literal source', () => none(check([wireAction({ title: 'Vender acciones' })])))
test('asking to organize is not permission to create', () => none(check([wireAction({ sourceText: 'ordena comprar pan' })], 'ordena comprar pan')))
test('negation vetoes deletion and unknown ID never executes', () => {
  const a = wireAction({ type: 'delete_event', targetEventId: 'e1', sourceText: 'no borres dentista' })
  none(check([a], 'no borres dentista', { events: [{ id: 'e1' }] }))
  none(check([{ ...a, sourceText: 'borra dentista' }], 'borra dentista'))
})
test('deletion is a pending proposal, never an immediate action', () => {
  const out = check([wireAction({ type: 'delete_task', targetTaskId: 't1', sourceText: 'borra comprar pan' })], 'borra comprar pan', { tasks: [{ id: 't1' }] })
  assert.equal(out.mode, 'proposal'); assert.equal(out.actions.length, 0); assert.equal(out.proposed_actions[0].id, 't1')
})
test('completion sets explicit state and replay is stable', () => {
  const out = check([wireAction({ type: 'complete_task', targetTaskId: 't1', done: true, sourceText: 'completa comprar pan' })], 'completa comprar pan', { tasks: [{ id: 't1' }] })
  assert.equal(out.actions[0].type, 'complete_task'); assert.equal(out.actions[0].done, true)
})
test('no olvidar is a reminder intention, not a negated mutation', () => assert.equal(check([wireAction({ sourceText: 'no olvidar comprar pan' })], 'no olvidar comprar pan').actions.length, 1))
test('relationship memory is recognized and arbitrary forgetting is blocked', () => {
  const a = wireAction({ type: 'save_memory', sourceText: 'Cata es mi polola', memoryKey: 'cata', memoryValue: 'Cata es mi pareja', memoryCategory: 'personAlias' })
  assert.equal(check([a], 'Cata es mi polola').actions[0].type, 'save_memory')
  none(check([wireAction({ type: 'forget_memory', sourceText: 'hola', memoryKey: '__all__' })], 'hola'))
})
test('a prior delete command does not authorize an unrelated new turn', () => none(check([wireAction({ type: 'delete_event', targetEventId: 'e1', sourceText: 'borra dentista' })], 'hola', { events: [{ id: 'e1' }], history: [{ role: 'user', content: 'borra dentista' }, { role: 'assistant', content: 'Listo.' }] })))
test('false success claims are removed even behind a friendly preamble', () => {
  const out = validateNovaPlan({ payload: wirePlan([], { userConfirmationText: 'Perfecto, guardé Comprar pan.' }) })
  assert.doesNotMatch(out.reply, /guardé/); assert.equal(out.actions.length, 0)
})
test('explicit past date cannot silently move to tomorrow', () => none(check([wireAction({ dateISO: '2026-09-09', sourceText: 'ayer comprar pan' })], 'ayer comprar pan', { dateContext: { todayISO: '2026-09-08', tomorrow: '2026-09-09' } })))
test('civil tomorrow survives both daylight-saving transitions', () => {
  assert.equal(buildDateContext(Date.parse('2026-03-08T04:30Z'), 'America/New_York').tomorrow, '2026-03-08')
  assert.equal(buildDateContext(Date.parse('2026-11-01T04:30Z'), 'America/New_York').tomorrow, '2026-11-02')
})
test('nonexistent and repeated civil times are detected', () => {
  assert.equal(civilTimeOccurrences('2026-03-08', '02:30', 'America/New_York'), 0)
  assert.equal(civilTimeOccurrences('2026-11-01', '01:30', 'America/New_York'), 2)
})

test('indirect negation cannot authorize deleting or completing a task', () => {
  none(check([wireAction({type:'delete_task',targetTaskId:'t1',sourceText:'borrar comprar pan'})], 'no quiero borrar comprar pan', {tasks:[{id:'t1'}]}))
  none(check([wireAction({type:'complete_task',targetTaskId:'t1',done:true,sourceText:'terminado comprar pan'})], 'no he terminado comprar pan', {tasks:[{id:'t1'}]}))
})
test('negating deletion does not forbid an explicitly requested edit', () => {
  const out = check([wireAction({type:'edit_event',targetEventId:'e1',title:'Dentista',dateISO:null,time:'18:00',sourceText:'mueve dentista a las 6'})],
    'no quiero borrar dentista; mueve dentista a las 6', {events:[{id:'e1',title:'Dentista'}]})
  assert.equal(out.actions[0].updates.time,'6:00 PM')
})
test('completion boolean cannot contradict complete versus pending intent', () => {
  none(check([wireAction({type:'complete_task',targetTaskId:'t1',done:false,sourceText:'completa comprar pan'})], 'completa comprar pan', {tasks:[{id:'t1'}]}))
  const out = check([wireAction({type:'complete_task',targetTaskId:'t1',done:false,sourceText:'marca comprar pan pendiente'})], 'marca comprar pan pendiente', {tasks:[{id:'t1'}]})
  assert.equal(out.actions[0].done,false)
})
test('common spacing and one-letter typo can preserve a literal intent without changing title meaning', () => {
  const out=check([wireAction({type:'create_event',title:'Fútbol',sourceText:'futbo hoy alas 17',dateISO:'2026-09-08',time:'17:00'})], 'futbo hoy alas 17')
  assert.equal(out.actions[0].event.time,'5:00 PM')
})
test('recent clarification correction overrides the older date without splicing source text', () => {
  const out=check([wireAction({type:'create_event',title:'Fútbol',sourceText:'fútbol hoy a las 5',dateISO:'2026-09-09',time:'17:00'})], 'mejor mañana', {
    history:[{role:'user',content:'ponme fútbol hoy a las 5'},{role:'assistant',content:'¿Hoy a las 5 PM?'}],
    dateContext:{todayISO:'2026-09-08',tomorrow:'2026-09-09'} })
  assert.equal(out.actions[0].event.date,'2026-09-09')
})
test('asking for a timed reminder without an exact hour cannot silently become a saved task', () => {
  const out=check([wireAction({title:'Llamar a mamá',sourceText:'llamar a mamá mañana',dateISO:'2026-09-09'})], 'recuérdame llamar a mamá mañana')
  none(out); assert.equal(out.reply,'¿A qué hora quieres que te avise?')
})
test('a completed previous turn and generic offer of more help cannot replay creation', () => {
  none(check([wireAction({type:'create_event',title:'Gym',sourceText:'ponme gym mañana a las 6',dateISO:'2026-09-09',time:'18:00'})], 'ok', {
    history:[{role:'user',content:'ponme gym mañana a las 6'},{role:'assistant',content:'Listo, Gym mañana a las 6 PM. ¿Algo más?'}] }))
})
test('a useful question for an incomplete capture is classified as clarification', () => {
  const out=check([], 'tengo que mandar una wea de la u', {payload:wirePlan([], {userConfirmationText:'¿Qué documento necesitas mandar?'})})
  assert.equal(out.mode,'clarification'); assert.equal(out.shouldAskUser,true)
})
for (const [message, title, reply] of [
  ['ayúdame a ordenar mi día', 'Ordenar mi día', '¿Qué actividades quieres priorizar hoy?'],
  ['no sé por dónde empezar', 'Empezar', 'Te entiendo. ¿Qué es lo que más te presiona en este momento?'],
  ['qué es mejor estudiar primero', 'Estudiar primero', 'Podemos revisar tus prioridades. ¿Tienes materias específicas en mente?'],
]) {
  test(`advice remains conversational and does not authorize a task: ${message}`, () => {
    const out = check([], message, { payload: wirePlan([], { userConfirmationText: reply }) })
    assert.equal(out.mode, 'chat_only'); assert.equal(out.shouldAskUser, false)
    assert.equal(out.reply, reply)
    none(check([wireAction({ title, sourceText: message })], message))
  })
}

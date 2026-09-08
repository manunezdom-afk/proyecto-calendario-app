import test from 'node:test'
import assert from 'node:assert/strict'
import { validateNovaPlan } from '../api/_lib/novaContract.js'
import { buildDateContext } from '../api/_lib/dateContext.js'
import { wirePlan, wireAction } from './helpers/novaFixtures.js'
const dateContext=buildDateContext(Date.parse('2026-09-08T15:00:00Z'),'America/Santiago')
const message='mañana quiero avanzar tres horas con Focus, ir al gym y tengo fútbol a las 8. Organízame el día pero no quiero levantarme antes de las 9.'
const event=(title,time,durationMinutes=60)=>wireAction({type:'create_event',title,time,dateISO:'2026-09-09',durationMinutes,sourceText:'Organízame el día'})
const evaluate=(actions,extra={})=>validateNovaPlan({payload:wirePlan(actions),userMessage:message,dateContext,requestId:'plan-1',events:[{id:'football',title:'Fútbol',date:'2026-09-09',time:'8:00 PM',endTime:'9:30 PM'}],...extra})
test('requested day plan infers hours only as proposals and preserves fixed football',()=>{
 const out=evaluate([event('Focus','09:00',180),event('Gym','13:00')])
 assert.equal(out.validation.ok,true);assert.equal(out.mode,'proposal');assert.deepEqual(out.actions,[])
 assert.equal(out.proposed_actions.length,2);assert.equal(out.proposed_actions[0].event.endTime,'12:00 PM')
})
test('minimum start time and requested work duration cannot silently disappear',()=>{
 const early=evaluate([event('Focus','08:00',180),event('Gym','13:00')])
 assert.ok(early.validation.issues.includes('planned_time_constraint'))
 const short=evaluate([event('Focus','09:00',60),event('Gym','13:00')])
 assert.ok(short.validation.issues.includes('planned_duration_constraint'))
})
test('plans cannot overlap each other or known occupied blocks',()=>{
 assert.ok(evaluate([event('Focus','09:00',180),event('Gym','11:00')]).validation.issues.includes('planned_schedule_conflict'))
 assert.ok(evaluate([event('Focus','09:00',180),event('Gym','19:30')]).validation.issues.includes('planned_schedule_conflict'))
})
test('planning may schedule a real task, never invent a new objective',()=>{
 const context={userMessage:'organízame la tarde de mañana',tasks:[{id:'economics',label:'Estudiar economía'}],events:[]}
 const known=event('Estudiar economía','15:00');known.sourceText='organízame la tarde de mañana'
 assert.equal(evaluate([known],context).proposed_actions.length,1)
 assert.ok(evaluate([{...known,title:'Vender acciones'}],context).validation.issues.includes('unrequested_creation'))
})
test('weekly free nights remain free',()=>{
 const out=evaluate([{...event('Focus','20:00'),dateISO:'2026-09-11',sourceText:'Organízame toda la semana'}],{
  userMessage:'Organízame toda la semana con Focus y quiero dejar viernes y sábado por la noche libres.',events:[]})
 assert.ok(out.validation.issues.includes('planned_free_period_conflict'))
})
test('planning authority cannot bypass deletion grounding',()=>{
 const out=evaluate([wireAction({type:'delete_event',targetEventId:'football',sourceText:'borra el dentista'})],{
  userMessage:'organiza el día de mañana y borra el dentista',events:[{id:'football',title:'Fútbol'},{id:'dentist',title:'Dentista'}]})
 assert.ok(out.validation.issues.includes('ambiguous_event'))
})
test('an unsolicited schedule remains invalid outside an explicit planning request',()=>{
 const out=evaluate([event('Gym','15:00')],{userMessage:'qué hago primero con el gym',payload:wirePlan([{...event('Gym','15:00'),sourceText:'qué hago primero con el gym'}]),events:[]})
 assert.equal(out.actions.length,0);assert.equal(out.proposed_actions.length,0)
})

test('a block starting before a protected evening cannot extend into it',()=>{
 const out=evaluate([{...event('Focus','17:30',120),dateISO:'2026-09-11',sourceText:'Organízame toda la semana'}],{
 userMessage:'Organízame toda la semana con Focus y quiero dejar viernes y sábado por la noche libres.',events:[]})
 assert.ok(out.validation.issues.includes('planned_free_period_conflict'))
})
test('a named required work block cannot be omitted and maximum duration stays bounded',()=>{
 const out=evaluate([{...event('Gym','12:00'),sourceText:'Organízame mañana'}],{userMessage:'Organízame mañana: quiero tres horas con Focus y una hora de gym.',events:[]})
 assert.ok(out.validation.issues.includes('planned_missing_activity'))
 const tooLong=evaluate([{...event('Gym','12:00',180),sourceText:'Organízame mañana'}],{userMessage:'Organízame mañana con máximo una hora de gym.',events:[]})
 assert.ok(tooLong.validation.issues.includes('planned_duration_constraint'))
})
test('moving a planned existing block preserves duration when checking overlaps',()=>{
 const move=wireAction({type:'edit_event',targetEventId:'class',title:'Clase',time:'10:00',dateISO:'2026-09-09',sourceText:'Organízame mañana'})
 const out=evaluate([move],{userMessage:'Organízame mañana',events:[{id:'class',title:'Clase',date:'2026-09-09',time:'8:00 AM',endTime:'10:00 AM'},{id:'dentist',title:'Dentista',date:'2026-09-09',time:'11:00 AM',endTime:'12:00 PM'}]})
 assert.ok(out.validation.issues.includes('planned_schedule_conflict'))
})
test('a user-declared fixed event cannot be moved by planning delegation',()=>{
 const move=wireAction({type:'edit_event',targetEventId:'football',title:'Fútbol',time:'18:00',sourceText:'Organízame mañana'})
 const out=evaluate([move],{userMessage:'Organízame mañana. Fútbol a las 20 es fijo.'})
 assert.ok(out.validation.issues.includes('planned_fixed_event'))
})

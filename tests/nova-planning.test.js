import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateNovaPlan } from '../api/_lib/novaContract.js'
import { buildDateContext } from '../api/_lib/dateContext.js'
import { wirePlan, wireAction } from './helpers/novaFixtures.js'
import { createGrader } from '../scripts/ai-benchmark-grade.mjs'
import { evaluateConversationConstraints } from '../scripts/ai-conversation-benchmark.mjs'
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

const planBlock=(title,dateISO,time,durationMinutes,sourceText)=>wireAction({type:'create_event',title,dateISO,time,durationMinutes,sourceText})
const planning=(input,actions,context={})=>validateNovaPlan({payload:wirePlan(actions,{mode:'proposal'}),
 userMessage:input,dateContext,requestId:'planning-regression',...context})
test('the exact weekly conversation accepts a feasible proposal under the original grader and all original constraints',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./nova-battery/openai-conversations.json',import.meta.url)))
 const scenario=fixture.conversations.find(item=>item.runnerCase?.id==='CONV-WEEK'),c=scenario.runnerCase
 for(const gymName of ['Gym','Gimnasio']){
  const actions=['2026-09-14','2026-09-16','2026-09-18'].flatMap(day=>[
   planBlock('Focus',day,'14:00',120,'Organízame la próxima semana'),
   planBlock(gymName,day,'17:00',60,'Organízame la próxima semana'),
  ])
  actions.push(planBlock('Entregar trabajo de comunicación','2026-09-18','13:00',30,'mis pendientes'))
  const out=planning(c.input,actions,{events:c.events,tasks:c.tasks})
  assert.equal(out.validation.ok,true,JSON.stringify(out.validation));assert.deepEqual(out.actions,[])
  assert.equal(createGrader(dateContext).evaluate(c,out).pass,true)
  const constraints=evaluateConversationConstraints(scenario,{attempted:true,httpStatus:200,output:out})
  assert.equal(constraints.pass,true,JSON.stringify(constraints));assert.equal(constraints.measurements.focusMinutes,360)
  assert.equal(constraints.measurements.gymSessions,3);assert.equal(constraints.measurements.gymMinutes,180)
 }
})

test('total-duration modifiers identify the named activity and retain exact totals across split blocks',()=>{
 for(const phrase of ['seis horas en total para Focus','seis horas para Focus en total','6 horas en total de Focus']){
  const input=`Organízame la semana con ${phrase}`
  const actions=['2026-09-14','2026-09-16','2026-09-18'].map(day=>planBlock('Focus',day,'14:00',120,phrase))
  assert.equal(planning(input,actions).validation.ok,true,phrase)
  for(const changed of [actions.slice(1),actions.map((a,i)=>i? a:{...a,durationMinutes:180})]){
   assert.ok(planning(input,changed).validation.issues.includes('planned_duration_constraint'))
  }
 }
})

test('session counts and per-session durations must both hold, with either gym name and without adding authority',()=>{
 for(const [quantity,hours] of [['tres','una'],['3','1'],['dos','dos']]){
  const count=quantity==='tres'?3:Number(quantity)||2,duration=hours==='dos'?120:60
  const input=`Organízame la semana con ${quantity} sesiones de ${hours} hora${duration===120?'s':''} de gimnasio`
  const actions=Array.from({length:count},(_,i)=>planBlock(i%2?'Gimnasio':'Gym',`2026-09-${14+i}`,'14:00',duration,input))
  const out=planning(input,actions)
  assert.equal(out.validation.ok,true,JSON.stringify(out.validation));assert.equal(out.proposed_actions[0].event.title,'Gym')
  assert.ok(planning(input,actions.slice(1)).validation.issues.includes('planned_session_count'))
  const redistributed=actions.map((a,i)=>({...a,durationMinutes:a.durationMinutes+(i===0?30:i===1?-30:0)}))
  assert.ok(planning(input,redistributed).validation.issues.includes('planned_duration_constraint'))
 }
 for(const input of ['Organízame mañana con una hora de Focus','No me organices mañana con gimnasio','Quizás organízame mañana con gimnasio']){
  const out=planning(input,[planBlock('Gym','2026-09-09','14:00',60,input)])
  assert.equal(out.validation.ok,false,input);assert.equal(out.actions.length+out.proposed_actions.length,0)
 }
})

test('explicit free-from cutoffs apply on each named weekday and check the full interval',()=>{
 for(const [text,day] of [['Deja viernes y sábado libres desde las 7 PM.','2026-09-18'],
  ['Deja viernes y sábado por la noche libres desde las 19:00.','2026-09-19'],
  ['Deja martes y jueves libres desde las 18:30.','2026-09-17']]){
  const input=`Organízame la próxima semana con Focus. ${text}`
  const cutoff=text.includes('18:30')?18*60+30:19*60
  const clock=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`
  for(const [start,duration] of [[cutoff,60],[cutoff-30,60]]){
   const out=planning(input,[planBlock('Focus',day,clock(start),duration,'Focus')])
   assert.ok(out.validation.issues.includes('planned_free_period_conflict'),JSON.stringify(out.validation))
  }
  assert.equal(planning(input,[planBlock('Focus',day,clock(cutoff-60),60,'Focus')]).validation.ok,true)
  assert.equal(planning(input,[planBlock('Focus','2026-09-14',clock(cutoff),60,'Focus')]).validation.ok,true)
 }
})

test('explicit sleep windows protect both sides of midnight without inventing times or blocking the endpoints',()=>{
 for(const sleeping of ['sueño de 11 PM a 7 AM','duermo de 23:00 a 07:00']){
  const input=`Organízame la próxima semana con Focus y ${sleeping}.`
  for(const [time,duration] of [['02:00',60],['22:30',60],['06:30',60],['23:00',0]]){
   assert.ok(planning(input,[planBlock('Focus','2026-09-14',time,duration,'Focus')]).validation.issues.includes('planned_sleep_conflict'))
  }
  for(const [time,duration] of [['07:00',60],['22:00',60]]){
   assert.equal(planning(input,[planBlock('Focus','2026-09-14',time,duration,'Focus')]).validation.ok,true)
  }
 }
 const ambiguous='Organízame la próxima semana con Focus y sueño de 11 a 7.'
 assert.ok(planning(ambiguous,[planBlock('Focus','2026-09-14','14:00',60,'Focus')]).validation.issues.includes('ambiguous_planned_constraint'))
})

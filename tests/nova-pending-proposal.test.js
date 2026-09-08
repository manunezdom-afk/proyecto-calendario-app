import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeNovaRequest } from '../api/_lib/novaSafety.js'
import { validateNovaPlan } from '../api/_lib/novaContract.js'
import { sanitizePendingProposal, activePendingProposal } from '../api/_lib/novaPendingProposal.js'
import { buildDateContext } from '../api/_lib/dateContext.js'
import { wireAction, wirePlan } from './helpers/novaFixtures.js'

const dateContext=buildDateContext(Date.parse('2026-09-08T15:00Z'),'America/Santiago')
const proposalId='f76ecb57-b22c-40f7-a1ef-1b0586043458'
const originalRequest='Organízame mañana: quiero tres horas con Focus y una hora de gym. Fútbol a las 20 es fijo.'
const events=[{id:'football-event',title:'Fútbol',date:dateContext.tomorrow,time:'8:00 PM',endTime:'10:00 PM'}]
const pending=()=>({id:proposalId,originalRequest,actions:[
 {type:'add_event',event:{title:'Focus',date:dateContext.tomorrow,time:'4:00 PM',endTime:'7:00 PM',section:'focus',icon:'code'}},
 {type:'add_event',event:{title:'Gym',date:dateContext.tomorrow,time:'7:00 PM',endTime:'8:00 PM',section:'evening',icon:'fitness_center'}},
]})
const refinement='Ajusta la propuesta: no quiero terminar después de las 20.'
const revisedActions=(sourceText=refinement)=>[
 wireAction({type:'create_event',title:'Focus',dateISO:dateContext.tomorrow,time:'14:00',durationMinutes:180,sourceText}),
 wireAction({type:'create_event',title:'Gym',dateISO:dateContext.tomorrow,time:'17:00',durationMinutes:60,sourceText}),
]
const validate=(payload,message=refinement,proposal=pending())=>validateNovaPlan({payload,userMessage:message,pendingProposal:proposal,
 events,dateContext,requestId:'new-request'})

test('pending calendar proposals remain explicitly unsaved data outside the saved agenda',()=>{
 const raw={message:refinement,pendingProposal:pending(),events,clientNow:Date.parse('2026-09-08T15:00Z'),clientTimezone:'America/Santiago'}
 const normalized=sanitizeNovaRequest(raw)
 assert.equal(normalized.error,undefined)
 assert.equal(normalized.body.pendingProposal.status,'not_saved')
 assert.equal(normalized.body.pendingProposal.id,proposalId)
 assert.equal(normalized.body.events.length,1)
 assert.ok(normalized.body.events.every(event=>event.id==='football-event'))
 assert.equal(sanitizePendingProposal(pending(),events).status,'not_saved')
})

test('an explicit refinement returns a complete replacement proposal, with preserved subjects and durations',()=>{
 const out=validate(wirePlan(revisedActions(),{mode:'proposal'}))
 assert.equal(out.validation.ok,true,JSON.stringify(out.validation))
 assert.equal(out.mode,'proposal');assert.equal(out.replacesProposalId,proposalId)
 assert.deepEqual(out.actions,[]);assert.equal(out.proposed_actions.length,2)
 assert.deepEqual(out.proposed_actions.map(action=>action.event.title),['Focus','Gym'])
 assert.equal(out.proposed_actions[0].event.endTime,'5:00 PM')
 assert.equal(out.proposed_actions[1].event.endTime,'6:00 PM')
})

test('chat, missing context and a new objective do not inherit or replace a pending proposal',()=>{
 const chat=validate(wirePlan([],{userConfirmationText:'Podemos revisarlo.'}),'¿Qué significa esto?')
 assert.equal(chat.validation.ok,true);assert.equal(chat.replacesProposalId,undefined)
 assert.equal(activePendingProposal('¿Qué significa esto?',pending(),events),null)
 const missing=validate(wirePlan(revisedActions(),{mode:'proposal'}),refinement,null)
 assert.equal(missing.validation.ok,false);assert.equal(missing.replacesProposalId,undefined)
 const next='Agrega dentista mañana a las 11'
 const independent=validate(wirePlan([wireAction({type:'create_event',title:'Dentista',dateISO:dateContext.tomorrow,time:'11:00',sourceText:next})]),next)
 assert.equal(independent.validation.ok,true,JSON.stringify(independent.validation))
 assert.equal(independent.replacesProposalId,undefined);assert.equal(independent.mode,'chat_with_action')
 const inherited=validate(wirePlan(revisedActions(next),{mode:'proposal'}),next)
 assert.equal(inherited.validation.ok,false);assert.equal(inherited.replacesProposalId,undefined)
})

test('proposal context cannot authorize deletion, task changes or memory writes',()=>{
 const forbidden=[
  wireAction({type:'delete_event',targetEventId:'football-event',title:'Fútbol',sourceText:refinement}),
  wireAction({type:'save_memory',memoryKey:'preferencia',memoryValue:'Estudiar por la tarde',memoryCategory:'preference',sourceText:refinement}),
  wireAction({type:'create_task',title:'Comprar pan',sourceText:refinement}),
 ]
 for(const action of forbidden){
  const out=validate(wirePlan([...revisedActions(),action],{mode:'proposal'}))
  assert.equal(out.validation.ok,false);assert.equal(out.replacesProposalId,undefined)
  assert.equal(out.actions.length+out.proposed_actions.length,0)
 }
})

test('draft actions never become IDs of saved events for edits or deletes',()=>{
 const action=wireAction({type:'edit_event',title:'Focus',targetEventId:`${proposalId}:0`,time:'14:00',dateISO:dateContext.tomorrow,sourceText:refinement})
 const out=validate(wirePlan([action],{mode:'proposal'}))
 assert.equal(out.validation.ok,false);assert.equal(out.replacesProposalId,undefined)
 assert.equal(out.actions.length+out.proposed_actions.length,0)
})

test('a replacement cannot omit a requested activity, shorten its duration or cross the new cutoff',()=>{
 const omitted=revisedActions().slice(1)
 const shortened=revisedActions();shortened[0].durationMinutes=120
 const late=revisedActions();late[0].time='18:00';late[1].time='16:00'
 for(const actions of [omitted,shortened,late]){
  const out=validate(wirePlan(actions,{mode:'proposal'}))
  assert.equal(out.validation.ok,false,JSON.stringify(out))
  assert.equal(out.replacesProposalId,undefined);assert.equal(out.actions.length+out.proposed_actions.length,0)
 }
})

test('refinement preserves fixed saved events rather than converting them into movable draft blocks',()=>{
 const moved=wireAction({type:'edit_event',title:'Fútbol',targetEventId:'football-event',dateISO:dateContext.tomorrow,time:'18:00',durationMinutes:120,sourceText:refinement})
 const out=validate(wirePlan([...revisedActions(),moved],{mode:'proposal'}))
 assert.equal(out.validation.ok,false);assert.equal(out.replacesProposalId,undefined)
})

test('malformed, destructive or memory proposal context is dropped before prompting',()=>{
 for(const mutation of [
  p=>{p.id=''},p=>{p.originalRequest=''},p=>{p.actions=[]},
  p=>{p.actions=[{type:'delete_event',id:'football-event'}]},
  p=>{p.actions=[{type:'save_memory',memory:{key:'x',value:'y'}}]},
  p=>{p.actions=[{type:'edit_event',id:'unknown-draft',updates:{time:'3:00 PM'}}]},
 ]){const p=pending();mutation(p);assert.equal(sanitizePendingProposal(p,events),null)}
})

test('refining a cutoff cannot silently change the date of the original pending batch',()=>{
 const actions=revisedActions();actions.forEach(action=>{action.dateISO=dateContext.dayAfter})
 const out=validate(wirePlan(actions,{mode:'proposal'}))
 assert.equal(out.validation.ok,false);assert.equal(out.replacesProposalId,undefined)
 assert.equal(out.actions.length+out.proposed_actions.length,0)
})

test('a mixed clarification with actions never replaces the draft or becomes a valid contract',()=>{
 const out=validate(wirePlan(revisedActions(),{mode:'clarification',needsClarification:true,
  clarificationQuestion:'¿Prefieres otra hora?',userConfirmationText:'¿Prefieres otra hora?'}))
 assert.equal(out.validation.ok,false)
 assert.equal(out.replacesProposalId,undefined);assert.equal(out.actions.length+out.proposed_actions.length,0)
 const proper=validate(wirePlan([],{mode:'clarification',needsClarification:true,
  clarificationQuestion:'¿Prefieres otra hora?',userConfirmationText:'¿Prefieres otra hora?'}))
 assert.equal(proper.validation.ok,true);assert.equal(proper.replacesProposalId,undefined)
})

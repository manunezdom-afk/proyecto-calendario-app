import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeNovaRequest, selectNovaRoutes, novaTierRoute, shouldEscalateNova } from '../api/_lib/novaRouter.js'
const classify = message => analyzeNovaRequest({message})
for (const message of ['crear tarea comprar pan','gym mañana a las 7','acuérdame pagar el internet','mueve fútbol para las 8','qué tengo mañana','completa comprar pan','borra mi reunión','recuerda que Cata es mi polola','ando con mil cosas','no sé qué hacer primero']) {
 test(`Luna handles everyday intent: ${message}`,()=>assert.equal(classify(message).tier,'luna'))
}
test('message length alone cannot authorize Terra or Sol',()=>{
 assert.equal(classify('hola '.repeat(700)).tier,'luna')
 assert.equal(analyzeNovaRequest({message:'qué tengo mañana',events:Array.from({length:80},(_,id)=>({id,title:`evento ${id}`}))}).tier,'luna')
})
test('independent instructions and constrained day planning choose Terra',()=>{
 assert.equal(classify('llamar a Juan a las 3, mandar correo a las 4 y gym a las 6').tier,'terra')
 const routes=selectNovaRoutes({message:'mañana tengo prueba, quiero ir al gym, tengo fútbol a las 8 y necesito estudiar mínimo tres horas; ordéname el día'})
 assert.deepEqual(routes.map(route=>route.tier),['terra','sol'])
})
test('weekly multi-objective planning justifies Sol once',()=>{
 const routes=selectNovaRoutes({message:'Organízame toda la semana considerando universidad, gimnasio, Focus, mis pendientes, horas de sueño y que quiero dejar viernes y sábado por la noche libres. Si ves que no alcanza el tiempo, prioriza por importancia y explícame qué moverías.'})
 assert.deepEqual(routes.map(route=>route.model),['gpt-5.6-sol'])
 assert.equal(routes[0].routeReason,'weekly_constraints')
})
test('simple multi-turn edits stay economical',()=>{
 const out=analyzeNovaRequest({message:'a las 11',history:[{role:'user',content:'tengo dentista mañana'},{role:'assistant',content:'¿A qué hora?'}]})
 assert.equal(out.tier,'luna');assert.equal(out.signals.continuation,true)
})
test('bulk deletion risk justifies Terra but not Sol or new deletion authorization',()=>{
 assert.equal(classify('borra todos mis eventos').tier,'terra')
 const routes=selectNovaRoutes({message:'borra todos mis eventos'})
 assert.equal(routes.some(route=>route.tier==='sol'),false)
})
test('caps and reasoning correspond to exact models',()=>{
 assert.deepEqual(['luna','terra','sol'].map(tier=>novaTierRoute(tier).reasoningEffort),['none','low','medium'])
 assert.deepEqual(['luna','terra','sol'].map(tier=>novaTierRoute(tier).maxInputTokens),[12000,18000,24000])
 const old=process.env.AI_NOVA_MAX_TIER
 try {process.env.AI_NOVA_MAX_TIER='luna';assert.deepEqual(selectNovaRoutes({message:'organízame toda la semana con mínimo tres horas de Focus y no antes de las 9'}).map(route=>route.tier),['luna','luna'])}
 finally {if(old===undefined)delete process.env.AI_NOVA_MAX_TIER;else process.env.AI_NOVA_MAX_TIER=old}
})
test('escalation distinguishes repairable output from missing authority or data',()=>{
 const base={route:novaTierRoute('luna'),nextRoute:novaTierRoute('terra'),body:{message:'dentista mañana a las 11 AM'}}
 assert.equal(shouldEscalateNova({...base,error:{code:'invalid_json'}}),true)
 assert.equal(shouldEscalateNova({...base,result:{validation:{ok:false,issues:['low_confidence']}}}),true)
 for(const issue of ['unknown_event','negated_mutation','nonexistent_civil_time','reminder_needs_time','missing_delete_intent']) assert.equal(shouldEscalateNova({...base,result:{validation:{ok:false,issues:[issue]}}}),false)
 assert.equal(shouldEscalateNova({...base,result:{shouldAskUser:true,reply:'¿A qué hora?'}}),true)
 assert.equal(shouldEscalateNova({...base,body:{message:'recuérdame llamar mañana'},result:{shouldAskUser:true,reply:'¿A qué hora?'}}),false)
 for(const status of [400,401,403,429]) assert.equal(shouldEscalateNova({...base,error:{status}}),false)
})

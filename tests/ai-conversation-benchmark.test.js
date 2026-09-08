import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluateConversationConstraints,parseConversationBenchmarkOptions,runConversationBenchmark } from '../scripts/ai-conversation-benchmark.mjs'

const fixture=JSON.parse(readFileSync(new URL('./nova-battery/openai-conversations.json',import.meta.url),'utf8'))
const scenario=id=>fixture.conversations.find(item=>item.id===id)
const block=(title,date,time,endTime)=>({type:'add_event',event:{title,date,time,endTime}})
const row=(id,proposed=[],overrides={})=>({id,attempted:true,httpStatus:200,attempts:[],verdict:{pass:true,fails:[]},
  output:{mode:'proposal',actions:[],proposed_actions:proposed,validation:{ok:true},...overrides}})
const day=()=>row('CONV-DAY',[block('Focus','2026-09-09','10:00 AM','1:00 PM'),block('Gym','2026-09-09','2:00 PM','3:00 PM')])
const week=()=>row('CONV-WEEK',[
  block('Focus','2026-09-14','2:00 PM','4:00 PM'),block('Focus','2026-09-16','1:00 PM','3:00 PM'),block('Focus','2026-09-17','10:00 AM','12:00 PM'),
  block('Gym','2026-09-15','9:00 AM','10:00 AM'),block('Gym','2026-09-18','9:00 AM','10:00 AM'),block('Gym','2026-09-19','9:00 AM','10:00 AM')])

test('wrapper defaults are offline, four cases/users and a maximum fifty-cent budget',()=>{
  const options=parseConversationBenchmarkOptions([])
  assert.equal(options.live,false);assert.equal(options.budget,.50);assert.equal(options.limit,4);assert.equal(options.users,4)
  for(const args of [['--budget','.51'],['--budget','1'],['--budget','.24'],['--limit','100'],['--users','12'],['--live']])assert.throws(()=>parseConversationBenchmarkOptions(args))
  assert.throws(()=>parseConversationBenchmarkOptions(['--base-url','https://evil.invalid']))
})
test('valid day measures exact Focus and gym durations without measuring human quality',()=>{
  const result=evaluateConversationConstraints(scenario('day-with-constraints'),day())
  assert.equal(result.pass,true);assert.equal(result.measurements.focusMinutes,180);assert.equal(result.measurements.gymMinutes,60)
  assert.equal(result.humanConversationScore,null)
})
test('split Focus blocks must total exactly 180 minutes; a partial plan cannot pass',()=>{
  const good=day();good.output.proposed_actions.splice(0,1,block('Focus','2026-09-09','9:00 AM','10:00 AM'),block('Focus','2026-09-09','11:00 AM','1:00 PM'))
  assert.equal(evaluateConversationConstraints(scenario('day-with-constraints'),good).pass,true)
  good.output.proposed_actions[0].event.endTime='9:30 AM'
  assert.ok(evaluateConversationConstraints(scenario('day-with-constraints'),good).fails.includes('focus_duration_not_fulfilled'))
})
test('plans cannot execute automatically, duplicate or move the fixed football event',()=>{
  const data=day(),fixed=scenario('day-with-constraints').runnerCase.events[0]
  data.output.actions.push({type:'edit_event',id:fixed.id,updates:{time:'7:00 PM'}})
  data.output.proposed_actions.push({type:'add_event',event:fixed})
  const result=evaluateConversationConstraints(scenario('day-with-constraints'),data)
  for(const failure of ['proposal_contains_executable_actions','fixed_event_mutated','duplicate_fixed_event','overlaps_fixed_event'])assert.ok(result.fails.includes(failure))
})
test('day checks reject early starts, overlapping blocks and missing ends',()=>{
  const early=day();early.output.proposed_actions[0].event.time='8:00 AM'
  assert.ok(evaluateConversationConstraints(scenario('day-with-constraints'),early).fails.includes('before_earliest_start'))
  const overlap=day();overlap.output.proposed_actions[1].event.time='12:00 PM'
  assert.ok(evaluateConversationConstraints(scenario('day-with-constraints'),overlap).fails.includes('proposal_blocks_overlap'))
  const missing=day();missing.output.proposed_actions[0].event.endTime=null
  assert.ok(evaluateConversationConstraints(scenario('day-with-constraints'),missing).fails.includes('planned_interval_unmeasurable'))
})
test('week accepts an allocation preserving classes, sleep and free evenings',()=>{
  const result=evaluateConversationConstraints(scenario('weekly-constraints'),week())
  assert.equal(result.pass,true);assert.equal(result.measurements.focusMinutes,360);assert.equal(result.measurements.gymSessions,3)
})
test('Friday crossing 19:00 fails even if the block starts before the protected evening',()=>{
  const data=week();data.output.proposed_actions[0]=block('Focus','2026-09-18','6:30 PM','8:30 PM')
  assert.ok(evaluateConversationConstraints(scenario('weekly-constraints'),data).fails.includes('overlaps_protected_evening'))
})
test('overnight plans cannot cross protected sleep or hide missing weekly goals',()=>{
  const data=week();data.output.proposed_actions[0]=block('Focus','2026-09-14','10:30 PM','12:30 AM')
  assert.ok(evaluateConversationConstraints(scenario('weekly-constraints'),data).fails.includes('overlaps_sleep'))
  data.output.proposed_actions.pop()
  assert.ok(evaluateConversationConstraints(scenario('weekly-constraints'),data).fails.includes('gym_session_count_not_fulfilled'))
})
test('information-only conversation rejects memory/task writes without pretending to grade free text',()=>{
  const data=row('CONV-OVERLOADED',[],{mode:'chat_only'})
  assert.equal(evaluateConversationConstraints(scenario('overloaded'),data).pass,true)
  data.output.proposed_actions.push({type:'save_memory',memory:{key:'estado',value:'estresado'}})
  assert.ok(evaluateConversationConstraints(scenario('overloaded'),data).fails.includes('unexpected_write_or_proposal'))
})
test('unexecuted or unsuccessful responses are unmeasured and invalid contracts fail',()=>{
  assert.equal(evaluateConversationConstraints(scenario('weekly-constraints'),null).pass,null)
  assert.equal(evaluateConversationConstraints(scenario('weekly-constraints'),{attempted:true,httpStatus:503}).status,'not_measured')
  const invalid=week();invalid.output.validation.ok=false
  assert.deepEqual(evaluateConversationConstraints(scenario('weekly-constraints'),invalid).fails,['invalid_runtime_contract'])
})
test('delegation calls the existing runner once and preserves its costs, replay, cleanup and grader results',async()=>{
  let calls=0
  const original={status:'completed',reportPath:'/tmp/not-written-conversation-test.json',rows:[day(),week(),row('CONV-OVERLOADED',[],{mode:'chat_only'}),row('CONV-TWO-HOURS',[],{mode:'chat_only'})],
    summary:{recordedRunChargeUSD:.17,replayChecks:4,objectivePass:3},cleanup:{deleted:4,verified:4,pendingSyntheticUserIds:[]}}
  original.rows[0].verdict={pass:false,fails:['original_grader_check']}
  original.rows[1].attempts=[{model:'gpt-5.6-sol'}]
  const result=await runConversationBenchmark(parseConversationBenchmarkOptions([]),{writeReport:false,runner:async(options,deps)=>{
    calls++;assert.equal(options.budget,.5);assert.equal(deps.cases.length,4);assert.ok(deps.cases.every(item=>item.id!=='continuity'));return structuredClone(original)
  }})
  assert.equal(calls,1);assert.deepEqual(result.summary,original.summary);assert.deepEqual(result.cleanup,original.cleanup)
  assert.deepEqual(result.rows[0].verdict,original.rows[0].verdict);assert.equal(result.conversationChecks.allFourMeasuredAndPassed,true)
  assert.equal(result.conversationChecks.solCoverage,'observed_in_remote_attempt');assert.equal(result.conversationChecks.continuityMeasured,false)
})
test('programmatic budget bypass is rejected before invoking the remote runner',async()=>{
  let called=false
  await assert.rejects(()=>runConversationBenchmark({...parseConversationBenchmarkOptions([]),budget:1},{runner:async()=>{called=true}}),/out_of_bounds/)
  assert.equal(called,false)
})
test('real runner offline path makes no network request and leaves every result unmeasured',async()=>{
  const report=await runConversationBenchmark(parseConversationBenchmarkOptions([]),{writeReport:false,env:{},fetchImpl:()=>{throw Error('network_forbidden')}})
  assert.equal(report.status,'not_executed');assert.equal(report.conversationChecks.measured,0)
  assert.equal(report.conversationChecks.constraintPassRate,null);assert.equal(report.conversationChecks.solCoverage,'not_measured')
})

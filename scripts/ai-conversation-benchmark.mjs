#!/usr/bin/env node
// Four independent conversation fixtures. The six-turn scenario is verified in
// the real client separately. Transport, replay, quota pacing and cleanup remain
// owned by the existing remote benchmark; this wrapper never implements them.
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseEnv } from 'node:util'
import { parseRemoteBenchmarkOptions, runRemoteBenchmark, writeAtomicBenchmarkReport } from './ai-remote-benchmark.mjs'
import { validCivilDate } from '../api/_lib/novaContract.js'

const root=fileURLToPath(new URL('../',import.meta.url))
const fixturePath=resolve(root,'tests/nova-battery/openai-conversations.json')
const fixtureSource=readFileSync(fixturePath,'utf8')
const fixture=JSON.parse(fixtureSource)
const scenarios=fixture.conversations.filter(item=>item.runnerCase)
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
const fail=code=>{throw new Error(code)}

export function parseConversationBenchmarkOptions(args=[]) {
  const permittedValues=new Set(['--base-url','--env-file','--budget','--report'])
  for(let index=0;index<args.length;index++) {
    if(['--live','--vercel-cli'].includes(args[index]))continue
    if(!permittedValues.has(args[index]) || !args[index+1] || args[index+1].startsWith('--'))fail('invalid_conversation_option')
    index++
  }
  const options=parseRemoteBenchmarkOptions(['--limit','4','--users','4','--budget','.50','--now',fixture.preparation.fixedNow,...args])
  if(options.budget>.50)fail('conversation_budget_exceeds_050')
  return options
}

function minutes(value) {
  const text=String(value||'').trim()
  let match=/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i.exec(text)
  if(match) {
    const hour=Number(match[1]);if(hour<1 || hour>12)return null
    return (hour%12+(match[3].toUpperCase()==='PM'?12:0))*60+Number(match[2])
  }
  match=/^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text)
  return match?Number(match[1])*60+Number(match[2]):null
}
function civilBase(date) {return validCivilDate(date)?Date.parse(date+'T00:00:00.000Z')/60000:null}
function interval(event) {
  const day=civilBase(event?.date),start=minutes(event?.time),end=minutes(event?.endTime)
  if(day===null || start===null || end===null || end===start)return null
  return {start:day+start,end:day+end+(end<start?1440:0),duration:(end-start+1440)%1440,clockStart:start,date:event.date,title:event.title}
}
const overlaps=(a,b)=>a.start<b.end && b.start<a.end

/** Additive structural checks, never a model judge or a human quality score. */
export function evaluateConversationConstraints(scenario,row) {
  const result={scenarioId:scenario.id,caseId:scenario.runnerCase.id,status:'not_measured',pass:null,fails:[],measurements:{},humanConversationScore:null}
  if(!row?.attempted || row.httpStatus!==200) {result.reason=row?.attempted?'no_successful_response':'not_attempted';return result}
  result.status='measured'
  const output=row.output,rules=scenario.objectiveChecks||{},errors=[]
  if(!Array.isArray(output?.actions) || !Array.isArray(output?.proposed_actions) || output.validation?.ok!==true)return {...result,pass:false,fails:['invalid_runtime_contract']}
  const actions=[...output.actions,...output.proposed_actions]
  if(rules.noActionsOrProposals && actions.length)errors.push('unexpected_write_or_proposal')
  if(rules.mode && output.mode!==rules.mode)errors.push('expected_reviewable_proposal')
  if(rules.executableActionsMustBeEmpty && output.actions.length)errors.push('proposal_contains_executable_actions')
  const fixed=scenario.runnerCase.events||[],fixedIDs=new Set(rules.fixedEventIdsUnchanged||[])
  const fixedIntervals=fixed.map(interval).filter(Boolean),blocks=[]
  for(const action of actions) {
    if(fixedIDs.has(action.id) && action.type!=='add_event')errors.push('fixed_event_mutated')
    if(!['add_event','edit_event'].includes(action.type))continue
    const original=fixed.find(event=>event.id===action.id)
    const event=action.type==='add_event'?action.event:original?{...original,...action.updates}:null
    const block=interval(event)
    if(!block){errors.push('planned_interval_unmeasurable');continue}
    blocks.push(block)
    if(rules.proposalDate && block.date!==rules.proposalDate)errors.push('wrong_proposal_date')
    if(rules.dateRange && (block.date<rules.dateRange[0] || block.date>rules.dateRange[1]))errors.push('outside_requested_week')
    if(rules.earliestNewStart && block.clockStart<minutes(rules.earliestNewStart))errors.push('before_earliest_start')
    if(rules.noDuplicateOfFixedEvents && action.type==='add_event' && fixed.some(item=>item.date===event.date && normalize(item.title)===normalize(event.title)))errors.push('duplicate_fixed_event')
    if(rules.mustNotOverlapFixedEvents && fixedIntervals.some(fixed=>overlaps(block,fixed)))errors.push('overlaps_fixed_event')
    for(const forbidden of rules.blockedIntervals||[]) {
      const day=civilBase(forbidden.date),start=minutes(forbidden.start),end=forbidden.end==='24:00'?1440:minutes(forbidden.end)
      if(day===null || start===null || end===null){errors.push('invalid_fixture_interval');continue}
      if(overlaps(block,{start:day+start,end:day+end}))errors.push('overlaps_protected_evening')
    }
    if(rules.dailySleepBlocked) {
      const [sleepStart,sleepEnd]=rules.dailySleepBlocked.map(minutes)
      const firstDay=Math.floor(block.start/1440)*1440-1440,lastDay=Math.floor(block.end/1440)*1440
      for(let day=firstDay;day<=lastDay;day+=1440) {
        const sleep={start:day+sleepStart,end:day+sleepEnd+(sleepEnd<=sleepStart?1440:0)}
        if(overlaps(block,sleep))errors.push('overlaps_sleep')
      }
    }
  }
  if(rules.newBlocksMustNotOverlapEachOther)for(let index=0;index<blocks.length;index++) {
    if(blocks.slice(index+1).some(other=>overlaps(blocks[index],other)))errors.push('proposal_blocks_overlap')
  }
  const focus=blocks.filter(block=>normalize(block.title).includes('focus'))
  const gym=blocks.filter(block=>/\b(?:gym|gimnasio)\b/.test(normalize(block.title)))
  const focusMinutes=focus.reduce((sum,block)=>sum+block.duration,0),gymMinutes=gym.reduce((sum,block)=>sum+block.duration,0)
  const requestedFocus=rules.focusTotalMinutes??rules.focusRequestedMinutes
  if(requestedFocus!=null && focusMinutes!==requestedFocus)errors.push('focus_duration_not_fulfilled')
  if(rules.gymTotalMinutes!=null && gymMinutes!==rules.gymTotalMinutes)errors.push('gym_duration_not_fulfilled')
  if(rules.gymRequestedSessions!=null && gym.length!==rules.gymRequestedSessions)errors.push('gym_session_count_not_fulfilled')
  if(rules.gymMinutesPerSession!=null && gym.some(block=>block.duration!==rules.gymMinutesPerSession))errors.push('gym_session_duration_not_fulfilled')
  result.measurements={plannedBlocks:blocks.length,focusMinutes,gymMinutes,gymSessions:gym.length,executableActions:output.actions.length,proposedActions:output.proposed_actions.length}
  result.fails=[...new Set(errors)];result.pass=result.fails.length===0
  result.notAutomaticallyMeasured=['Naturalness, usefulness, emotional acknowledgement, invented claims in free text and completeness of explanations require human review.']
  return result
}

export async function runConversationBenchmark(options,{runner=runRemoteBenchmark,...dependencies}={}) {
  // Validate programmatic callers too, before delegating any live operation.
  if(!Number.isFinite(options.budget) || options.budget<.25 || options.budget>.50)fail('conversation_budget_out_of_bounds')
  if(options.limit!==4 || options.users!==4 || options.now!==fixture.preparation.fixedNow)fail('conversation_fixture_configuration_mismatch')
  const report=await runner(options,{...dependencies,cases:scenarios.map(item=>item.runnerCase)})
  const results=scenarios.map(scenario=>evaluateConversationConstraints(scenario,report.rows.find(row=>row.id===scenario.runnerCase.id)))
  const measured=results.filter(result=>result.status==='measured'),week=report.rows.find(row=>row.id==='CONV-WEEK')
  report.conversationChecks={fixtureSHA256:createHash('sha256').update(fixtureSource).digest('hex'),
    measurementScope:'Four independent synthetic conversations. Structural checks are additional to the unchanged objective grader. No client persistence, six-turn continuity or human conversation quality is measured.',
    results,measured:measured.length,passed:measured.filter(result=>result.pass).length,
    constraintPassRate:measured.length?measured.filter(result=>result.pass).length/measured.length:null,
    allFourMeasuredAndPassed:measured.length===4&&measured.every(result=>result.pass),
    solCoverage:week?.attempts?.some(attempt=>attempt.model==='gpt-5.6-sol')?'observed_in_remote_attempt':week?.attempted?'not_observed':'not_measured',
    humanConversationScore:null,clientPersistenceMeasured:false,continuityMeasured:false}
  if(dependencies.writeReport!==false)writeAtomicBenchmarkReport(report.reportPath,report)
  return report
}

export async function main(args=process.argv.slice(2)) {
  let delegated=false
  try {
    const options=parseConversationBenchmarkOptions(args),env={...process.env}
    if(options.envFile) {
      const path=resolve(options.envFile);if(statSync(path).mode&0o077)fail('env_file_not_private')
      const parsed=parseEnv(readFileSync(path,'utf8'))
      for(const key of ['SUPABASE_URL','VITE_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','VITE_SUPABASE_ANON_KEY','FOCUS_VERCEL_BYPASS'])if(parsed[key])env[key]=parsed[key]
    }
    delegated=true
    const report=await runConversationBenchmark(options,{env,onProgress:progress=>console.log(JSON.stringify(progress))})
    console.log(JSON.stringify({status:report.status,reportPath:report.reportPath,summary:report.summary,conversationChecks:report.conversationChecks,cleanup:report.cleanup},null,2))
    if(report.status==='failed' || report.conversationChecks.results.some(result=>result.pass===false))process.exitCode=1
  } catch {console.error(JSON.stringify({status:delegated?'failed':'not_executed',errorCode:delegated?'conversation_benchmark_failed':'conversation_benchmark_configuration_failed'}));process.exitCode=1}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()

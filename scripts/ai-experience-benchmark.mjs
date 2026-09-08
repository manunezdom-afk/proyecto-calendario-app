#!/usr/bin/env node
// Synthetic utterances from the UX brief. Uses the same admission, real remote
// runtime, original grader, replay, accounting and owned cleanup as the battery.
import {readFileSync,statSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {parseRemoteBenchmarkOptions,runRemoteBenchmark,writeAtomicBenchmarkReport} from './ai-remote-benchmark.mjs'
export const experienceCases = [
 ['salgo a la casa de un amigo en 20',{kind:'event',titleIncludes:['amigo'],timeRelativeMinutes:20,date:'today'},true],
 ['en 20 minutos me voy donde un amigo',{kind:'event',titleIncludes:['amigo'],timeRelativeMinutes:20,date:'today'},true],
 ['en un rato tengo que ir donde el mati',{kindAnyOf:['task','clarify'],allowClarify:true},true],
 ['tipo 8 voy a la casa de la fran',{kind:'event',titleIncludes:['fran'],timeAnyOf:['8:00 PM'],date:'today'},true],
 ['mañana después de almuerzo voy donde un amigo',{kindAnyOf:['task','clarify'],allowClarify:true},true],
 ['a las 9 salgo pa donde la vale',{kind:'event',titleIncludes:['vale'],timeAnyOf:['9:00 PM'],date:'today'},true],
 ['en media hora me voy a fútbol',{kind:'event',titleIncludes:['futbol'],timeRelativeMinutes:30,date:'today'},true],
 ['en 15 tengo que salir al dentista',{kind:'event',titleIncludes:['dentista'],timeRelativeMinutes:15,date:'today'},true],
 ['en 20 minutos me voy a la casa de un amigo',{kind:'event',titleIncludes:['amigo'],timeRelativeMinutes:20,date:'today'},true],
 ['como a las 8 voy a la casa de un amigo',{kind:'event',titleIncludes:['amigo'],timeAnyOf:['8:00 PM'],date:'today'},true],
 ['mañana tengo fútbol a las 6 y acuérdame llevar la camiseta',{kind:'event',titleIncludes:['futbol'],timeAnyOf:['6:00 PM'],date:'tomorrow'},false],
 ['en media hora salgo al dentista',{kind:'event',titleIncludes:['dentista'],timeRelativeMinutes:30,date:'today'},true],
 ['mañana después de almuerzo estudio economía',{kindAnyOf:['task','clarify'],allowClarify:true},true],
].map(([input,expect,noRedundantDetail],index)=>({id:`UX${index+1}`,cat:'informal_semantics',input,expect,noRedundantDetail}))

export function evaluatePresentation(row,c) {
 const actions=[...(row.output?.actions||[]),...(row.output?.proposed_actions||[])]
 const items=actions.map(a=>a.event||a.task||a.updates).filter(Boolean)
 const failures=[]
 for(const item of items) {
  const title=item.title||item.label||''
  if(/\b(?:como|tipo|quizás|quizas|más o menos)\b|\b(?:en \d+|tengo que|me voy)\b/i.test(title))failures.push('conversational_fragment_in_title')
  if(c.noRedundantDetail && item.subtitle?.trim())failures.push('redundant_description')
 }
 if(['UX3','UX5','UX13'].includes(c.id) && actions.some(a=>a.event?.time || a.task?.time))failures.push('invented_exact_time')
 if(c.id==='UX11' && !JSON.stringify(actions).toLowerCase().includes('camiseta'))failures.push('lost_useful_detail')
 return {pass:row.verdict?.pass===true&&failures.length===0,failures,humanNaturalnessScore:null}
}
export async function main(args=process.argv.slice(2)) {
 const options=parseRemoteBenchmarkOptions(['--limit','13','--users','2','--budget','.50',...args])
 if(options.limit!==13 || options.users!==2 || options.budget>.50)throw Error('fixture_bounds_required')
 const env={...process.env}
 if(options.envFile){if(statSync(options.envFile).mode&0o077)throw Error('private_env_required');Object.assign(env,parseEnv(readFileSync(options.envFile,'utf8')))}
 const report=await runRemoteBenchmark(options,{env,cases:experienceCases,onProgress:p=>console.log(JSON.stringify(p))})
 report.presentationChecks=report.rows.map(row=>({id:row.id,...evaluatePresentation(row,experienceCases.find(c=>c.id===row.id))}))
 writeAtomicBenchmarkReport(report.reportPath,report)
 console.log(JSON.stringify({status:report.status,summary:report.summary,presentationChecks:report.presentationChecks,cleanup:report.cleanup}))
 if(report.status==='failed' || report.presentationChecks.some(check=>!check.pass))process.exitCode=1
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()

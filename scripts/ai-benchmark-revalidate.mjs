#!/usr/bin/env node
// Replays recorded model plans through the current validator; never calls an API.
// This is validation regression evidence, not a fresh model benchmark.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { buildDateContext } from '../api/_lib/dateContext.js'
import { validateNovaPlan } from '../api/_lib/novaContract.js'
import { createGrader } from './ai-benchmark-grade.mjs'
const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: node scripts/ai-benchmark-revalidate.mjs input-report.json output-report.json')
const original = JSON.parse(readFileSync(input,'utf8'))
const cases = JSON.parse(readFileSync(new URL('../tests/nova-battery/cases.json',import.meta.url),'utf8')).cases
const dateContext = buildDateContext(Date.parse(original.fixedNow), original.timezone)
const { evaluate, resolveDateToken } = createGrader(dateContext)
const rows = original.rows.filter(row=>row.rawParsed).map(row => {
  const fixture = cases.find(item=>item.id===row.id)
  if (!fixture || fixture.input !== row.input) throw new Error('Fixture no longer matches recorded input')
  const result = validateNovaPlan({ payload:row.rawParsed,userMessage:row.input,history:fixture.history || [],
    events:(fixture.events || []).map(event=>({...event,date:resolveDateToken(event.date)||event.date})),
    tasks:fixture.tasks || [],memories:(fixture.memories || []).map(memory=>typeof memory==='string'?memory:memory.content || ''),
    discussedEventIds:fixture.discussed || [],dateContext,requestId:`offline-${row.id}` })
  return { id:row.id,category:row.category,originalPass:row.verdict.pass,
    verdict:evaluate(fixture,result),validation:result.validation,mode:result.mode }
})
const report={mode:'offline-revalidation',runAt:new Date().toISOString(),source:input,
  validatorSHA256:createHash('sha256').update(readFileSync(new URL('../api/_lib/novaContract.js',import.meta.url))).digest('hex'),
  attempted:rows.length,objectivePass:rows.filter(row=>row.verdict.pass).length,
  improvements:rows.filter(row=>!row.originalPass&&row.verdict.pass).map(row=>row.id),
  regressions:rows.filter(row=>row.originalPass&&!row.verdict.pass).map(row=>row.id),
  limitation:'Recorded model outputs only. No new provider quality, token, cost or latency measurement. Prompt changes have not been applied to these recorded outputs.',rows}
writeFileSync(output,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({...report,rows:undefined},null,2))

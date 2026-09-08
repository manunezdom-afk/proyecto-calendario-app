import { activeIntentText } from './novaContract.js'
import { novaInputTokenLimit, novaOutputTokenLimit } from './novaSafety.js'

export const NOVA_MODEL_TIERS = Object.freeze({
  luna: Object.freeze({ model: 'gpt-5.6-luna', input: 12000, output: 1600, outputCeiling: 2048, reasoningEffort: 'none', timeoutMs: 12000, events: 12, tasks: 12, memories: 4 }),
  terra: Object.freeze({ model: 'gpt-5.6-terra', input: 18000, output: 2400, outputCeiling: 3072, reasoningEffort: 'low', timeoutMs: 18000, events: 24, tasks: 20, memories: 6 }),
  sol: Object.freeze({ model: 'gpt-5.6-sol', input: 24000, output: 3200, outputCeiling: 4096, reasoningEffort: 'medium', timeoutMs: 25000, events: 40, tasks: 30, memories: 8 }),
})
export const NOVA_RUNTIME_MODELS = Object.freeze(Object.values(NOVA_MODEL_TIERS).map(tier => tier.model))
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const matches = (text, pattern) => [...text.matchAll(pattern)].length
const setting = (name, fallback, ceiling) => {
  if (process.env[name] == null) return fallback
  const value = Number(process.env[name])
  if (!Number.isFinite(value) || value <= 0) throw Object.assign(new Error('invalid_tier_configuration'), { code: 'invalid_tier_configuration' })
  return Math.min(Math.floor(value), ceiling)
}

/** Pure, inspectable routing. Length and total stored context are never signals. */
export function analyzeNovaRequest(body = {}) {
  const current = normalize(body.message)
  const text = normalize(activeIntentText(body.message, body.history || []))
  const planning = /\b(?:organiz\w*|orden\w*|planific\w*|reorganiz\w*|distribu\w*|prioriz\w*|armame (?:el|un) (?:dia|plan))\b/.test(text)
  const week = /\b(?:toda la semana|esta semana|proxima semana|semanal|cada dia|lunes a viernes)\b/.test(text)
  const constraints = matches(text, /\b(?:no (?:quiero|puedo|antes|despues)|sin (?:quitar|mover|sacrificar)|al menos|como maximo|minimo|maximo|antes de|despues de|excepto|deja\w*[^,;.]{0,30}libre|prioriza\w*|considerando)\b/g)
  const conflicts = /\b(?:solap\w*|coincid\w*|choc\w*|conflict\w*|contradict\w*|no alcanza|no cabe|no me da el tiempo)\b/.test(text)
  const bulkDestructive = /\b(?:borra\w*|elimina\w*|olvida\w*)[^.!?]{0,60}\b(?:todo|todos|toda|todas|complet[oa])\b/.test(text)
  const actions = matches(text, /\b(?:comprar|pagar|llamar|mandar|enviar|estudiar|gym|gimnasio|futbol|universidad|clase|prueba|reunion|dormir|sueno|trabajar|focus)\b/g)
  const explicitTimes = matches(text, /\b(?:a las?\s*\w+|\d{1,2}:\d{2})\b/g)
  const independentClauses = text.split(/[,;\n]|\s+y\s+/).filter(part => /\b(?:crear?|anota|agrega|mueve|borra|completa|comprar|pagar|llamar|mandar|enviar|estudiar|gym|futbol|reunion|dentista|clase)\b/.test(part)).length
  const references = matches(current, /\b(?:ese|esa|eso|anterior|segundo|primero|ultimo|ambos|los dos|cambialo|muevelo)\b/g)
  const continuation = text !== current
  const relevantItems = [...(body.events || []), ...(body.tasks || [])].filter(item => {
    const words = normalize(item.title || item.label).match(/[a-z]{4,}/g) || []
    return words.some(word => text.includes(word))
  }).length
  const signals = { planning, week, constraints, conflicts, bulkDestructive, independentClauses, explicitTimes, references, continuation, relevantItems }
  const deep = planning && ((week && (constraints >= 2 || actions >= 4 || relevantItems >= 12))
    || (conflicts && constraints >= 2) || (constraints >= 4 && actions >= 4))
  const moderate = planning || conflicts || bulkDestructive || independentClauses >= 3
    || (references >= 2 && (body.history || []).length >= 4)
    || (relevantItems >= 12 && /\b(?:compara|elige|prioriza)\b/.test(text))
  const tier = deep ? 'sol' : moderate ? 'terra' : 'luna'
  const reason = deep ? (week ? 'weekly_constraints' : 'conflicting_constraints')
    : planning ? 'planning' : conflicts ? 'schedule_conflict' : bulkDestructive ? 'bulk_destructive_request' : independentClauses >= 3 ? 'multiple_actions'
      : moderate ? 'contextual_references' : continuation ? 'simple_continuation' : 'everyday_request'
  return { tier, reason, signals, solEligible: deep || (planning && (constraints >= 1 || week || conflicts)) }
}

export function novaTierRoute(tier) {
  const config = NOVA_MODEL_TIERS[tier]
  if (!config) throw Object.assign(new Error('unsupported_model_tier'), { code: 'unsupported_model_tier' })
  const prefix = `AI_NOVA_${tier.toUpperCase()}`
  const input = setting(`${prefix}_MAX_INPUT_TOKENS`, config.input, config.input)
  const output = setting(`${prefix}_MAX_OUTPUT_TOKENS`, config.output, config.outputCeiling)
  return { ...config, provider: 'openai', tier, premium: tier !== 'luna',
    maxInputTokens: Math.min(input, novaInputTokenLimit(config.input)),
    maxOutputTokens: novaOutputTokenLimit(process.env.AI_MAX_OUTPUT_TOKENS ?? output, output, config.outputCeiling) }
}

export function selectNovaRoutes(body = {}) {
  const decision = analyzeNovaRequest(body)
  const maximum = process.env.AI_NOVA_MAX_TIER?.trim().toLowerCase() || 'sol'
  if (!Object.hasOwn(NOVA_MODEL_TIERS, maximum)) throw Object.assign(new Error('invalid_tier_configuration'), { code: 'invalid_tier_configuration' })
  const rank = ['luna', 'terra', 'sol']
  const tier = rank[Math.min(rank.indexOf(decision.tier), rank.indexOf(maximum))]
  const routes = [{ ...novaTierRoute(tier), routeReason: tier === decision.tier ? decision.reason : 'configured_tier_cap', decision }]
  // At most two attempts, and Sol is used at most once. A simple request never
  // reaches Sol even after failure; higher capability is not user authority.
  if (tier === 'luna') routes.push({ ...novaTierRoute(maximum === 'luna' ? 'luna' : 'terra'), routeReason: 'reserved_recovery', decision })
  else if (tier === 'terra' && decision.solEligible && maximum === 'sol') routes.push({ ...novaTierRoute('sol'), routeReason: 'reserved_complex_recovery', decision })
  else if (tier === 'terra') routes.push({ ...novaTierRoute('terra'), routeReason: 'reserved_recovery', decision })
  return routes
}

const structural = new Set(['invalid_json', 'invalid_schema', 'incomplete_output', 'empty_output', 'output_too_large'])
const repairable = new Set(['invalid_schema', 'low_confidence', 'missing_intent_evidence', 'task_with_invented_time'])
/** Missing data, negation, unknown IDs and civil-date errors stay clarifications. */
export function shouldEscalateNova({ error, result, route, nextRoute, body }) {
  if (!nextRoute) return false
  if ([400, 401, 403, 429].includes(error?.status) || error?.code === 'provider_refusal') return false
  if (result?.validation?.ok === false) return result.validation.issues.length > 0
    && result.validation.issues.every(issue => repairable.has(issue))
  if (result?.shouldAskUser) {
    // A model may over-ask a clearly supplied hour. Retry only when the exact
    // missing field it asks for is explicit in this request/active continuation.
    const scope = normalize(activeIntentText(body.message, body.history || []))
    return /\ba que hora\b/.test(normalize(result.reply)) && /\b(?:[012]?\d:[0-5]\d|a las?\s*\d{1,2}\s*(?:am|pm))\b/.test(scope)
  }
  if (result) return false
  return !!error && (structural.has(error.code) || error.status >= 500 || !error.status)
}

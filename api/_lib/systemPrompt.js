import { buildNovaSystemPrompt } from './novaPrompt.js'

// Historical import kept for integrations; every provider shares one contract.
export function buildSystemPrompt({ dateContext = {}, memories = [], ...context } = {}) {
  return buildNovaSystemPrompt({ ...dateContext, ...context,
    memories: memories.map(memory => typeof memory === 'string' ? memory : memory.content).filter(Boolean) })
}

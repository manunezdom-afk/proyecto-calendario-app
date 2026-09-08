import assert from 'node:assert/strict'
import test from 'node:test'
import { wirePlan, wireAction } from './helpers/novaFixtures.js'
import { buildSystemPrompt } from '../api/_lib/systemPrompt.js'
import { buildOpenAISystemPrompt, callOpenAINova, convertOpenAIToBackendResponse } from '../api/_lib/openaiNova.js'
import { callDeepSeekNova } from '../api/_lib/deepseekNova.js'
import { sanitizeNovaRequest } from '../api/_lib/novaSafety.js'
import { ACTION_TYPES, PLANS, messageForLimit } from '../api/_lib/usageLimits.js'

const dateContext = {
  tz: 'America/Santiago', todayISO: '2026-09-07', tomorrow: '2026-09-08',
  dayAfter: '2026-09-09', currentTime24: '10:00', currentTime12: '10:00 AM',
  todayStr: 'lunes, 7 de septiembre de 2026', weekDates: {},
}
const context = {
  events: [{ id: 'event-1', title: 'Reunión Proyecto Nova', subtitle: 'Presentar Nova 2', date: '2026-09-08', time: '15:00' }],
  tasks: [{ id: 'task-1', label: 'Revisar presupuesto Nova', done: false }],
  discussedEventIds: ['event-1'],
}
const memory = 'Nova es el nombre de mi proyecto.'

test('both system prompts identify Hilante while preserving Nova in user context', () => {
  const before = structuredClone(context)
  const prompts = [
    buildSystemPrompt({ dateContext, weatherContext: '', contacts: [], profile: null,
      behavior: null, memories: [{ category: 'fact', content: memory }], ...context }),
    buildOpenAISystemPrompt({ ...dateContext, memories: [memory], ...context }),
  ]
  for (const prompt of prompts) {
    assert.match(prompt, /Eres Hilante, (?:la )?asistente/)
    assert.doesNotMatch(prompt, /Eres Nova,|Nova es una asistente/)
    for (const text of ['Reunión Proyecto Nova', 'Presentar Nova 2', 'Revisar presupuesto Nova', memory]) {
      assert.ok(prompt.includes(text), `user content must remain literal: ${text}`)
    }
  }
  assert.deepEqual(context, before)
})

test('request sanitization preserves incoming Nova text and historical assistant identity', () => {
  const request = {
    message: 'Nova es el proyecto; revisar Nova mañana', ...context,
    userMemories: [memory],
    history: [
      { role: 'user', content: 'Mi proyecto se llama Nova.' },
      { role: 'assistant', content: 'Soy Nova. Puedo ayudarte con tu proyecto Nova.' },
    ],
  }
  const before = structuredClone(request)
  const result = sanitizeNovaRequest(request).body
  assert.equal(result.message, request.message)
  assert.deepEqual(result.history, request.history)
  assert.deepEqual(result.userMemories, request.userMemories)
  assert.equal(result.events[0].title, request.events[0].title)
  assert.equal(result.tasks[0].label, request.tasks[0].label)
  assert.deepEqual(request, before)
})

for (const [provider, call, messagesKey] of [
  ['OpenAI', callOpenAINova, 'input'],
  ['DeepSeek', callDeepSeekNova, 'messages'],
]) {
  test(`${provider} transport keeps Nova in incoming messages without a rename pass`, async () => {
    const previousFetch = globalThis.fetch
    let body
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(options.body)
      return { ok: false, status: 400, text: async () => '' }
    }
    const history = [{ role: 'assistant', content: 'Soy Nova.' },
      { role: 'user', content: 'El proyecto se llama Nova, no lo cambies.' }]
    const message = 'Revisar Proyecto Nova mañana'
    try {
      await assert.rejects(call({ systemPrompt: 'Eres Hilante, la asistente.',
        message, history, apiKey: 'test-no-network' }))
      assert.deepEqual(body[messagesKey].slice(-3), [...history, { role: 'user', content: message }])
      const instructions = body[messagesKey][0].content
      assert.match(Array.isArray(instructions) ? instructions[0].text : instructions, /Eres Hilante/)
    } finally { globalThis.fetch = previousFetch }
  })
}

test('action conversion preserves Nova in user titles and replaces unverified save claims', () => {
  const reply = 'Guardé Revisar Proyecto Nova para mañana.'
  const result = convertOpenAIToBackendResponse({
    userMessage: 'Revisar Proyecto Nova mañana',
    openaiPayload: wirePlan([wireAction({ title: 'Revisar Proyecto Nova',
      sourceText: 'Revisar Proyecto Nova mañana', dateISO: '2026-09-08' })], { userConfirmationText: reply }),
  })
  assert.equal(result.actions[0].task.label, 'Revisar Proyecto Nova')
  assert.doesNotMatch(result.reply, /Guardé/i)
  assert.equal(result.execution_pending, true)
})

test('human quota copy uses Hilante while stored Nova action keys remain compatible', () => {
  assert.equal(ACTION_TYPES.NOVA_MESSAGE, 'nova_message')
  assert.equal(ACTION_TYPES.NOVA_SMART_ACTION, 'nova_smart_action')
  assert.equal(ACTION_TYPES.NOVA_PREMIUM_MESSAGE, 'nova_premium_message')
  for (const type of [ACTION_TYPES.NOVA_MESSAGE, ACTION_TYPES.NOVA_SMART_ACTION, ACTION_TYPES.NOVA_PREMIUM_MESSAGE]) {
    const message = messageForLimit(PLANS.FREE, type)
    assert.match(message, /Hilante/)
    assert.doesNotMatch(message, /Nova/)
  }
})

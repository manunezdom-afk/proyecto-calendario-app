export const wireAction = (fields = {}) => ({ type: 'create_task', title: 'Comprar pan', subtitle: null,
  dateText: '', dateISO: null, time: null, durationMinutes: 0, category: 'otro', reminderOffsetMinutes: null,
  linkedToPreviousEvent: false, confidence: 'high', sourceText: 'comprar pan', targetEventId: null,
  targetTaskId: null, done: null, priority: null, memoryKey: null, memoryValue: null, memoryCategory: null, ...fields })
export const wirePlan = (actions = [], fields = {}) => ({ mode: actions.length ? 'chat_with_action' : 'chat_only',
  actions, needsClarification: false, clarificationQuestion: null, userConfirmationText: '', ...fields })

// Cliente DeepSeek para Nova — proveedor principal BARATO (2026-07-13).
//
// DeepSeek expone una API compatible con OpenAI chat completions en
// https://api.deepseek.com. Diferencias clave vs el path OpenAI (openaiNova.js):
//   - NO hay Structured Outputs con schema estricto: se usa JSON mode
//     (response_format json_object), que exige la palabra "json" y un
//     ejemplo del formato en el prompt. El shape se valida/normaliza acá
//     y el caller reintenta/escala si el JSON viene mal.
//   - El usage devuelve prompt_cache_hit_tokens / prompt_cache_miss_tokens:
//     el system prompt de Nova (~4-6k tokens, idéntico entre requests) suele
//     ser cache hit a $0.0028/1M — 50× más barato que el miss. El costo se
//     calcula cache-aware en estimateDeepSeekCostUSD.
//
// El payload JSON que produce el modelo es EL MISMO contrato que el schema
// de OpenAI (NOVA_OPENAI_SCHEMA) → se reutiliza convertOpenAIToBackendResponse
// sin tocar el cliente iOS.

const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions'
// IDs vigentes (api-docs.deepseek.com/quick_start/pricing, 2026-07-13).
// OJO: 'deepseek-chat' y 'deepseek-reasoner' se deprecan el 2026-07-24.
const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_MAX_OUTPUT_TOKENS = 900
const DEFAULT_TIMEOUT_MS = 45_000
// Tope de input por request (system prompt + historial + mensaje). Sobre el
// tope se recorta historial (lo más viejo primero) — nunca el prompt ni el
// mensaje actual. ~3.5 chars/token es conservador para español.
const DEFAULT_MAX_INPUT_TOKENS = 12_000
const CHARS_PER_TOKEN = 3.5

// Precios USD/1M tokens — verificados en api-docs.deepseek.com/quick_start/
// pricing el 2026-07-13. RE-VERIFICAR si DeepSeek anuncia cambios.
export const DEEPSEEK_PRICING = Object.freeze({
  'deepseek-v4-flash': { input: 0.14, cachedInput: 0.0028, output: 0.28 },
  'deepseek-v4-pro': { input: 0.435, cachedInput: 0.003625, output: 0.87 },
})

/**
 * Costo cache-aware de una respuesta DeepSeek. Si el usage trae el desglose
 * hit/miss lo usa; si no, asume todo cache miss (conservador). Devuelve null
 * si el modelo no está en la tabla — el caller cae al pricing genérico.
 */
export function estimateDeepSeekCostUSD(model, usage) {
  const key = Object.keys(DEEPSEEK_PRICING).find(k => String(model || '').startsWith(k))
  if (!key || !usage) return null
  const p = DEEPSEEK_PRICING[key]
  const promptTokens = Number(usage.prompt_tokens) || 0
  const hit = Number(usage.prompt_cache_hit_tokens) || 0
  const miss = usage.prompt_cache_miss_tokens != null
    ? Number(usage.prompt_cache_miss_tokens) || 0
    : Math.max(0, promptTokens - hit)
  const out = Number(usage.completion_tokens) || 0
  const cost = (miss * p.input + hit * p.cachedInput + out * p.output) / 1_000_000
  return Number(cost.toFixed(6))
}

// ─── Apéndice de formato (JSON mode) ────────────────────────────────────────
// JSON mode NO valida schema: el formato se enseña en el prompt con la forma
// exacta + un ejemplo (requisito documentado de DeepSeek). Es el MISMO
// contrato de NOVA_OPENAI_SCHEMA — si uno cambia, cambiar el otro.

export function buildDeepSeekJsonAppendix(todayISO) {
  return `

═══════════════════════════════════════════════════════════════
FORMATO DE SALIDA (OBLIGATORIO)
═══════════════════════════════════════════════════════════════
Responde EXCLUSIVAMENTE con un objeto JSON válido — sin markdown, sin \`\`\`,
sin texto antes ni después. Forma exacta:

{"actions":[...], "needsClarification":false, "clarificationQuestion":null, "userConfirmationText":"..."}

Cada elemento de "actions" lleva SIEMPRE TODOS estos campos:
- "type": "create_event"|"create_reminder"|"create_task"|"edit_event"|"delete_event"|"save_memory"|"forget_memory"|"chat_only"|"clarify"
- "title": string corto (la acción, no la frase entera)
- "subtitle": string con el detalle/contexto, o null si no hay
- "dateText": string humano ("hoy", "mañana", "el viernes")
- "dateISO": "YYYY-MM-DD" o null
- "time": "HH:MM" en 24h, o null. JAMÁS inventes una hora sin señal del usuario.
- "durationMinutes": entero. 0 si el usuario no dio duración — NUNCA 60 por defecto.
- "category": "personal"|"universidad"|"salud"|"reunion"|"estudio"|"otro"
- "reminderOffsetMinutes": entero o null
- "linkedToPreviousEvent": true|false
- "confidence": "high"|"medium"|"low"
- "sourceText": fragmento del mensaje del usuario que originó esta acción
- "targetEventId": id EXACTO de EVENTOS ACTUALES (solo edit/delete), si no null
- "memoryKey", "memoryValue", "memoryCategory": strings solo en save_memory/forget_memory, si no null

Ejemplo completo (mensaje: "fútbol a las 5 acordarme de llevar la pelota"):
{"actions":[{"type":"create_event","title":"Fútbol","subtitle":"Llevar la pelota","dateText":"hoy","dateISO":"${todayISO}","time":"17:00","durationMinutes":0,"category":"personal","reminderOffsetMinutes":null,"linkedToPreviousEvent":false,"confidence":"high","sourceText":"fútbol a las 5 acordarme de llevar la pelota","targetEventId":null,"memoryKey":null,"memoryValue":null,"memoryCategory":null}],"needsClarification":false,"clarificationQuestion":null,"userConfirmationText":"Listo, agendé Fútbol hoy a las 5 PM con recordatorio de llevar la pelota."}`
}

// ─── Normalización del payload ──────────────────────────────────────────────
// Sin schema estricto el modelo puede omitir campos. Rellenamos defaults para
// que convertOpenAIToBackendResponse (pensado para payload completo) nunca
// vea undefined donde espera null/0/false.

const ACTION_DEFAULTS = Object.freeze({
  type: 'chat_only', title: '', subtitle: null, dateText: '', dateISO: null,
  time: null, durationMinutes: 0, category: 'personal',
  reminderOffsetMinutes: null, linkedToPreviousEvent: false,
  confidence: 'medium', sourceText: '', targetEventId: null,
  memoryKey: null, memoryValue: null, memoryCategory: null,
})

export function normalizeDeepSeekPayload(parsed) {
  const src = parsed && typeof parsed === 'object' ? parsed : {}
  const actions = Array.isArray(src.actions) ? src.actions : []
  return {
    actions: actions
      .filter(a => a && typeof a === 'object')
      .map(a => {
        const out = { ...ACTION_DEFAULTS }
        for (const k of Object.keys(ACTION_DEFAULTS)) {
          if (a[k] !== undefined) out[k] = a[k]
        }
        // durationMinutes puede llegar como string numérico o null — el
        // converter espera entero.
        out.durationMinutes = Number.isFinite(Number(out.durationMinutes)) ? Number(out.durationMinutes) : 0
        return out
      }),
    needsClarification: src.needsClarification === true,
    clarificationQuestion: typeof src.clarificationQuestion === 'string' ? src.clarificationQuestion : null,
    userConfirmationText: typeof src.userConfirmationText === 'string' ? src.userConfirmationText : '',
  }
}

/**
 * Extrae el texto JSON de la respuesta chat-completions. Defensa extra:
 * aunque JSON mode no debería, si el modelo envolvió en fences ```json ...```
 * las quitamos antes de parsear.
 */
export function extractDeepSeekText(data) {
  const raw = data?.choices?.[0]?.message?.content
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    // Limitación documentada: "la API ocasionalmente puede retornar contenido
    // vacío". Lanzamos para que el caller reintente/escale.
    throw new Error('DeepSeek: empty content')
  }
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

// ─── Llamada ────────────────────────────────────────────────────────────────

export async function callDeepSeekNova({
  message,
  systemPrompt,
  model,
  apiKey,
  reqId,
  signal,
  history,
  maxOutputTokens,
}) {
  const approxTokens = (s) => Math.ceil((s?.length || 0) / CHARS_PER_TOKEN)
  const maxInput = Number(process.env.AI_MAX_TOKENS_PER_REQUEST) || DEFAULT_MAX_INPUT_TOKENS

  let historyMessages = Array.isArray(history)
    ? history
        .filter(h => h && typeof h.content === 'string' && h.content.trim().length > 0)
        .slice(-12)
        .map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content }))
    : []

  // Tope de input: recorta historial (lo más viejo primero) hasta caber.
  // El system prompt y el mensaje actual no se tocan.
  const fixedTokens = approxTokens(systemPrompt) + approxTokens(message)
  let historyTokens = historyMessages.reduce((s, m) => s + approxTokens(m.content), 0)
  while (historyMessages.length > 0 && fixedTokens + historyTokens > maxInput) {
    historyTokens -= approxTokens(historyMessages[0].content)
    historyMessages = historyMessages.slice(1)
  }

  const body = {
    model: model || process.env.DEEPSEEK_NOVA_MODEL || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: message },
    ],
    // JSON mode — el prompt ya contiene "JSON" + ejemplo (requisitos DeepSeek).
    response_format: { type: 'json_object' },
    // max_tokens evita el JSON truncado a mitad (recomendación oficial) y es
    // el tope duro de costo de salida por request.
    max_tokens: maxOutputTokens
      || Number(process.env.AI_MAX_OUTPUT_TOKENS)
      || DEFAULT_MAX_OUTPUT_TOKENS,
    // Extracción estructurada, no creatividad: temperatura baja = JSON más
    // estable entre reintentos.
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE) || 0.2,
    stream: false,
  }

  const controller = signal ? null : new AbortController()
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    : null

  try {
    const response = await fetch(DEEPSEEK_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Request-Id': reqId || '',
      },
      body: JSON.stringify(body),
      signal: signal || controller?.signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      const err = new Error(`DeepSeek HTTP ${response.status}: ${errText.slice(0, 200)}`)
      err.status = response.status
      throw err
    }

    return await response.json()
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

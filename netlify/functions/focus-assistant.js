// Adapter Netlify — delega toda la lógica a api/_shared/focusAssistantCore.mjs
// para que Vercel y Netlify respondan idéntico.

import { runFocusAssistant, FocusAssistantError } from '../../api/_shared/focusAssistantCore.mjs'

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method_not_allowed' }) }
  }

  let body
  try { body = JSON.parse(event.body) }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid_json' }) } }

  try {
    const result = await runFocusAssistant({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...body,
    })
    return { statusCode: 200, headers: CORS, body: JSON.stringify(result) }
  } catch (err) {
    if (err instanceof FocusAssistantError) {
      return {
        statusCode: err.status,
        headers: CORS,
        body: JSON.stringify({ error: err.code, ...(err.detail ? { detail: err.detail } : {}) }),
      }
    }
    console.error('[focus-assistant] Error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'internal_error', message: err.message }) }
  }
}

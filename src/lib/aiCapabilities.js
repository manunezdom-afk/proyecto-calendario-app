// No credential or user content accompanies this compatibility check.
export const ASSISTANT_UPDATING_MESSAGE = 'Estamos actualizando Hilante. Tu mensaje sigue aquí; vuelve a intentarlo en un momento.'
const updating = () => Object.assign(new Error(ASSISTANT_UPDATING_MESSAGE), { code: 'assistant_updating' })

export async function fetchWithAICompatibility(url, options = {}, fetchImpl = globalThis.fetch) {
  const target = new URL(url, globalThis.location?.href || 'https://www.usefocus.me')
  let readOnlyContext = false
  try { readOnlyContext = JSON.parse(options.body)?.mode === 'today-context' } catch {}
  if (String(options.method || 'GET').toUpperCase() === 'POST' && target.pathname === '/api/focus-assistant' && !readOnlyContext) {
    const capabilityURL = new URL('/api/ai-capabilities', target.origin)
    try {
      const response = await fetchImpl(capabilityURL.href, { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: options.signal })
      if (response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw updating()
      const data = await response.json()
      if (data?.runtime !== 'focus-openai-v1' || data?.chat_provider !== 'openai') throw updating()
    } catch (error) {
      if (options.signal?.aborted) throw error
      throw updating()
    }
    // Never reuse a successful check across sends or after a deployment rollback.
    if (options.signal?.aborted) throw options.signal.reason || updating()
  }
  return fetchImpl(url, options)
}

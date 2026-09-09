export const ASSISTANT_CONNECTION_MESSAGE = 'No pude conectar. Tu mensaje sigue aquí; vuelve a intentarlo.'
export const ASSISTANT_TIMEOUT_MESSAGE = 'La respuesta tardó demasiado. Tu mensaje sigue aquí; vuelve a intentarlo.'

// Fetch uses different error text across browsers. Keep the logical request
// pending: a lost response does not establish whether the server completed it.
export function assistantTransportFailure(error) {
  const name = String(error?.name || '')
  const code = String(error?.code || '').toLowerCase()
  const message = String(error?.message || '').trim()
  if (['AbortError', 'TimeoutError'].includes(name) || ['timeout', 'etimedout'].includes(code)) {
    return ASSISTANT_TIMEOUT_MESSAGE
  }
  if (['network_error', 'auth_unavailable'].includes(code) || /^failed to fetch$|^load failed$|^network request failed$|^networkerror when attempting to fetch resource\.?$|^the network connection was lost\.?$/i.test(message)) {
    return ASSISTANT_CONNECTION_MESSAGE
  }
  return null
}

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assistantTransportFailure,
  ASSISTANT_CONNECTION_MESSAGE,
  ASSISTANT_TIMEOUT_MESSAGE,
} from '../src/utils/assistantTransportFailure.js'

test('browser fetch failures receive Spanish copy without claiming a saved action', () => {
  for (const message of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'The network connection was lost.']) {
    assert.equal(assistantTransportFailure(new TypeError(message)), ASSISTANT_CONNECTION_MESSAGE)
  }
  assert.equal(assistantTransportFailure({ code: 'network_error' }), ASSISTANT_CONNECTION_MESSAGE)
})

test('actual AbortController and timeout exceptions retain a distinguishable retry message', () => {
  const controller = new AbortController()
  controller.abort()
  assert.equal(assistantTransportFailure(controller.signal.reason), ASSISTANT_TIMEOUT_MESSAGE)
  assert.equal(assistantTransportFailure(new DOMException('The operation timed out.', 'TimeoutError')), ASSISTANT_TIMEOUT_MESSAGE)
  assert.equal(assistantTransportFailure({ code: 'timeout' }), ASSISTANT_TIMEOUT_MESSAGE)
})

test('unavailable auth validation preserves retry copy without requiring a new login', () => {
  const error = Object.assign(new Error('Servicio de autenticación temporalmente no disponible.'), { code: 'auth_unavailable', status: 503 })
  assert.equal(assistantTransportFailure(error), ASSISTANT_CONNECTION_MESSAGE)
  assert.equal(assistantTransportFailure({ code: 'auth_required', status: 401 }), null)
})

test('quota, compatibility and application failures keep their own meaning', () => {
  for (const error of [
    { code: 'quota_exceeded', message: 'Alcanzaste el límite mensual.' },
    { code: 'assistant_updating', message: 'Estamos actualizando Hilante.' },
    new TypeError('Cannot read properties of undefined'),
    new Error('No pude guardar los cambios.'),
    null,
  ]) assert.equal(assistantTransportFailure(error), null)
})

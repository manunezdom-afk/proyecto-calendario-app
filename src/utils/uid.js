// ID único sin colisiones. Usa crypto.randomUUID() donde esté disponible
// (todo iOS 15.4+, Chrome, Firefox). Fallback para contextos muy antiguos.
export function uid(prefix = '') {
  let raw
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    raw = crypto.randomUUID()
  } else {
    raw = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
  return prefix ? `${prefix}-${raw}` : raw
}

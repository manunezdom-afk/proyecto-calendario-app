// Tracker global de modales/sheets abiertos. Los componentes que renderizan
// overlays modales (QuickAddSheet, RecurringMeetingSheet, etc.) llaman a
// pushModal/popModal en mount/unmount. Componentes flotantes como la pastilla
// de Nova o los FABs pueden suscribirse para esconderse mientras haya al
// menos un modal activo — así no se superponen visualmente con el contenido
// del sheet ni reciben taps sobre él.
//
// Implementación deliberadamente trivial: un contador y un set de listeners,
// sin librería ni context. No necesitamos reactividad transversal más allá
// de "¿hay algo abierto?".

const listeners = new Set()
let count = 0

export function pushModal() {
  count += 1
  for (const l of listeners) l(count)
}

export function popModal() {
  count = Math.max(0, count - 1)
  for (const l of listeners) l(count)
}

export function subscribeModalStack(cb) {
  listeners.add(cb)
  // emitimos estado actual al suscribirse para evitar un frame con desync
  cb(count)
  return () => listeners.delete(cb)
}

export function getModalCount() {
  return count
}

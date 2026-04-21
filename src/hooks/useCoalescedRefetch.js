import { useRef, useCallback } from 'react'

/**
 * useCoalescedRefetch — devuelve una función `refetch` que:
 *  · nunca corre dos veces a la vez (evita race conditions por visibility+focus
 *    disparando en paralelo, y que compiten con el refetch de realtime).
 *  · si llega una petición mientras hay una en vuelo, agenda un único rerun al
 *    terminar (dedupe de ráfagas).
 *  · throttle mínimo de 400ms entre calls reales para no martillar Supabase al
 *    volver a la pestaña.
 *
 * @param {Function} fn async function a ejecutar
 */
export function useCoalescedRefetch(fn) {
  const inFlightRef = useRef(false)
  const queuedRef   = useRef(false)
  const lastRunRef  = useRef(0)
  const fnRef       = useRef(fn)
  fnRef.current = fn

  const refetch = useCallback(async (tag = '') => {
    if (inFlightRef.current) {
      queuedRef.current = true
      return
    }
    const now = Date.now()
    const gap = now - lastRunRef.current
    if (gap < 400) {
      queuedRef.current = true
      setTimeout(() => {
        if (queuedRef.current && !inFlightRef.current) {
          queuedRef.current = false
          refetch(tag)
        }
      }, 400 - gap)
      return
    }

    inFlightRef.current = true
    lastRunRef.current = Date.now()
    try {
      await fnRef.current(tag)
    } finally {
      inFlightRef.current = false
      if (queuedRef.current) {
        queuedRef.current = false
        refetch(tag)
      }
    }
  }, [])

  return refetch
}

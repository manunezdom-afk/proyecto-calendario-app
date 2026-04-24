import { useCallback, useRef } from 'react'

// useLongPress
//
// Hook trivial que detecta un long-press sin pelearse con la semántica de
// tap normal. Things 3 y Apple Mail lo usan para revelar un menú de
// acciones rápidas sin que el usuario tenga que abrir el detalle.
//
// Uso:
//   const bind = useLongPress({ onLongPress: () => openMenu() })
//   <div {...bind}>...</div>
//
// Detalles:
//   · delay 500 ms por defecto (igual al sistema nativo de iOS).
//   · Cancela si el usuario se mueve más de MOVE_THRESHOLD (evita dispararse
//     al scrollear). Usa pointer events para funcionar igual en touch y
//     mouse desktop.
//   · Haptic tick ligero al disparar (Android/compatible; en iOS Safari
//     navigator.vibrate no existe y queda silencioso).
//   · Llama preventDefault en el touchstart al disparar para suprimir el
//     menú contextual nativo del navegador.

const MOVE_THRESHOLD = 8

export function useLongPress({ onLongPress, delay = 500, disabled = false }) {
  const timerRef = useRef(null)
  const startRef = useRef(null)
  const firedRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const onPointerDown = useCallback((e) => {
    if (disabled) return
    // Sólo botón primario o touch.
    if (e.button != null && e.button !== 0) return
    firedRef.current = false
    startRef.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 }
    clear()
    timerRef.current = setTimeout(() => {
      firedRef.current = true
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(10) } catch {}
      }
      onLongPress?.(e)
    }, delay)
  }, [disabled, delay, onLongPress, clear])

  const onPointerMove = useCallback((e) => {
    if (!startRef.current || !timerRef.current) return
    const dx = (e.clientX ?? 0) - startRef.current.x
    const dy = (e.clientY ?? 0) - startRef.current.y
    if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
      clear()
    }
  }, [clear])

  const onPointerUp = useCallback(() => { clear() }, [clear])
  const onPointerCancel = useCallback(() => { clear() }, [clear])

  // Si el long-press disparó, cancelamos el click siguiente para evitar que
  // abra el detalle del evento además del menú. Lo hacemos devolviendo un
  // onClickCapture que consuma el evento cuando firedRef esté marcado.
  const onClickCapture = useCallback((e) => {
    if (firedRef.current) {
      e.stopPropagation()
      e.preventDefault()
      firedRef.current = false
    }
  }, [])

  // onContextMenu: en desktop el click derecho también debería abrir el
  // menú, y en touch evita que aparezca el menú nativo del browser (copiar,
  // compartir, etc.) cuando el sistema lo interpreta como long-press.
  const onContextMenu = useCallback((e) => {
    if (disabled) return
    e.preventDefault()
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(10) } catch {}
    }
    onLongPress?.(e)
  }, [disabled, onLongPress])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave: onPointerCancel,
    onClickCapture,
    onContextMenu,
  }
}

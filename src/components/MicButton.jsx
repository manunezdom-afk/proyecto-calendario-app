import { useRef } from 'react'
import { motion } from 'framer-motion'

// Botón de micrófono único para toda la app.
//
// Decisiones de diseño (el usuario pidió una sola versión discreta y consistente):
//   · Tamaño fijo 36×36 sin breakpoints. Antes el mic cambiaba a 48×48 sólido
//     en mobile y a ghost compacto en desktop; JS (matchMedia) y CSS (lg:) se
//     desincronizaban entre Safari/PWA/desktop dando la sensación de "a veces
//     aparece uno, a veces otro". Con un único tamaño + único estilo, no hay
//     rama que divergir.
//   · Idle = ghost (text-Nova + hover sutil); Listening = relleno Nova con
//     ecualizador. Señal visual clara sin shadow exagerado ni ring pulsante.
//   · Sin halo absoluto animado alrededor. Los siblings con `absolute
//     inset-0 scale 1→1.5` provocaban que Safari iOS descartara el click
//     sintético cuando la animación corría entre touchstart y touchend.
//
// Interacción confiable en Safari iOS:
//   · onPointerUp dispara la acción. Funciona con mouse, touch y pen, y no
//     depende del click sintético (que iOS descarta con micro-scrolls).
//   · onTouchEnd con preventDefault actúa como refuerzo en WebKit viejo
//     donde pointer events pueden comportarse raro bajo PWA standalone.
//   · Un ref con timestamp evita doble disparo cuando ambos eventos llegan.
//   · onClick se deja como fallback para accesibilidad (teclado, screen
//     readers, navegación por foco).
export default function MicButton({
  isListening,
  disabled = false,
  onToggle,
  className = '',
}) {
  const lastFireRef = useRef(0)
  const pointerDownRef = useRef(false)

  function fire(e) {
    if (disabled) return
    const now = Date.now()
    if (now - lastFireRef.current < 400) return
    lastFireRef.current = now
    if (e && typeof e.preventDefault === 'function') e.preventDefault()
    onToggle?.()
  }

  function handlePointerDown() {
    pointerDownRef.current = true
  }

  function handlePointerUp(e) {
    if (!pointerDownRef.current) return
    pointerDownRef.current = false
    fire(e)
  }

  function handlePointerCancel() {
    pointerDownRef.current = false
  }

  function handleTouchEnd(e) {
    fire(e)
  }

  function handleClick(e) {
    if (Date.now() - lastFireRef.current < 400) return
    fire(e)
  }

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
      disabled={disabled}
      aria-label={isListening ? 'Detener dictado' : 'Dictar con voz'}
      aria-pressed={isListening}
      className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed ${
        isListening
          ? 'bg-[#7c6bff] text-white'
          : 'text-[#7c6bff] hover:bg-[#7c6bff]/10'
      } ${className}`}
      style={{
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {isListening ? (
        <span
          className="flex h-4 items-end justify-center gap-[3px]"
          aria-hidden="true"
          style={{ pointerEvents: 'none' }}
        >
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="block w-[3px] rounded-full bg-current"
              animate={{ height: ['5px', '14px', '5px'] }}
              transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
            />
          ))}
        </span>
      ) : (
        <span
          className="material-symbols-outlined text-[19px]"
          style={{ pointerEvents: 'none', fontVariationSettings: "'FILL' 1" }}
        >
          mic
        </span>
      )}
    </button>
  )
}

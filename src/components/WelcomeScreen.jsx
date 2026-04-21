import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import NovaOrb from './NovaOrb'
import AuroraBackground, { readContinuity } from './AuroraBackground'

const WELCOME_KEY = 'focus_welcome_last'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 6)  return 'Buenas noches'
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function getSubline({ hasEvents, hasFirstTime }) {
  if (hasFirstTime) return 'Empecemos por hoy.'
  if (hasEvents)    return 'Revisé tu día.'
  return 'Estás aquí.'
}

/**
 * Threshold Scene — la pantalla-firma de entrada.
 * 3 frames en ~1500ms, skippable con tap/tecla en cualquier momento.
 *
 * Frame A (0-450ms):    orbe Nova breath-in
 * Frame B (450-1100ms): frase "{greeting}. {subline}"
 * Frame C (1100-1500ms): fade completo → onEnter
 *
 * No hay barra de progreso, no hay label, no hay nombre extraído del email.
 */
export default function WelcomeScreen({ onEnter, hasEvents = false, hasFirstTime = false }) {
  const greeting = useMemo(getGreeting, [])
  const subline  = useMemo(() => getSubline({ hasEvents, hasFirstTime }), [hasEvents, hasFirstTime])
  const continuity = useMemo(readContinuity, [])
  const [phase, setPhase] = useState('in') // 'in' | 'out'

  // Auto-dismiss en 1500ms. Skippable por tap o tecla → dispara fade corto.
  useEffect(() => {
    const id = setTimeout(() => setPhase('out'), 1500)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    if (phase !== 'out') return
    // Arranca el fade oscuro→claro: removemos los flags que fuerzan bg negro
    // al inicio del exit para que el body pinte el color claro de la app
    // mientras el overlay se transparenta. Transición continua, sin corte.
    try {
      document.documentElement.classList.remove('focus-continuity')
      document.documentElement.classList.remove('focus-dark-boot')
    } catch {}
    const id = setTimeout(() => {
      onEnter?.()
    }, 280)
    return () => clearTimeout(id)
  }, [phase, onEnter])

  useEffect(() => {
    function onKey(e) {
      if (e.defaultPrevented) return
      setPhase('out')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function skip() { setPhase('out') }

  return (
    <motion.div
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      onClick={skip}
      role="button"
      tabIndex={-1}
      aria-label="Saltar bienvenida"
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        background: continuity ? '#0a0a0f' : 'radial-gradient(ellipse at 50% 45%, #14121f 0%, #0a0a0f 70%)',
        cursor: 'pointer',
      }}
    >
      {/* Aurora continuidad con landing */}
      <AuroraBackground variant="threshold" intensity={1} />

      {/* Contenido */}
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <AnimatePresence>
          {phase === 'in' && (
            <motion.div
              key="orb"
              initial={{ scale: 0.78, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.05, opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="mb-10"
            >
              <NovaOrb size={84} ambient />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {phase === 'in' && (
            <motion.h1
              key="line"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="font-headline font-medium text-white"
              style={{
                fontSize: 'clamp(26px, 4.5vw, 34px)',
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
                maxWidth: '20ch',
              }}
            >
              <span style={{ color: 'rgba(255,255,255,0.95)' }}>{greeting}.</span>
              {' '}
              <span style={{ color: 'rgba(255,255,255,0.55)' }}>{subline}</span>
            </motion.h1>
          )}
        </AnimatePresence>
      </div>

      {/* Hint de skip — solo visible después del primer momento */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === 'in' ? 0.35 : 0 }}
        transition={{ delay: 1.0, duration: 0.4 }}
        className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+28px)] left-0 right-0 text-center text-[11px] text-white/40"
        style={{ letterSpacing: '0.08em' }}
      >
        toca para continuar
      </motion.p>
    </motion.div>
  )
}

export function useWelcomeGate() {
  const [show, setShow] = useState(() => {
    try {
      const today = new Date().toISOString().slice(0, 10)
      return localStorage.getItem(WELCOME_KEY) !== today
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (!show) {
      // Si la bienvenida no se va a mostrar, limpiamos el flag de continuidad
      // para que el body vuelva al color surface sin quedarse negro.
      try { document.documentElement.classList.remove('focus-continuity') } catch {}
    }
  }, [show])

  function dismiss() {
    try {
      localStorage.setItem(WELCOME_KEY, new Date().toISOString().slice(0, 10))
    } catch {}
    setShow(false)
  }

  return { show, dismiss }
}

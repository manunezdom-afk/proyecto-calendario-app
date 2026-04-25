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

function getSubline({ firstLaunch, hasEvents, hasFirstTime }) {
  if (firstLaunch) return 'Primero una vuelta rápida.'
  if (hasFirstTime) return 'Empecemos por hoy.'
  if (hasEvents)    return 'Revisé tu día.'
  return 'Estás aquí.'
}

const EASE = [0.22, 1, 0.36, 1]
const ENTER_HOLD_MS = 1900

/**
 * Threshold Scene — la pantalla-firma de entrada.
 * Secuencia coreografiada (~1900ms) y skippable con tap/tecla.
 *
 * 0–500ms:   orbe breath-in + wordmark "FOCUS" emergiendo
 * 300–900ms: saludo (greeting) entra desde abajo
 * 650–1200ms: hairline se expande + subline aparece
 * 1900ms:    fade-out suave hacia la siguiente pantalla
 */
export default function WelcomeScreen({
  onEnter,
  hasEvents = false,
  hasFirstTime = false,
  firstLaunch = false,
  keepDarkBootOnExit = false,
}) {
  const greeting = useMemo(getGreeting, [])
  const subline  = useMemo(
    () => getSubline({ firstLaunch, hasEvents, hasFirstTime }),
    [firstLaunch, hasEvents, hasFirstTime],
  )
  const continuity = useMemo(readContinuity, [])
  const [phase, setPhase] = useState('in') // 'in' | 'out'

  useEffect(() => {
    const id = setTimeout(() => setPhase('out'), ENTER_HOLD_MS)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    if (phase !== 'out') return
    // Arranca el fade oscuro→claro: removemos los flags que fuerzan bg negro
    // al inicio del exit para que el body pinte el color claro de la app
    // mientras el overlay se transparenta. Si después viene el onboarding,
    // mantenemos dark-boot para que la secuencia siga oscura y no haya flash.
    try {
      document.documentElement.classList.remove('focus-continuity')
      if (!keepDarkBootOnExit) document.documentElement.classList.remove('focus-dark-boot')
    } catch {}
    const id = setTimeout(() => {
      onEnter?.()
    }, 320)
    return () => clearTimeout(id)
  }, [phase, onEnter, keepDarkBootOnExit])

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
      transition={{ duration: 0.32, ease: EASE }}
      onClick={skip}
      role="button"
      tabIndex={-1}
      aria-label="Saltar bienvenida"
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        background: continuity ? '#0a0a0f' : 'radial-gradient(ellipse at 50% 42%, #15121f 0%, #0a0a0f 70%)',
        cursor: 'pointer',
      }}
    >
      {/* Aurora continuidad con landing */}
      <AuroraBackground variant="threshold" intensity={1} />

      {/* Wordmark superior — ancla de marca, sutil.
          Empieza visible (opacity 0.55) para hacer continuidad con el splash
          inline de index.html, que también lo pinta visible. Sin entrada. */}
      <AnimatePresence>
        {phase === 'in' && (
          <motion.div
            key="wordmark"
            initial={{ opacity: 0.55, y: 0 }}
            animate={{ opacity: 0.55, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="absolute left-0 right-0 text-center select-none"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + clamp(28px, 6vh, 56px))',
            }}
            aria-hidden="true"
          >
            <span
              className="font-headline text-white/70"
              style={{
                fontSize: 'clamp(11px, 1.2vw, 13px)',
                letterSpacing: '0.42em',
                fontWeight: 500,
                textTransform: 'uppercase',
              }}
            >
              Focus
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contenido central */}
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        {/* Orbe — empieza visible (scale 1, opacity 1) para alinearse con el
            splash inline de index.html y hacer el handoff imperceptible. El
            exit sí anima para cerrar la escena con un leve zoom. */}
        <AnimatePresence>
          {phase === 'in' && (
            <motion.div
              key="orb"
              initial={{ scale: 1, opacity: 1 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.06, opacity: 0 }}
              transition={{ duration: 0.32, ease: EASE }}
              className="mb-9 sm:mb-10"
            >
              <NovaOrb size={typeof window !== 'undefined' && window.innerWidth >= 640 ? 96 : 84} ambient />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {phase === 'in' && (
            <motion.h1
              key="greeting"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ delay: 0.30, duration: 0.55, ease: EASE }}
              className="font-headline font-medium text-white"
              style={{
                fontSize: 'clamp(28px, 5vw, 38px)',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
                maxWidth: '18ch',
                color: 'rgba(255,255,255,0.96)',
              }}
            >
              {greeting}.
            </motion.h1>
          )}
        </AnimatePresence>

        {/* Hairline — marca premium sutil entre saludo y subline */}
        <AnimatePresence>
          {phase === 'in' && (
            <motion.div
              key="hairline"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 0.7 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.65, duration: 0.5, ease: EASE }}
              className="mt-5 sm:mt-6 h-px origin-center"
              style={{
                width: 'clamp(36px, 8vw, 56px)',
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
              }}
              aria-hidden="true"
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {phase === 'in' && (
            <motion.p
              key="subline"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ delay: 0.80, duration: 0.55, ease: EASE }}
              className="mt-4 sm:mt-5 font-headline text-white/60"
              style={{
                fontSize: 'clamp(15px, 1.8vw, 18px)',
                letterSpacing: '-0.005em',
                lineHeight: 1.35,
                maxWidth: '22ch',
                fontWeight: 400,
              }}
            >
              {subline}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Hint de skip — aparece tarde, pide mínima atención */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === 'in' ? 0.35 : 0 }}
        transition={{ delay: 1.2, duration: 0.5 }}
        className="absolute left-0 right-0 text-center text-[11px] text-white/40 select-none"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + clamp(24px, 4vh, 36px))',
          letterSpacing: '0.08em',
        }}
      >
        toca para continuar
      </motion.p>
    </motion.div>
  )
}

export function useWelcomeGate() {
  // La pantalla de bienvenida (Threshold Scene) aparece SÓLO en el primer
  // uso de la app, igual que apps mainstream (Calendar, Notion, etc.):
  // a partir de ahí abre directo al planner. Antes mostrábamos esto una
  // vez al día comparando la fecha de WELCOME_KEY con hoy; el usuario lo
  // sintió pesado para uso diario.
  //
  // Backward-compat: WELCOME_KEY ya existía con valor de fecha en sesiones
  // anteriores, así que basta con preguntar si tiene CUALQUIER valor para
  // saltar la pantalla a usuarios que ya la vieron una vez. No introducimos
  // una key nueva (provocaría que volvieran a ver la animación tras
  // actualizar). markOnboardingCompleted también escribe en WELCOME_KEY,
  // así que el flujo "primer uso → onboarding → Welcome desaparece" sigue
  // funcionando sin tocar nada más.
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) == null
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

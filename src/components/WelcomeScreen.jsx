import { useEffect, useState, useMemo } from 'react'
import { motion } from 'framer-motion'

const WELCOME_KEY = 'focus_welcome_last'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 6)  return 'Buenas noches'
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

export default function WelcomeScreen({ onEnter, userName }) {
  const greeting = useMemo(getGreeting, [])
  const headline = useMemo(
    () => (userName ? `${greeting}, ${userName}.` : `${greeting}.`),
    [greeting, userName]
  )

  useEffect(() => {
    const id = setTimeout(() => onEnter?.(), 2800)
    return () => clearTimeout(id)
  }, [onEnter])

  return (
    <motion.div
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'linear-gradient(160deg, #0d0d1a 0%, #0a0a14 50%, #0c0812 100%)' }}
    >
      {/* Glow estático detrás del logo — sin animación, sin blur en movimiento */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(99,102,241,0.18) 0%, transparent 70%)',
        }}
      />

      {/* Botón cerrar — SVG inline para evitar FOIT del font Material Symbols */}
      <button
        onClick={onEnter}
        aria-label="Cerrar"
        className="absolute top-5 right-5 z-10 flex h-10 w-10 items-center justify-center rounded-full text-white/30 hover:text-white/60 transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6L18 18M6 18L18 6"/>
        </svg>
      </button>

      {/* Contenido */}
      <div className="relative z-10 flex flex-col items-center px-6 text-center">

        {/* Logo — spring rápido, sin blur */}
        <motion.div
          initial={{ scale: 0.72, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 20, stiffness: 200, delay: 0.05 }}
          className="mb-7"
        >
          <div
            className="w-[72px] h-[72px] rounded-[22px] flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
              boxShadow: '0 8px 32px rgba(99,102,241,0.45)',
            }}
          >
            {/* SVG inline (sparkle) — evita que el splash renderice "brightness_high"
                como texto cuando el font Material Symbols aún no cargó */}
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white" aria-hidden="true">
              <path d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z"/>
              <path d="M19 15L19.8 17.2L22 18L19.8 18.8L19 21L18.2 18.8L16 18L18.2 17.2L19 15Z" opacity="0.7"/>
            </svg>
          </div>
        </motion.div>

        {/* Label */}
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40"
        >
          Focus
        </motion.p>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mb-3 font-headline text-[38px] font-extrabold leading-[1.08] tracking-tight text-white"
        >
          {headline}
        </motion.h1>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.62, duration: 0.45 }}
          className="mb-10 text-[15px] text-white/50 font-medium"
        >
          Menos ruido, más foco.
        </motion.p>

        {/* Barra de progreso */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.0, duration: 0.4 }}
          className="h-[2px] w-28 overflow-hidden rounded-full bg-white/8"
        >
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ delay: 1.0, duration: 1.6, ease: 'easeInOut' }}
            className="h-full w-1/2 rounded-full"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.8), transparent)' }}
          />
        </motion.div>

      </div>
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

  function dismiss() {
    try {
      localStorage.setItem(WELCOME_KEY, new Date().toISOString().slice(0, 10))
    } catch {}
    setShow(false)
  }

  return { show, dismiss }
}

export function WelcomeScreenAuto({ onEnter, userName }) {
  useEffect(() => {
    function onKey(e) {
      if (e.defaultPrevented) return
      onEnter?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEnter])

  return <WelcomeScreen onEnter={onEnter} userName={userName} />
}

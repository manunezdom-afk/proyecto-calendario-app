import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ── WelcomeScreen ───────────────────────────────────────────────────────────
// Pantalla de bienvenida premium inspirada en Linear / Amie / Notion Calendar:
// - Fondo aurora animado (blobs con blur)
// - Tipografía grande con reveal por palabra
// - CTA con shimmer + microinteracción
// - Sólo se muestra una vez por día

const WELCOME_KEY = 'focus_welcome_last'

// Determina un saludo según la hora local
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

  // Animación escalonada de palabras
  const headlineWords = headline.split(' ')
  const taglineWords = 'Menos ruido, más foco.'.split(' ')

  // Auto-dismiss: la bienvenida dura lo que tarda la animación en completarse
  // (~3.5s). No requiere interacción del usuario — se cierra sola. En mobile
  // no hay teclado, y es más elegante que apretar un botón al inicio.
  useEffect(() => {
    const id = setTimeout(() => { onEnter?.() }, 3500)
    return () => clearTimeout(id)
  }, [onEnter])

  return (
    <motion.div
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#0a0a0f]"
    >
      {/* ── Aurora Background ─────────────────────────────────────────────── */}
      <AuroraBackground />

      {/* ── Noise overlay (textura sutil) ─────────────────────────────────── */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* ── Skip button ──────────────────────────────────────────────────── */}
      <button
        onClick={onEnter}
        aria-label="Cerrar"
        className="absolute top-5 right-5 z-10 flex h-10 w-10 items-center justify-center rounded-full text-white/40 transition-all hover:bg-white/5 hover:text-white/80"
      >
        <span className="material-symbols-outlined text-[20px]">close</span>
      </button>

      {/* ── Contenido central ────────────────────────────────────────────── */}
      <div className="relative z-10 flex w-full max-w-[540px] flex-col items-center px-6 text-center">
        {/* Logo animado */}
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 18, stiffness: 140, delay: 0.1 }}
          className="mb-8 flex items-center justify-center"
        >
          <LogoOrb />
        </motion.div>

        {/* Marca */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mb-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/50"
        >
          Focus
        </motion.p>

        {/* Headline (reveal por palabra) */}
        <h1 className="mb-5 font-headline text-[40px] font-extrabold leading-[1.05] tracking-tight text-white md:text-[52px]">
          {headlineWords.map((word, i) => (
            <motion.span
              key={`h-${i}`}
              initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.55 + i * 0.08, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="mr-2.5 inline-block"
            >
              {word}
            </motion.span>
          ))}
        </h1>

        {/* Tagline */}
        <p className="mb-10 max-w-[380px] text-[15px] leading-relaxed text-white/65 md:text-[17px]">
          {taglineWords.map((word, i) => (
            <motion.span
              key={`t-${i}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.05 + i * 0.06, duration: 0.5 }}
              className="mr-1.5 inline-block"
            >
              {word}
            </motion.span>
          ))}
        </p>

        {/* Pills con features (aparecen después) */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.55, duration: 0.5 }}
          className="mb-10 flex flex-wrap items-center justify-center gap-2"
        >
          {[
            { icon: 'auto_awesome', label: 'Nova IA' },
            { icon: 'bolt', label: 'Tu energía, tu día' },
            { icon: 'inbox', label: 'Cambios con tu aprobación' },
          ].map((p, i) => (
            <motion.div
              key={p.label}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.65 + i * 0.12, type: 'spring', damping: 18, stiffness: 300 }}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11.5px] font-medium text-white/80 backdrop-blur-md"
            >
              <span
                className="material-symbols-outlined text-[13px] text-white/60"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {p.icon}
              </span>
              {p.label}
            </motion.div>
          ))}
        </motion.div>

        {/* Loader tenue — indica que está cargando sin pedir interacción */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.2, duration: 0.6 }}
          className="mt-10 flex flex-col items-center gap-3"
        >
          <div className="h-[2px] w-32 overflow-hidden rounded-full bg-white/10">
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 1.3, ease: 'easeInOut', delay: 2.2 }}
              className="h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-white/70 to-transparent"
            />
          </div>
          <p className="text-[10.5px] uppercase tracking-[0.25em] text-white/30">
            Iniciando tu espacio
          </p>
        </motion.div>
      </div>
    </motion.div>
  )
}

// ── Aurora background animado ───────────────────────────────────────────────
function AuroraBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Base oscura */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0f] via-[#0c0814] to-[#080810]" />

      {/* Blob 1 — azul */}
      <motion.div
        className="absolute h-[480px] w-[480px] rounded-full opacity-55"
        style={{
          background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
        initial={{ x: '-10%', y: '5%' }}
        animate={{ x: ['-10%', '15%', '-10%'], y: ['5%', '30%', '5%'] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Blob 2 — violeta */}
      <motion.div
        className="absolute h-[520px] w-[520px] rounded-full opacity-50"
        style={{
          background: 'radial-gradient(circle, #a855f7 0%, transparent 70%)',
          filter: 'blur(90px)',
          right: '-15%',
          top: '20%',
        }}
        animate={{ x: ['0%', '-15%', '0%'], y: ['0%', '20%', '0%'] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Blob 3 — rosado cálido */}
      <motion.div
        className="absolute h-[400px] w-[400px] rounded-full opacity-40"
        style={{
          background: 'radial-gradient(circle, #ec4899 0%, transparent 70%)',
          filter: 'blur(100px)',
          left: '30%',
          bottom: '-10%',
        }}
        animate={{ x: ['0%', '20%', '0%'], y: ['0%', '-25%', '0%'] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 0%, transparent 40%, rgba(0,0,0,0.4) 100%)',
        }}
      />
    </div>
  )
}

// ── Logo orb con ring animado ──────────────────────────────────────────────
function LogoOrb() {
  return (
    <div className="relative flex items-center justify-center">
      {/* Ring giratorio externo */}
      <motion.div
        className="absolute h-[110px] w-[110px] rounded-full border border-white/10"
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        style={{
          borderTopColor: 'rgba(147, 197, 253, 0.4)',
          borderLeftColor: 'rgba(196, 181, 253, 0.25)',
        }}
      />

      {/* Ring interno pulsante */}
      <motion.div
        className="absolute h-[90px] w-[90px] rounded-full border border-white/5"
        animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Glow */}
      <div
        className="absolute h-[70px] w-[70px] rounded-full blur-xl"
        style={{
          background: 'radial-gradient(circle, rgba(147,197,253,0.5) 0%, transparent 70%)',
        }}
      />

      {/* Logo core */}
      <motion.div
        className="relative flex h-[68px] w-[68px] items-center justify-center rounded-full bg-gradient-to-br from-blue-400 via-violet-500 to-fuchsia-500 shadow-[0_8px_40px_-8px_rgba(147,197,253,0.8)]"
        animate={{ scale: [1, 1.03, 1] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span
          className="material-symbols-outlined text-[32px] text-white"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          brightness_high
        </span>
      </motion.div>
    </div>
  )
}

// ── Hook helper para decidir cuándo mostrar el welcome ─────────────────────
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

// ── Wrapper export that auto-dismisses on any key ──────────────────────────
export function WelcomeScreenAuto({ onEnter, userName }) {
  useEffect(() => {
    function onKey(e) {
      // Evita doble-trigger si el usuario hace clic en el botón
      if (e.defaultPrevented) return
      onEnter?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEnter])

  return <WelcomeScreen onEnter={onEnter} userName={userName} />
}

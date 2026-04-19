import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const TOUR_KEY = 'focus_tour_completed'

/**
 * Hook que controla si mostrar el tour.
 * Se muestra una sola vez por navegador. Después queda oculto para siempre.
 */
export function useOnboardingTour() {
  const [show, setShow] = useState(() => {
    try { return localStorage.getItem(TOUR_KEY) !== '1' } catch { return true }
  })
  const complete = () => {
    try { localStorage.setItem(TOUR_KEY, '1') } catch {}
    setShow(false)
  }
  return { show, complete }
}

// ── Visuals animados para cada slide ────────────────────────────────────────

function NovaProposeVisual() {
  return (
    <div className="relative w-full h-48 flex items-center justify-center">
      {/* Ghost cards detrás */}
      <div className="absolute w-48 h-24 rounded-2xl bg-white/5 border border-white/10" style={{ transform: 'translateY(16px) scale(0.92)' }} />
      <div className="absolute w-48 h-24 rounded-2xl bg-white/10 border border-white/15" style={{ transform: 'translateY(8px) scale(0.96)' }} />
      {/* Card principal */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, type: 'spring', damping: 18 }}
        className="relative w-48 rounded-2xl bg-white p-3 shadow-2xl"
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
          </div>
          <p className="text-[10px] font-bold text-slate-900 leading-tight">Mover reunión → 16h</p>
        </div>
        <div className="flex gap-1.5">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.8, type: 'spring', damping: 14 }}
            className="flex-1 h-6 rounded-full bg-emerald-500 flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-white text-[11px]">check</span>
          </motion.div>
          <div className="h-6 px-2.5 rounded-full border border-slate-200 flex items-center">
            <span className="text-[9px] text-slate-500">✕</span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function RitualVisual() {
  return (
    <div className="relative w-full h-48 flex items-center justify-center gap-3">
      {/* Morning */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="w-20 h-28 rounded-2xl bg-gradient-to-b from-amber-300 to-orange-400 p-2 flex flex-col items-center justify-between"
      >
        <span className="material-symbols-outlined text-white text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>wb_sunny</span>
        <p className="text-[8px] font-bold text-white text-center leading-tight">Morning<br/>Brief</p>
      </motion.div>
      {/* Conector */}
      <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.4 }} className="w-6 h-[2px] bg-white/30 origin-left" />
      {/* Afternoon */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="w-20 h-28 rounded-2xl bg-gradient-to-b from-blue-400 to-indigo-500 p-2 flex flex-col items-center justify-between"
      >
        <span className="material-symbols-outlined text-white text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
        <p className="text-[8px] font-bold text-white text-center leading-tight">Tu pico<br/>de foco</p>
      </motion.div>
      <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.6 }} className="w-6 h-[2px] bg-white/30 origin-left" />
      {/* Evening */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="w-20 h-28 rounded-2xl bg-gradient-to-b from-violet-500 to-fuchsia-600 p-2 flex flex-col items-center justify-between"
      >
        <span className="material-symbols-outlined text-white text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>bedtime</span>
        <p className="text-[8px] font-bold text-white text-center leading-tight">Evening<br/>Shutdown</p>
      </motion.div>
    </div>
  )
}

function LearningVisual() {
  const bars = [40, 55, 30, 75, 90, 70, 50]
  return (
    <div className="relative w-full h-48 flex items-end justify-center gap-2 px-8 pb-4">
      {bars.map((h, i) => (
        <motion.div
          key={i}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ delay: 0.1 + i * 0.08, duration: 0.5, ease: 'easeOut' }}
          style={{ height: `${h}%`, transformOrigin: 'bottom' }}
          className="flex-1 max-w-[28px] rounded-t-lg bg-gradient-to-t from-blue-500 via-violet-500 to-fuchsia-500"
        />
      ))}
      {/* Line label */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1 }}
        className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/10 border border-white/20 backdrop-blur"
      >
        <p className="text-[10px] font-bold text-white">Pico real: 10–12h ✨</p>
      </motion.div>
    </div>
  )
}

function SyncVisual() {
  return (
    <div className="relative w-full h-48 flex items-center justify-center">
      {/* Center Focus hub */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 14 }}
        className="absolute w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 via-violet-500 to-fuchsia-500 flex items-center justify-center shadow-2xl shadow-blue-500/40 z-10"
      >
        <span className="material-symbols-outlined text-white text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>brightness_high</span>
      </motion.div>

      {/* Orbiting calendars */}
      {[
        { label: 'Google', angle: 0,   delay: 0.2 },
        { label: 'Apple',  angle: 120, delay: 0.4 },
        { label: 'Outlook',angle: 240, delay: 0.6 },
      ].map(({ label, angle, delay }) => {
        const rad = (angle * Math.PI) / 180
        const x = Math.cos(rad) * 70
        const y = Math.sin(rad) * 70
        return (
          <motion.div
            key={label}
            initial={{ scale: 0, x: 0, y: 0, opacity: 0 }}
            animate={{ scale: 1, x, y, opacity: 1 }}
            transition={{ delay, type: 'spring', damping: 16 }}
            className="absolute flex flex-col items-center gap-1"
          >
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 backdrop-blur flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-[18px]">calendar_month</span>
            </div>
            <p className="text-[9px] font-bold text-white/70">{label}</p>
          </motion.div>
        )
      })}

      {/* Pulsing ring around center */}
      <motion.div
        initial={{ scale: 1, opacity: 0.5 }}
        animate={{ scale: 2.5, opacity: 0 }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeOut' }}
        className="absolute w-14 h-14 rounded-2xl border-2 border-blue-400"
      />
    </div>
  )
}

function QuickCaptureVisual() {
  return (
    <div className="relative w-full h-48 flex items-center justify-center">
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-[280px] space-y-2"
      >
        {/* Chat bubble de Nova */}
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-fuchsia-500 flex-shrink-0 flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
          </div>
          <div className="rounded-2xl rounded-tl-sm bg-white/10 border border-white/15 backdrop-blur px-3 py-2">
            <p className="text-[11px] text-white leading-tight">¿En qué te ayudo?</p>
          </div>
        </div>
        {/* User message */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="flex justify-end"
        >
          <div className="rounded-2xl rounded-tr-sm bg-white px-3 py-2 max-w-[200px]">
            <p className="text-[11px] text-slate-900 leading-tight">bloqueame 2h de foco mañana</p>
          </div>
        </motion.div>
        {/* Response */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.3 }}
          className="flex items-start gap-2"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-fuchsia-500 flex-shrink-0 flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
          </div>
          <div className="rounded-2xl rounded-tl-sm bg-white/10 border border-white/15 backdrop-blur px-3 py-2">
            <p className="text-[11px] text-white leading-tight">Propuesta: 10–12h mañana ✓</p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}

// ── Slides content ──────────────────────────────────────────────────────────
const SLIDES = [
  {
    id: 'propose',
    eyebrow: 'Modo propuesta',
    title: 'Nova propone. Tú decides.',
    desc: 'Cada cambio pasa por una bandeja que apruebas o rechazas con un tap. Nunca toca tu calendario sin permiso.',
    Visual: NovaProposeVisual,
  },
  {
    id: 'ritual',
    eyebrow: 'Ritual diario',
    title: 'Tu día empieza y termina con claridad.',
    desc: 'Morning Brief al abrir. Evening Shutdown al cerrar. La retención viene del ritual, no del calendario.',
    Visual: RitualVisual,
  },
  {
    id: 'learn',
    eyebrow: 'Aprendizaje implícito',
    title: 'Nova te observa — sin preguntarte nada.',
    desc: 'Aprende tu pico real de energía, tus días fuertes, qué tipo de sugerencias apruebas. Sin formularios.',
    Visual: LearningVisual,
  },
  {
    id: 'sync',
    eyebrow: 'Sincronización viva',
    title: 'Un URL. Todos tus calendarios.',
    desc: 'Google, Apple, Outlook — suscríbelos al feed de Focus una sola vez. Todo cambio se propaga automático.',
    Visual: SyncVisual,
  },
  {
    id: 'chat',
    eyebrow: 'Captura en segundos',
    title: 'Pídele cambios a Nova como a un amigo.',
    desc: 'Lenguaje natural. Sin formularios de "nuevo evento" — solo escribe lo que necesitas.',
    Visual: QuickCaptureVisual,
  },
]

// ── Main component ──────────────────────────────────────────────────────────
export default function OnboardingTour({ onDone }) {
  const [i, setI] = useState(0)

  function next() {
    if (i < SLIDES.length - 1) setI(i + 1)
    else onDone?.()
  }

  function skip() { onDone?.() }

  useEffect(() => {
    // Bloquear scroll del body mientras está abierto
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const slide = SLIDES[i]
  const { Visual } = slide

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[90] overflow-hidden bg-[#0a0a0f] flex flex-col"
    >
      {/* Aurora background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-blue-600/30 blur-[120px]" />
        <div className="absolute top-[30%] -right-40 h-[450px] w-[450px] rounded-full bg-violet-600/25 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-fuchsia-600/20 blur-[120px]" />
      </div>

      {/* Top bar: skip + dots */}
      <div className="relative z-10 flex items-center justify-between p-5">
        <div className="flex gap-1.5">
          {SLIDES.map((_, idx) => (
            <div
              key={idx}
              className={`h-1 rounded-full transition-all ${
                idx === i ? 'w-8 bg-white' : 'w-4 bg-white/20'
              }`}
            />
          ))}
        </div>
        <button
          onClick={skip}
          className="text-white/50 text-[12px] font-semibold hover:text-white/80 transition-colors"
        >
          Saltar
        </button>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35 }}
            className="w-full flex flex-col items-center text-center"
          >
            <Visual />

            <div className="mt-8 space-y-3 max-w-sm">
              <p className="text-[11px] font-bold text-white/50 uppercase tracking-[0.25em]">
                {slide.eyebrow}
              </p>
              <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight tracking-tight font-headline">
                {slide.title}
              </h2>
              <p className="text-[14px] text-white/65 leading-relaxed">
                {slide.desc}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer: next button */}
      <div className="relative z-10 p-6 pb-10 max-w-md mx-auto w-full">
        <button
          onClick={next}
          className="w-full py-4 rounded-2xl bg-white text-slate-900 font-bold text-[14px] flex items-center justify-center gap-2 shadow-2xl shadow-blue-500/20 hover:shadow-blue-500/40 transition-all active:scale-[0.98]"
        >
          {i < SLIDES.length - 1 ? 'Siguiente' : 'Empezar'}
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      </div>
    </motion.div>
  )
}

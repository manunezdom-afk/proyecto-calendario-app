import { useEffect, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import NovaOrb from './NovaOrb'
import AuroraBackground from './AuroraBackground'

const ONBOARDING_KEY = 'focus_onboarding_completed_v1'
const WELCOME_KEY = 'focus_welcome_last'

export function hasCompletedOnboarding() {
  try { return localStorage.getItem(ONBOARDING_KEY) === '1' } catch { return false }
}

export function markOnboardingCompleted() {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1')
    // Marcar también el welcome del día para no encadenar dos pantallas oscuras.
    localStorage.setItem(WELCOME_KEY, new Date().toISOString().slice(0, 10))
    // Evitar que el hint genérico "soy Nova…" aparezca justo después — ya lo
    // explicamos en el tutorial. El hint accionable de día vacío sí aparece.
    localStorage.setItem('focus_hint_welcome-intro-v1', '1')
  } catch {}
}

export function resetOnboarding() {
  try {
    localStorage.removeItem(ONBOARDING_KEY)
    localStorage.removeItem(WELCOME_KEY)
    localStorage.removeItem('focus_hint_welcome-intro-v1')
  } catch {}
}

/**
 * Hook-gate para el onboarding.
 * Muestra si todavía no se completó. Una vez completado, no vuelve a aparecer.
 */
export function useOnboardingGate() {
  const [show, setShow] = useState(() => !hasCompletedOnboarding())

  const complete = useCallback(() => {
    markOnboardingCompleted()
    setShow(false)
  }, [])

  useEffect(() => {
    if (show) return
    try { document.documentElement.classList.remove('focus-dark-boot') } catch {}
  }, [show])

  return { show, complete }
}

// ── Ilustraciones por slide ──────────────────────────────────────────────────
// Animadas, livianas, sin imágenes externas. Firmamos la marca con el orbe.

function SlideIllustrationHero() {
  // Hero del tutorial — continuidad con el splash. El splash ya muestra un
  // orbe centrado, así que aquí arrancamos con el orbe visible (opacity 1,
  // scale 1) en vez de fade-in: el usuario no ve el frame vacío previo que
  // parecía una segunda pantalla de carga. Solo el halo amplio hace fade
  // sutil para dar vida sin romper la continuidad.
  return (
    <div className="relative flex h-[220px] w-full items-center justify-center">
      <motion.div
        aria-hidden="true"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 0.8, scale: 1 }}
        transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: 'absolute',
          width: 260, height: 260, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,107,255,0.28) 0%, rgba(124,107,255,0) 65%)',
          filter: 'blur(12px)',
        }}
      />
      <NovaOrb size={110} ambient />
    </div>
  )
}

function PlannerCard({ time, title, color, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 rounded-2xl border px-3.5 py-2.5"
      style={{
        background: 'rgba(20, 18, 36, 0.75)',
        borderColor: 'rgba(255,255,255,0.08)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          width: 4, height: 28, borderRadius: 2, background: color,
          boxShadow: `0 0 10px ${color}`,
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold tracking-wide text-white/45">{time}</div>
        <div className="truncate text-[13.5px] font-semibold text-white/90">{title}</div>
      </div>
      <div
        className="h-5 w-5 rounded-full border"
        style={{ borderColor: 'rgba(255,255,255,0.2)' }}
      />
    </motion.div>
  )
}

function SlideIllustrationPlanner() {
  return (
    <div className="relative flex h-[220px] w-full items-center justify-center px-4">
      <div className="w-full max-w-[300px] space-y-2">
        <PlannerCard time="09:00" title="Revisar informe Q2"     color="#22d3ee" delay={0.05} />
        <PlannerCard time="11:30" title="Reunión con Ana"        color="#3b82f6" delay={0.18} />
        <PlannerCard time="14:00" title="Tarea: enviar propuesta" color="#ec4899" delay={0.31} />
        <PlannerCard time="16:00" title="Clase de español"       color="#0ea5e9" delay={0.44} />
      </div>
    </div>
  )
}

function Pill({ icon, label, color, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 whitespace-nowrap"
      style={{
        background: 'rgba(20, 18, 36, 0.85)',
        borderColor: `${color}55`,
        boxShadow: `0 0 20px ${color}33`,
      }}
    >
      <span
        className="material-symbols-outlined flex-shrink-0"
        style={{ fontSize: 16, color, fontVariationSettings: "'FILL' 1" }}
      >
        {icon}
      </span>
      <span className="text-[12.5px] font-semibold text-white/85">{label}</span>
    </motion.div>
  )
}

function SlideIllustrationTasksEvents() {
  // Layout flex para que en iPhone narrow no se corte ningún label. Antes
  // las pills estaban absolute con x=±110 y el texto "Eventos"/"Recordatorios"
  // se recortaba contra el borde cuando la pantalla era angosta. Ahora fila
  // superior con Tareas · orbe · Eventos (gap acotado), abajo Recordatorios
  // centrado. whitespace-nowrap en las pills garantiza que el texto nunca
  // se parta en dos líneas.
  return (
    <div className="relative flex h-[220px] w-full flex-col items-center justify-center gap-3 px-2">
      <div className="flex items-center justify-center gap-3">
        <Pill icon="check_box" label="Tareas" color="#ec4899" delay={0.1} />
        <motion.div
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="flex-shrink-0"
        >
          <NovaOrb size={42} ambient />
        </motion.div>
        <Pill icon="event" label="Eventos" color="#3b82f6" delay={0.25} />
      </div>
      <Pill icon="alarm" label="Recordatorios" color="#22d3ee" delay={0.45} />
    </div>
  )
}

function SlideIllustrationNova() {
  // Layout: flex row con gap — el orbe queda a la izquierda y la burbuja
  // a la derecha, sin solaparse. Antes la burbuja estaba `absolute` con
  // `left-1/2 ml-6` pero el orbe de 84px (radio 42) invadía esos 24 px de
  // margen y se veía montado sobre el círculo. El flex elimina eso y se
  // adapta a cualquier ancho sin choques.
  return (
    <div className="relative h-[220px] w-full">
      <div className="absolute inset-0 flex items-center justify-center gap-4 px-3">
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="flex-shrink-0"
        >
          <NovaOrb size={76} pulse ambient />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: -10, y: 8 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          transition={{ delay: 0.4, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative max-w-[210px] rounded-2xl rounded-bl-md border px-3.5 py-2.5"
          style={{
            background: 'rgba(20, 18, 36, 0.92)',
            borderColor: 'rgba(34, 211, 238, 0.32)',
          }}
        >
          <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-white/40">
            Nova propone
          </div>
          <div className="text-[12.5px] leading-snug text-white/90">
            Tu reunión pisa el evento de las 11. ¿La muevo a las 15?
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.9, duration: 0.35 }}
              className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
              style={{ background: 'var(--nova)' }}
            >
              Aprobar
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.05, duration: 0.35 }}
              className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-white/60"
              style={{ borderColor: 'rgba(255,255,255,0.15)' }}
            >
              Descartar
            </motion.div>
          </div>
        </motion.div>
      </div>

      {/* Nota sutil reforzando el principio */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 0.55, y: 0 }}
        transition={{ delay: 1.2, duration: 0.5 }}
        className="absolute bottom-1 left-0 right-0 text-center text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/40"
      >
        Nunca mueve nada sin tu confirmación
      </motion.div>
    </div>
  )
}

function SlideIllustrationStart() {
  return (
    <div className="relative flex h-[220px] w-full items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative"
      >
        <NovaOrb size={96} pulse ambient />
        {/* Marcas de inicio — checkmark con entrada tardía */}
        <motion.div
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="absolute -right-3 -top-3 flex h-10 w-10 items-center justify-center rounded-full"
          style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            boxShadow: '0 0 24px rgba(34,197,94,0.5)',
          }}
        >
          <span
            className="material-symbols-outlined text-white"
            style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}
          >
            check
          </span>
        </motion.div>
      </motion.div>
    </div>
  )
}

// ── Definición de slides ────────────────────────────────────────────────────

const SLIDES = [
  {
    id: 'hero',
    illustration: <SlideIllustrationHero />,
    eyebrow: 'Bienvenido',
    title: 'Focus es tu día, con una IA a tu lado.',
    body: 'Nova ve tu calendario, te ayuda a organizarlo y crea al momento. Cualquier cambio lo puedes deshacer en un toque.',
  },
  {
    id: 'planner',
    illustration: <SlideIllustrationPlanner />,
    eyebrow: 'El planner',
    title: 'Tu día en una sola vista.',
    body: 'Eventos y tareas en la misma línea de tiempo. Ves qué sigue y qué puedes mover.',
  },
  {
    id: 'tasks',
    illustration: <SlideIllustrationTasksEvents />,
    eyebrow: 'Todo junto',
    title: 'Tareas y eventos, sin apps aparte.',
    body: 'Lo que quieres hacer y el tiempo para hacerlo, en el mismo lugar. Nova también te recuerda los dos.',
  },
  {
    id: 'nova',
    illustration: <SlideIllustrationNova />,
    eyebrow: 'Nova',
    title: 'Actúa rápido. Tú siempre mandas.',
    body: 'Nova crea eventos, tareas y bloques al instante. Cada acción trae un "Deshacer" visible y puedes editarlo después sin perder ritmo.',
  },
  {
    id: 'start',
    illustration: <SlideIllustrationStart />,
    eyebrow: 'Listo',
    title: 'Armamos tu primer día.',
    body: 'Añade una tarea o evento, o pídele a Nova que organice tu día. Tu día arranca aquí.',
    cta: 'Empezar',
  },
]

// ── Componente principal ────────────────────────────────────────────────────

export default function FirstLaunchOnboarding({ onDone }) {
  const [index, setIndex] = useState(0)
  const [leaving, setLeaving] = useState(false)
  // `firstMount` se pone false tras el primer render. Lo usamos para que
  // el slide inicial aparezca ya visible (sin el fade de 420 ms), que en
  // iPhone hacía ver una pantalla negra intermedia entre el splash y el
  // tutorial como si hubiera dos cargas seguidas.
  const [firstMount, setFirstMount] = useState(true)
  useEffect(() => { setFirstMount(false) }, [])
  const total = SLIDES.length
  const slide = SLIDES[index]
  const isLast = index === total - 1

  const finish = useCallback(() => {
    if (leaving) return
    // Liberamos el dark-boot al arrancar el fade: mientras el overlay se
    // vuelve transparente, el body de abajo ya pintó el color claro de la
    // app. El resultado es una transición oscuro→claro continua, sin corte.
    try { document.documentElement.classList.remove('focus-dark-boot') } catch {}
    setLeaving(true)
    setTimeout(() => {
      onDone?.()
    }, 360)
  }, [leaving, onDone])

  const next = useCallback(() => {
    if (leaving) return
    if (isLast) { finish(); return }
    setIndex((i) => Math.min(i + 1, total - 1))
  }, [isLast, leaving, finish, total])

  const prev = useCallback(() => {
    if (leaving) return
    setIndex((i) => Math.max(i - 1, 0))
  }, [leaving])

  // Teclado: Enter / Space / flechas avanzan; Esc salta.
  useEffect(() => {
    function onKey(e) {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') { finish(); return }
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, finish])

  // Swipe en móvil.
  const dragHandlers = useMemo(() => ({
    drag: 'x',
    dragConstraints: { left: 0, right: 0 },
    dragElastic: 0.18,
    onDragEnd: (_, info) => {
      const dx = info.offset.x
      if (dx < -60) next()
      else if (dx > 60) prev()
    },
  }), [next, prev])

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[120] flex flex-col"
      style={{
        background: 'radial-gradient(ellipse at 50% 38%, #0e1a36 0%, #06080f 70%)',
        color: 'rgba(255,255,255,0.92)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Bienvenida a Focus"
    >
      <AuroraBackground variant="threshold" intensity={0.85} />

      {/* Top bar: progress + skip */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {SLIDES.map((s, i) => (
            <div
              key={s.id}
              className="h-[3px] rounded-full transition-all duration-500"
              style={{
                width: i === index ? 28 : 14,
                background: i <= index ? 'rgba(124,107,255,0.95)' : 'rgba(255,255,255,0.16)',
              }}
            />
          ))}
        </div>
        {!isLast && (
          <button
            onClick={finish}
            className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white"
          >
            Saltar
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        )}
      </div>

      {/* Contenido */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={firstMount ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md"
            {...dragHandlers}
          >
            <div className="mb-6">{slide.illustration}</div>

            <div className="text-center">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[rgba(124,107,255,0.85)]">
                {slide.eyebrow}
              </div>
              <h1
                className="font-headline"
                style={{
                  fontSize: 'clamp(24px, 5vw, 30px)',
                  lineHeight: 1.18,
                  letterSpacing: '-0.02em',
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.96)',
                }}
              >
                {slide.title}
              </h1>
              <p
                className="mx-auto mt-3 max-w-[34ch]"
                style={{
                  fontSize: '14.5px',
                  lineHeight: 1.55,
                  color: 'rgba(255,255,255,0.64)',
                }}
              >
                {slide.body}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom bar: prev + next/cta */}
      <div className="relative z-10 flex items-center justify-between gap-3 px-5 pb-5 pt-3">
        <button
          onClick={prev}
          disabled={index === 0}
          aria-label="Anterior"
          className="flex h-11 w-11 items-center justify-center rounded-full border text-white/70 transition-all disabled:opacity-0"
          style={{
            borderColor: 'rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.04)',
          }}
        >
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </button>

        <button
          onClick={next}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full px-5 font-semibold text-white transition-transform active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #0891b2 0%, #22d3ee 60%, #67e8f9 100%)',
            boxShadow: '0 10px 30px -10px rgba(34,211,238,0.55)',
            fontSize: '14.5px',
            maxWidth: 320,
          }}
        >
          {isLast ? (slide.cta || 'Empezar') : 'Siguiente'}
          {!isLast && (
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          )}
        </button>

        <div className="h-11 w-11" aria-hidden="true" />
      </div>
    </motion.div>
  )
}

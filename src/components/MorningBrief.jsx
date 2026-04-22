import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { todayISO as getTodayISO } from '../utils/time'
import { splitReminders } from '../utils/reminders'
import AuroraBackground from './AuroraBackground'
import NovaOrb from './NovaOrb'

const EASE = [0.22, 1, 0.36, 1]

function greetingFor(hour) {
  if (hour < 6)  return 'Buenas noches'
  if (hour < 12) return 'Buenos días'
  if (hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function formatDateEyebrow(d = new Date()) {
  const s = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  const [weekday, rest] = s.split(', ')
  const wd = weekday.charAt(0).toUpperCase() + weekday.slice(1)
  const clean = (rest || s).replace(' de ', ' ')
  return `${wd} · ${clean}`
}

function generateBrief({ events, tasks }) {
  const now = new Date()
  const hour = now.getHours()

  const todayISO = getTodayISO()
  const todayEvents = events.filter(e => !e.date || e.date === todayISO)

  // Excluimos recordatorios asociados a un evento principal — no son reuniones
  // independientes y duplicarían la cuenta (el evento padre ya cuenta por sí).
  // Los recordatorios independientes se descartan del filtro de reuniones
  // porque "Recordar llamar a Juan" no es una reunión real.
  const { events: mainEvents } = splitReminders(todayEvents)
  const meetingCount = mainEvents.filter(e =>
    /reuni[oó]n|meeting|llamada|call|sincro|junta/i.test(e.title),
  ).length

  const pendingTasks = tasks.filter(t => !t.done && t.category === 'hoy').length

  // Línea principal corta, una sola frase. Sin "Son las X" — el usuario ya ve la hora.
  const greeting = greetingFor(hour)

  // Resumen compacto (una línea).
  const summaryParts = []
  if (meetingCount > 0) summaryParts.push(`${meetingCount} reunión${meetingCount > 1 ? 'es' : ''}`)
  if (pendingTasks  > 0) summaryParts.push(`${pendingTasks} tarea${pendingTasks > 1 ? 's' : ''}`)
  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : 'Agenda despejada'

  return { greeting, summary, meetingCount, pendingTasks }
}

export default function MorningBrief({
  events = [],
  tasks  = [],
  onStart,
  onDismiss,
  inline = false,
}) {
  const brief = useMemo(() => generateBrief({ events, tasks }), [events, tasks])
  const dateStr = useMemo(() => formatDateEyebrow(), [])

  // Nova no emite voz de salida. El brief se navega solo por botones
  // (arrancamos / rechazar / modificar); el micrófono sigue disponible en
  // NovaWidget para que el usuario hable, pero la app no narra respuestas.

  function handleStart()   { onStart?.() }
  function handleDismiss() { onDismiss?.() }

  // ─── Inline variant: card dentro de Mi Día en desktop ────────────────────
  if (inline) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            <span className="text-[10px] font-bold text-primary">Nova · Brief del día</span>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Cerrar brief"
            className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <p className="text-[15px] leading-relaxed text-slate-800 mb-4">
          {brief.greeting}. <span className="text-slate-500">{brief.summary}.</span>
        </p>

        {(brief.meetingCount > 0 || brief.pendingTasks > 0) && (
          <div className="flex items-center gap-4 mb-4">
            {brief.meetingCount > 0 && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold text-slate-900 tabular-nums">{brief.meetingCount}</span>
                <span className="text-[10px] font-bold text-slate-500">reunion{brief.meetingCount > 1 ? 'es' : ''}</span>
              </div>
            )}
            {brief.pendingTasks > 0 && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold text-slate-900 tabular-nums">{brief.pendingTasks}</span>
                <span className="text-[10px] font-bold text-slate-500">tareas</span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleStart}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-primary hover:bg-primary/90 transition-colors"
          >
            Empezar el día
          </button>
          <button
            onClick={handleDismiss}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
          >
            Más tarde
          </button>
        </div>
      </motion.div>
    )
  }

  // ─── Modal variant: "Primera hora" — apertura premium del día ────────────
  // Dirección: minimalismo sobrio, alto espacio negativo, tipografía con rango
  // tonal claro, una sola acción deseable. El control de voz deja de flotar
  // sobre el hero y pasa a ser una utilidad secundaria muy integrada.
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{
        background: 'radial-gradient(ellipse at 50% 38%, #151325 0%, #07060c 72%)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <AuroraBackground variant="threshold" intensity={0.55} />

      {/* Hairline vertical de marca a la izquierda (muy sutil, solo desktop) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-16 left-8 hidden w-px sm:block"
        style={{ background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.08) 30%, rgba(255,255,255,0.08) 70%, transparent)' }}
      />

      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.22}
        onDragEnd={(_, info) => {
          if (info.offset.y > 140 || info.velocity.y > 600) handleDismiss()
        }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: EASE }}
        className="relative z-10 flex w-full max-w-[420px] flex-col items-center px-6"
      >
        {/* Drag handle minimalista */}
        <div
          aria-hidden="true"
          className="mb-10 h-[3px] w-8 rounded-full bg-white/15"
        />

        {/* Contenido principal */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="flex w-full flex-col items-center"
        >
              {/* Eyebrow — fecha */}
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 0.55, y: 0 }}
                transition={{ delay: 0.05, duration: 0.5, ease: EASE }}
                className="font-nova text-[10.5px] font-medium uppercase text-white/55"
                style={{ letterSpacing: '0.28em' }}
              >
                {dateStr}
              </motion.p>

              {/* Orb — protagonista, bien integrado con negativo */}
              <motion.div
                initial={{ opacity: 0, scale: 0.82 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.12, duration: 0.7, ease: EASE }}
                className="mt-10"
              >
                <NovaOrb size={72} ambient />
              </motion.div>

              {/* Headline — saludo breve, peso medio, tracking tight */}
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.30, duration: 0.55, ease: EASE }}
                className="mt-11 font-headline text-center text-white"
                style={{
                  fontSize: 'clamp(32px, 6.2vw, 42px)',
                  lineHeight: 1.05,
                  letterSpacing: '-0.028em',
                  fontWeight: 500,
                }}
              >
                {brief.greeting}.
              </motion.h1>

              {/* Hairline — ancla de marca entre saludo y resumen */}
              <motion.div
                aria-hidden="true"
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ delay: 0.50, duration: 0.55, ease: EASE }}
                className="mt-6 h-px origin-center"
                style={{
                  width: 'clamp(40px, 9vw, 56px)',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)',
                }}
              />

              {/* Resumen — una línea, tono sobrio, tabular para números */}
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.62, duration: 0.55, ease: EASE }}
                className="mt-5 text-center text-white/72"
                style={{
                  fontSize: 'clamp(15px, 1.6vw, 17px)',
                  letterSpacing: '-0.005em',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {brief.summary}
              </motion.p>

              {/* CTAs — uno deseable, otro retirado */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.02, duration: 0.6, ease: EASE }}
                className="mt-12 flex w-full flex-col items-center gap-4"
              >
                <button
                  onClick={handleStart}
                  className="group relative flex w-full max-w-[320px] items-center justify-center overflow-hidden rounded-full py-3.5 font-semibold text-white transition-transform active:scale-[0.985]"
                  style={{
                    fontSize: '15px',
                    letterSpacing: '-0.005em',
                    background: 'linear-gradient(135deg, #8b7bff 0%, #5b4bd6 100%)',
                    boxShadow: '0 14px 34px -12px rgba(124,107,255,0.55), inset 0 1px 0 rgba(255,255,255,0.18)',
                  }}
                >
                  <span className="relative z-10">Empezar el día</span>
                  {/* sheen sutil on hover */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[100%]"
                  />
                </button>

                <button
                  onClick={handleDismiss}
                  className="py-1.5 text-[13px] font-medium text-white/45 transition-colors hover:text-white/75"
                >
                  Más tarde
                </button>
              </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

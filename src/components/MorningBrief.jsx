import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { todayISO as getTodayISO, parseTimeToDecimal } from '../utils/time'
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

function generateBrief({ events, tasks, profile }) {
  const now = new Date()
  const hour = now.getHours()
  const min  = now.getMinutes()
  const currentDecimal = hour + min / 60

  const inPeak =
    profile?.peakStart != null &&
    currentDecimal >= profile.peakStart &&
    currentDecimal < profile.peakEnd

  const todayISO = getTodayISO()
  const todayEvents = events.filter(e => !e.date || e.date === todayISO)

  const meetingCount = todayEvents.filter(e =>
    /reuni[oó]n|meeting|llamada|call|sincro|junta/i.test(e.title),
  ).length

  const pendingTasks = tasks.filter(t => !t.done && t.category === 'hoy').length

  const peakConflicts =
    profile?.peakStart != null
      ? todayEvents.filter(e => {
          if (!e.time) return false
          const dec = parseTimeToDecimal(e.time)
          if (!dec) return false
          return (
            dec >= profile.peakStart &&
            dec < profile.peakEnd &&
            /reuni[oó]n|meeting|llamada|call|sincro|junta/i.test(e.title)
          )
        })
      : []

  // Línea principal corta, una sola frase. Sin "Son las X" — el usuario ya ve la hora.
  const greeting = greetingFor(hour)

  // Resumen compacto (una línea).
  const summaryParts = []
  if (meetingCount > 0) summaryParts.push(`${meetingCount} reunión${meetingCount > 1 ? 'es' : ''}`)
  if (pendingTasks  > 0) summaryParts.push(`${pendingTasks} tarea${pendingTasks > 1 ? 's' : ''}`)
  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : 'Agenda despejada'

  // Contexto de zona pico (opcional).
  let peakHint = null
  if (inPeak) {
    peakHint = 'Estás en tu zona pico.'
  } else if (profile?.peakStart != null) {
    const minsToP = Math.round((profile.peakStart - currentDecimal) * 60)
    if (minsToP > 0 && minsToP < 240) {
      peakHint = minsToP < 60
        ? `Zona pico en ${minsToP} min`
        : `Zona pico en ${Math.floor(minsToP / 60)} h`
    }
  }

  // Frase para TTS — natural, sin jerarquía visual.
  let speech = `${greeting}. `
  speech += summaryParts.length > 0
    ? `Tienes ${summaryParts.join(' y ').replace(/reunión/, 'reunión').replace(/tareas?/, m => m.includes('s') ? 'tareas pendientes' : 'tarea pendiente')} para hoy. `
    : 'Agenda despejada para hoy. '
  if (peakConflicts.length > 0) {
    speech += peakConflicts.length === 1
      ? `Hay una reunión en tu zona pico.`
      : `Hay ${peakConflicts.length} reuniones en tu zona pico.`
  }

  return { greeting, summary, peakHint, speech, peakConflicts, meetingCount, pendingTasks }
}

export default function MorningBrief({
  events = [],
  tasks  = [],
  profile = null,
  onStart,
  onDismiss,
  onMoveEvent,
  inline = false,
}) {
  const brief = useMemo(() => generateBrief({ events, tasks, profile }), [events, tasks, profile])
  const dateStr = useMemo(() => formatDateEyebrow(), [])
  const [phase, setPhase]   = useState('brief')
  const [muted, setMuted]   = useState(inline) // inline: start muted, no TTS auto
  const [speaking, setSpeaking] = useState(false)
  const srRef     = useRef(null)
  const spokenRef = useRef(false)

  useEffect(() => {
    if (inline || muted || spokenRef.current || !window.speechSynthesis) return
    const timer = setTimeout(() => {
      if (spokenRef.current) return
      spokenRef.current = true
      setSpeaking(true)
      window.speechSynthesis.cancel()

      const speak = () => {
        const utter = new SpeechSynthesisUtterance(brief.speech)
        utter.lang = 'es-ES'
        utter.rate = 1.0
        const voices = window.speechSynthesis.getVoices()
        const esVoice =
          voices.find(v => ['Paulina','Monica','Helena','Laura'].some(n => v.name.includes(n))) ||
          voices.find(v => v.lang.startsWith('es'))
        if (esVoice) utter.voice = esVoice
        utter.onend   = () => setSpeaking(false)
        utter.onerror = () => setSpeaking(false)
        window.speechSynthesis.speak(utter)
      }

      if (window.speechSynthesis.getVoices().length > 0) {
        speak()
      } else {
        window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; speak() }
        setTimeout(speak, 600)
      }
    }, 900)

    return () => clearTimeout(timer)
  }, [muted, inline]) // eslint-disable-line react-hooks/exhaustive-deps

  // ⚠️ La escucha por voz al abrir el MorningBrief fue removida.
  // iOS pedía permiso de micrófono al arrancar la app, sin que el usuario
  // lo pidiera explícitamente. Mala UX. Ahora el micrófono solo se activa
  // cuando tocan el botón del mic en NovaWidget (gesto explícito).
  // El brief se navega por botones (arrancamos / rechazar / modificar).

  function stopSpeech() {
    window.speechSynthesis?.cancel()
    setSpeaking(false)
  }

  function handleStart()   { stopSpeech(); try { srRef.current?.stop() } catch {}; onStart?.() }
  function handleDismiss() { stopSpeech(); try { srRef.current?.stop() } catch {}; onDismiss?.() }
  function handleConflicts()  {
    stopSpeech()
    if (brief.peakConflicts.length > 0) setPhase('conflicts')
  }

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

        <p className="text-[15px] leading-relaxed text-slate-800 mb-1">
          {brief.greeting}. <span className="text-slate-500">{brief.summary}.</span>
        </p>
        {brief.peakHint && (
          <p className="text-[12.5px] text-slate-500 mb-4">{brief.peakHint}</p>
        )}
        {!brief.peakHint && <div className="mb-4" />}

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
        <AnimatePresence mode="wait">
          {phase === 'brief' ? (
            <motion.div
              key="brief"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -6 }}
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

              {/* Hint de zona pico — micro, casi tipográfico */}
              {brief.peakHint && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.55 }}
                  transition={{ delay: 0.78, duration: 0.5, ease: EASE }}
                  className="mt-2.5 text-center text-[12.5px] text-white/55"
                  style={{ letterSpacing: '0.01em' }}
                >
                  {brief.peakHint}
                </motion.p>
              )}

              {/* Chip de conflictos — solo si existen, inline, discreto */}
              {brief.peakConflicts.length > 0 && (
                <motion.button
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.88, duration: 0.5, ease: EASE }}
                  onClick={handleConflicts}
                  className="mt-5 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/10"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: '#f5b35c', boxShadow: '0 0 8px rgba(245,179,92,0.7)' }}
                  />
                  {brief.peakConflicts.length === 1
                    ? '1 reunión en tu zona pico'
                    : `${brief.peakConflicts.length} reuniones en tu zona pico`}
                </motion.button>
              )}

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
          ) : (
            <motion.div
              key="conflicts"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="w-full"
            >
              <div className="mb-6 text-center">
                <p className="font-nova text-[10.5px] font-medium uppercase text-white/50" style={{ letterSpacing: '0.28em' }}>
                  En tu zona pico
                </p>
                <h2
                  className="mt-3 font-headline text-white"
                  style={{
                    fontSize: 'clamp(22px, 4.2vw, 26px)',
                    lineHeight: 1.15,
                    letterSpacing: '-0.02em',
                    fontWeight: 500,
                  }}
                >
                  {brief.peakConflicts.length === 1
                    ? 'Una reunión choca con tu mejor hora.'
                    : `${brief.peakConflicts.length} reuniones chocan con tu mejor hora.`}
                </h2>
              </div>

              <div className="space-y-2">
                {brief.peakConflicts.map(e => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between rounded-2xl px-4 py-3"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div className="min-w-0 pr-3">
                      <p className="truncate text-[14px] font-semibold text-white/90">{e.title}</p>
                      <p className="mt-0.5 text-[11.5px] text-white/45 tabular-nums">{e.time}</p>
                    </div>
                    <button
                      onClick={() => onMoveEvent?.(e.id, { section: 'evening' })}
                      className="flex-shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] font-semibold text-white/85 transition-colors hover:bg-white/10"
                    >
                      Mover
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-col items-center gap-4">
                <button
                  onClick={handleStart}
                  className="w-full max-w-[320px] rounded-full py-3.5 font-semibold text-white transition-transform active:scale-[0.985]"
                  style={{
                    fontSize: '15px',
                    background: 'linear-gradient(135deg, #8b7bff 0%, #5b4bd6 100%)',
                    boxShadow: '0 14px 34px -12px rgba(124,107,255,0.55), inset 0 1px 0 rgba(255,255,255,0.18)',
                  }}
                >
                  Empezar el día
                </button>
                <button
                  onClick={() => setPhase('brief')}
                  className="py-1.5 text-[13px] font-medium text-white/45 transition-colors hover:text-white/75"
                >
                  Volver
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Voz — utilidad secundaria, muy integrada, nunca flotando sobre el hero */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.5 }}
          onClick={() => { setMuted(m => !m); stopSpeech() }}
          aria-label={muted ? 'Activar voz de Nova' : 'Silenciar voz de Nova'}
          aria-pressed={!muted}
          className="mt-8 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-white/35 transition-colors hover:text-white/70"
          style={{ letterSpacing: '0.04em' }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 14, opacity: muted ? 0.6 : 1 }}
          >
            {muted ? 'volume_off' : 'volume_up'}
          </span>
          <span className="font-medium">
            {muted ? 'Activar voz' : speaking ? 'Narrando' : 'Silenciar voz'}
          </span>
        </motion.button>
      </motion.div>
    </motion.div>
  )
}

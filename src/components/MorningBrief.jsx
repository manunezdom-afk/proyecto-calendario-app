import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { todayISO as getTodayISO, parseTimeToDecimal } from '../utils/time'
import AuroraBackground from './AuroraBackground'
import NovaOrb from './NovaOrb'

const SR =
  typeof window !== 'undefined' &&
  (/** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition)

function generateBrief({ events, tasks, profile }) {
  const now = new Date()
  const hour = now.getHours()
  const min  = now.getMinutes()
  const currentDecimal = hour + min / 60
  const timeStr = `${hour}:${String(min).padStart(2, '0')}`

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

  let text = `Son las ${timeStr}. `

  if (inPeak) {
    text += `Estás en plena zona de rendimiento. `
  } else if (profile?.peakStart != null) {
    const minsToP = Math.round((profile.peakStart - currentDecimal) * 60)
    if (minsToP > 0 && minsToP < 240) {
      text += minsToP < 60
        ? `Tu zona pico empieza en ${minsToP} minutos. `
        : `Tu zona pico empieza en ${Math.floor(minsToP / 60)} hora${Math.floor(minsToP / 60) > 1 ? 's' : ''}. `
    }
  }

  const parts = []
  if (meetingCount > 0) parts.push(`${meetingCount} reunión${meetingCount > 1 ? 'es' : ''}`)
  if (pendingTasks  > 0) parts.push(`${pendingTasks} tarea${pendingTasks > 1 ? 's' : ''} pendiente${pendingTasks > 1 ? 's' : ''}`)

  text += parts.length > 0
    ? `Tienes ${parts.join(' y ')} para hoy. `
    : `Agenda despejada hoy. `

  if (peakConflicts.length > 0) {
    text += `${peakConflicts.length === 1 ? '"' + peakConflicts[0].title + '" está' : peakConflicts.length + ' reuniones están'} en tu zona pico — te sugiero moverlas. `
  }

  text += `¿Arrancamos?`

  return { text, peakConflicts, meetingCount, pendingTasks }
}

function useTypewriter(text, msPerChar = 28) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    if (!text) { setShown(''); return }
    setShown('')
    let i = 0
    let timer
    function next() {
      if (i >= text.length) return
      i++
      setShown(text.slice(0, i))
      // pausa un poco más larga tras puntuación
      const last = text[i - 1]
      const extra = /[.!?]/.test(last) ? 220 : /[,;]/.test(last) ? 120 : 0
      timer = setTimeout(next, msPerChar + extra)
    }
    timer = setTimeout(next, 500)
    return () => clearTimeout(timer)
  }, [text, msPerChar])
  return shown
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
  const brief       = generateBrief({ events, tasks, profile })
  const displayText = useTypewriter(brief.text)
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
        const utter = new SpeechSynthesisUtterance(brief.text)
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
  function handleModify()  {
    stopSpeech()
    if (brief.peakConflicts.length > 0) setPhase('conflicts')
    else handleStart()
  }

  const typingDone = displayText.length >= brief.text.length

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

        <p className="text-[15px] leading-relaxed text-slate-800 mb-4">{brief.text}</p>

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
            Sí, arrancamos
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

  // ─── Modal variant: ceremonia matinal — fondo oscuro con aurora ──────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-5"
      style={{ background: 'radial-gradient(ellipse at 50% 30%, #14121f 0%, #0a0a0f 70%)' }}
    >
      <AuroraBackground variant="threshold" intensity={0.7} />
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.25}
        onDragEnd={(_, info) => {
          if (info.offset.y > 140 || info.velocity.y > 600) handleDismiss()
        }}
        initial={{ scale: 0.96, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="flex flex-col items-center mb-6">
          <div className="w-10 h-1 rounded-full bg-white/20 mb-6" aria-hidden />
          <NovaOrb size={56} ambient />
          <p className="mt-4 font-nova text-[11px] text-white/50">
            {new Date().toLocaleDateString('es-ES', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </p>
        </div>

        <div className="absolute top-0 right-0 pt-1">
          <button
            onClick={() => { setMuted(m => !m); stopSpeech() }}
            aria-label={muted ? 'Activar voz' : 'Silenciar voz'}
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">
              {muted ? 'volume_off' : 'volume_up'}
            </span>
          </button>
        </div>

        {/* Brief / Conflicts */}
        <AnimatePresence mode="wait">
          {phase === 'brief' ? (
            <motion.div key="brief" className="mb-6 text-center">
              <p className="font-nova text-[20px] font-medium leading-relaxed text-white/90">
                {displayText}
                {!typingDone && (
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    className="inline-block w-0.5 h-5 bg-nova ml-1 align-middle rounded-full"
                  />
                )}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="conflicts"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3 mb-5"
            >
              <p className="text-[12px] text-white/60 mb-2">
                Reuniones en tu zona pico
              </p>
              {brief.peakConflicts.map(e => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-xl px-4 py-3 bg-white/5 border border-white/10"
                >
                  <div>
                    <p className="text-[13px] text-white/90 font-semibold">{e.title}</p>
                    <p className="text-[11px] text-white/50 mt-0.5">{e.time}</p>
                  </div>
                  <button
                    onClick={() => onMoveEvent?.(e.id, { section: 'evening' })}
                    className="text-[11px] font-bold text-nova-soft border border-nova/40 px-3 py-1.5 rounded-full hover:bg-nova/10 transition-colors"
                  >
                    Mover
                  </button>
                </div>
              ))}
              <button
                onClick={handleStart}
                className="w-full text-[12px] text-white/60 py-2 hover:text-white/80 transition-colors"
              >
                Listo, continuar →
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats strip */}
        {phase === 'brief' && (brief.meetingCount > 0 || brief.pendingTasks > 0) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: typingDone ? 1 : 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center justify-center gap-8 mb-6"
          >
            {brief.meetingCount > 0 && (
              <div className="text-center">
                <p className="text-3xl font-headline font-semibold text-white tabular-nums leading-none">
                  {brief.meetingCount}
                </p>
                <p className="text-[11px] text-white/50 mt-1.5">
                  reuniones
                </p>
              </div>
            )}
            {brief.meetingCount > 0 && brief.pendingTasks > 0 && (
              <div className="w-px h-10 bg-white/15" />
            )}
            {brief.pendingTasks > 0 && (
              <div className="text-center">
                <p className="text-3xl font-headline font-semibold text-white tabular-nums leading-none">
                  {brief.pendingTasks}
                </p>
                <p className="text-[11px] text-white/50 mt-1.5">
                  tareas
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* Action buttons */}
        {phase === 'brief' && (
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: typingDone ? 1 : 0 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col gap-2"
          >
            <button
              onClick={handleStart}
              className="w-full py-3.5 rounded-2xl font-semibold text-[15px] text-white bg-nova hover:bg-nova/90 transition-colors active:scale-[0.98] shadow-lg shadow-nova/30"
            >
              Sí, arrancamos
            </button>
            <div className="flex gap-2">
              {brief.peakConflicts.length > 0 && (
                <button
                  onClick={handleModify}
                  className="flex-1 py-2.5 rounded-2xl text-[13px] font-semibold text-white/80 border border-white/15 hover:bg-white/5 transition-colors"
                >
                  Modificar
                </button>
              )}
              <button
                onClick={handleDismiss}
                className="flex-1 py-2.5 rounded-2xl text-[13px] font-medium text-white/60 hover:text-white/80 hover:bg-white/5 transition-colors"
              >
                Más tarde
              </button>
            </div>
            <p className="mt-1 text-center text-[11px] text-white/30">
              Desliza hacia abajo para cerrar
            </p>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  )
}

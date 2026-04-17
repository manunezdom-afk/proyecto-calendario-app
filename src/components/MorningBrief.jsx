import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const SR =
  typeof window !== 'undefined' &&
  (/** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition)

function getTodayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseTimeToDecimal(timeStr) {
  if (!timeStr) return null
  const m = String(timeStr).match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i)
  if (!m) return null
  let h = parseInt(m[1])
  const min = parseInt(m[2] ?? '0')
  const ap = m[3]?.toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h + min / 60
}

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

  // Meetings inside the peak window
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

  // ─── Build brief text ────────────────────────────────────────────────────
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

// Reveals text word-by-word
function useTypewriter(text, msPerWord = 38) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    if (!text) { setShown(''); return }
    setShown('')
    const words = text.split(' ')
    let i = 0
    let timer
    function next() {
      if (i >= words.length) return
      setShown(words.slice(0, i + 1).join(' '))
      i++
      timer = setTimeout(next, msPerWord)
    }
    timer = setTimeout(next, 500)
    return () => clearTimeout(timer)
  }, [text, msPerWord])
  return shown
}

export default function MorningBrief({
  events = [],
  tasks  = [],
  profile = null,
  onStart,
  onDismiss,
  onMoveEvent,
}) {
  const brief       = generateBrief({ events, tasks, profile })
  const displayText = useTypewriter(brief.text)
  const [phase, setPhase]   = useState('brief')  // 'brief' | 'conflicts'
  const [muted, setMuted]   = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const srRef     = useRef(null)
  const spokenRef = useRef(false)

  // ─── TTS via Web Speech API ────────────────────────────────────────────
  useEffect(() => {
    if (muted || spokenRef.current || !window.speechSynthesis) return
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
  }, [muted]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── SR voice commands ─────────────────────────────────────────────────
  useEffect(() => {
    if (!SR) return
    let r
    try {
      r = new SR()
      r.lang = 'es-ES'
      r.continuous = true
      r.interimResults = false
      r.onresult = (e) => {
        const last = e.results[e.results.length - 1]
        if (!last?.isFinal) return
        const t = last[0].transcript.toLowerCase()
        if      (/\b(s[ií]|arranca|listo|dale|bien|empezar)\b/.test(t)) handleStart()
        else if (/\b(no|luego|despu[eé]s|m[aá]s tarde|espera)\b/.test(t)) handleDismiss()
        else if (/\b(cambia|modifica|mueve|mover)\b/.test(t))             handleModify()
      }
      r.start()
      srRef.current = r
    } catch {}
    return () => { try { r?.stop() } catch {} }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-[200] flex flex-col overflow-hidden"
      style={{ background: '#06080f' }}
    >
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 80% 55% at 50% 55%, rgba(59,130,246,0.07) 0%, transparent 70%)' }}
      />

      {/* Mute toggle */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {SR && (
          <span className="text-[9px] text-white/15 font-bold uppercase tracking-wider">
            Escuchando
          </span>
        )}
        <button
          onClick={() => { setMuted(m => !m); stopSpeech() }}
          className="w-8 h-8 flex items-center justify-center rounded-full text-white/25 hover:text-white/50 transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">
            {muted ? 'volume_off' : 'volume_up'}
          </span>
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-8">

        {/* Nova badge */}
        <div className="flex items-center gap-2">
          <motion.span
            className="material-symbols-outlined text-[13px] text-blue-400/60"
            style={{ fontVariationSettings: "'FILL' 1" }}
            animate={speaking ? { opacity: [0.4, 1, 0.4] } : { opacity: 0.6 }}
            transition={speaking ? { duration: 1.4, repeat: Infinity } : {}}
          >
            auto_awesome
          </motion.span>
          <span className="text-[9px] font-bold uppercase tracking-[0.4em] text-white/20">
            Nova ·{' '}
            {new Date().toLocaleDateString('es-ES', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </span>
        </div>

        {/* Brief / Conflicts */}
        <AnimatePresence mode="wait">
          {phase === 'brief' ? (
            <motion.div key="brief" className="max-w-[280px] text-center">
              <p className="text-[21px] font-light leading-relaxed text-white/85 tracking-tight">
                {displayText}
                {!typingDone && (
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    className="inline-block w-0.5 h-5 bg-blue-400/70 ml-1 align-middle rounded-full"
                  />
                )}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="conflicts"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-xs space-y-3"
            >
              <p className="text-[12px] text-white/35 text-center mb-2">
                Reuniones en tu zona pico
              </p>
              {brief.peakConflicts.map(e => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-xl px-4 py-3"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <div>
                    <p className="text-[13px] text-white/80 font-medium">{e.title}</p>
                    <p className="text-[11px] text-white/25 mt-0.5">{e.time}</p>
                  </div>
                  <button
                    onClick={() => onMoveEvent?.(e.id, { section: 'evening' })}
                    className="text-[11px] font-bold text-blue-400 border border-blue-400/30 px-3 py-1.5 rounded-full hover:bg-blue-400/10 transition-colors"
                  >
                    Mover
                  </button>
                </div>
              ))}
              <button
                onClick={handleStart}
                className="w-full text-[12px] text-white/25 py-2 hover:text-white/40 transition-colors"
              >
                Listo, continuar →
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats strip — fades in after text */}
        {phase === 'brief' && (brief.meetingCount > 0 || brief.pendingTasks > 0) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: typingDone ? 1 : 0 }}
            transition={{ duration: 0.6 }}
            className="flex items-center gap-6"
          >
            {brief.meetingCount > 0 && (
              <div className="text-center">
                <p className="text-3xl font-bold text-white/60 tabular-nums leading-none">
                  {brief.meetingCount}
                </p>
                <p className="text-[9px] text-white/20 uppercase tracking-wider mt-1">
                  reuniones
                </p>
              </div>
            )}
            {brief.meetingCount > 0 && brief.pendingTasks > 0 && (
              <div className="w-px h-8 bg-white/10" />
            )}
            {brief.pendingTasks > 0 && (
              <div className="text-center">
                <p className="text-3xl font-bold text-white/60 tabular-nums leading-none">
                  {brief.pendingTasks}
                </p>
                <p className="text-[9px] text-white/20 uppercase tracking-wider mt-1">
                  tareas
                </p>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Action buttons */}
      {phase === 'brief' && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: typingDone ? 1 : 0 }}
          transition={{ duration: 0.5 }}
          className="px-6 flex flex-col gap-3"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 2.5rem)' }}
        >
          <button
            onClick={handleStart}
            className="w-full py-4 rounded-2xl font-bold text-[15px] text-white transition-transform active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #7c3aed 100%)' }}
          >
            Sí, arrancamos
          </button>
          <div className="flex gap-3">
            {brief.peakConflicts.length > 0 && (
              <button
                onClick={handleModify}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold text-white/45 border border-white/10 hover:bg-white/[0.04] transition-colors"
              >
                Modificar
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="flex-1 py-3 rounded-xl text-[13px] font-medium text-white/25 hover:text-white/40 transition-colors"
            >
              Más tarde
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

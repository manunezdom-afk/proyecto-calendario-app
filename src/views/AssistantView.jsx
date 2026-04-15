import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { parseEvent, prepareEventTranscript } from '../utils/parseEvent'

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
const EXAMPLES = ['Ej: "futbol a las 5"', 'Ej: "reunión mañana a las 10"', 'Ej: "gym a las 6"', 'Ej: "cena a las 8"']

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3.5 backdrop-blur-3xl"
    >
      {[0, 1, 2].map((i) => (
        <motion.div key={i} className="w-2 h-2 rounded-full bg-blue-400"
          animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
        />
      ))}
    </motion.div>
  )
}

export default function AssistantView({ onClose, onAddEvent }) {
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState(null)
  const [listening, setListening] = useState(false)
  const [speechActive, setSpeechActive] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [isThinking, setIsThinking] = useState(false)

  const recognitionRef = useRef(null)
  const silenceTimeoutRef = useRef(null)
  const stopFallbackTimeoutRef = useRef(null)
  const transcriptRef = useRef('')
  const hasProcessedResultRef = useRef(false)
  const stopRequestedRef = useRef(false)
  const listeningRef = useRef(false)
  const inputValueRef = useRef('')
  const interimTextRef = useRef('')

  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % EXAMPLES.length), 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    listeningRef.current = listening
  }, [listening])

  useEffect(() => {
    inputValueRef.current = input
  }, [input])

  useEffect(() => {
    interimTextRef.current = interimText
  }, [interimText])

  function clearSilenceTimeout() {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }
  }

  function clearStopFallbackTimeout() {
    if (stopFallbackTimeoutRef.current) {
      clearTimeout(stopFallbackTimeoutRef.current)
      stopFallbackTimeoutRef.current = null
    }
  }

  function scheduleSilenceTimeout() {
    clearSilenceTimeout()
    silenceTimeoutRef.current = setTimeout(() => {
      if (recognitionRef.current && listeningRef.current) {
        if (transcriptRef.current) {
          commitTranscript(transcriptRef.current)
        } else {
          stopListening(false)
        }
      }
    }, 2000)
  }

  function normalizeTranscript(text) {
    return text.replace(/\s+/g, ' ').trim()
  }

  function handleProcess(text) {
    const normalizedText = normalizeTranscript(text)
    const preparedTranscript = prepareEventTranscript(normalizedText)

    if (!preparedTranscript) {
      setIsThinking(false)
      return
    }

    setIsThinking(true)
    setParsed(null)
    setInput(preparedTranscript)
    setInterimText('')

    setTimeout(() => {
      setParsed(parseEvent(preparedTranscript))
      setIsThinking(false)
    }, 600)
  }

  function commitTranscript(rawTranscript) {
    const transcript = normalizeTranscript(rawTranscript)
    if (!transcript || hasProcessedResultRef.current) return

    hasProcessedResultRef.current = true
    transcriptRef.current = transcript
    clearSilenceTimeout()
    clearStopFallbackTimeout()
    setListening(false)
    setSpeechActive(false)
    setInterimText(transcript)
    handleProcess(transcript)

    const recognition = recognitionRef.current
    if (!recognition) return

    stopRequestedRef.current = true

    try {
      recognition.stop()
      stopFallbackTimeoutRef.current = setTimeout(() => {
        try {
          recognition.abort()
        } catch {
          // noop
        }
      }, 900)
    } catch {
      stopRequestedRef.current = false
    }
  }

  function stopListening(processImmediately = false) {
    const recognition = recognitionRef.current
    if (!recognition) return

    clearSilenceTimeout()
    clearStopFallbackTimeout()
    if (stopRequestedRef.current) return

    stopRequestedRef.current = true
    setListening(false)
    setSpeechActive(false)

    if (processImmediately) {
      const transcript = normalizeTranscript(transcriptRef.current || interimTextRef.current || inputValueRef.current)
      if (transcript) {
        commitTranscript(transcript)
        return
      }
    }

    try {
      recognition.stop()
      stopFallbackTimeoutRef.current = setTimeout(() => {
        if (listeningRef.current) {
          try {
            recognition.abort()
          } catch {
            // noop
          }
        }
      }, 1200)
    } catch {
      stopRequestedRef.current = false
      if (processImmediately && transcriptRef.current) handleProcess(transcriptRef.current)
    }
  }

  function toggleListening() {
    if (!recognitionRef.current || isThinking) return

    if (listening) {
      if (transcriptRef.current || interimTextRef.current) {
        commitTranscript(transcriptRef.current || interimTextRef.current)
      } else {
        stopListening(false)
      }
      return
    }

    transcriptRef.current = ''
    hasProcessedResultRef.current = false
    stopRequestedRef.current = false
    clearSilenceTimeout()
    clearStopFallbackTimeout()
    setParsed(null)
    setInterimText('')
    setSpeechActive(false)

    try {
      recognitionRef.current.start()
    } catch {
      setListening(false)
    }
  }

  useEffect(() => {
    if (!SpeechRecognition) return

    const r = new SpeechRecognition()
    r.lang = 'es-ES'
    r.continuous = false
    r.interimResults = false

    r.onstart = () => {
      stopRequestedRef.current = false
      hasProcessedResultRef.current = false
      setListening(true)
      setSpeechActive(false)
      setIsThinking(false)
      setInterimText('')
      scheduleSilenceTimeout()
    }

    r.onspeechstart = () => {
      setSpeechActive(true)
      clearSilenceTimeout()
    }

    r.onspeechend = () => {
      setSpeechActive(false)
      scheduleSilenceTimeout()
    }

    r.onresult = (e) => {
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        final += e.results[i][0].transcript
      }

      const nextTranscript = normalizeTranscript([transcriptRef.current, final].filter(Boolean).join(' '))
      transcriptRef.current = nextTranscript
      setInterimText(nextTranscript)
      setSpeechActive(false)
      commitTranscript(nextTranscript)
    }

    r.onerror = () => {
      clearSilenceTimeout()
      clearStopFallbackTimeout()
      const shouldIgnore = stopRequestedRef.current || hasProcessedResultRef.current
      stopRequestedRef.current = false
      setListening(false)
      setSpeechActive(false)
      if (!shouldIgnore) setIsThinking(false)
      if (!shouldIgnore) setInterimText('')
    }

    r.onend = () => {
      clearSilenceTimeout()
      clearStopFallbackTimeout()
      const alreadyProcessed = hasProcessedResultRef.current
      const finalTranscript = normalizeTranscript(transcriptRef.current)
      const shouldRecoverTranscript = !hasProcessedResultRef.current && finalTranscript

      stopRequestedRef.current = false
      setListening(false)
      setSpeechActive(false)
      transcriptRef.current = ''

      if (shouldRecoverTranscript) {
        hasProcessedResultRef.current = true
        handleProcess(finalTranscript)
        return
      }

      hasProcessedResultRef.current = false
      if (!alreadyProcessed) {
        setIsThinking(false)
        if (!finalTranscript) setInterimText('')
      }
    }

    recognitionRef.current = r

    return () => {
      clearSilenceTimeout()
      clearStopFallbackTimeout()
      try {
        r.abort()
      } catch {
        // noop
      }
    }
  }, [])

  const assistantStatus = isThinking
    ? 'Procesando tu evento...'
    : speechActive
      ? 'Te escucho, sigue hablando...'
      : listening
        ? interimText || 'Te estoy escuchando...'
        : 'Organiza tu tarde para estudiar y hacer ejercicio...'

  const eventTags = parsed
    ? [
        parsed.date,
        parsed.time,
        parsed.section === 'evening' ? 'Tarde' : 'Focus',
      ].filter(Boolean)
    : []

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="fixed inset-0 z-[100] overflow-hidden bg-[#05070b] text-white"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle at center, rgba(255,255,255,0.12) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.18),transparent_34%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.08),transparent_28%)]" />

      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative z-10 mx-auto flex h-full w-full max-w-md flex-col"
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 1rem)',
          paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)',
        }}
      >
        <div className="flex-1 px-3 pb-3 sm:px-5 sm:pb-5">
          <div className="relative flex h-full flex-col overflow-hidden rounded-[34px] border border-white/15 bg-[linear-gradient(180deg,rgba(25,25,28,0.96),rgba(10,10,12,0.98))] shadow-[0_30px_120px_rgba(0,0,0,0.65)] backdrop-blur-3xl sm:rounded-[42px] sm:border-2 sm:border-white/20">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.34),transparent_60%)]" />

            <header className="relative flex items-center justify-between px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-sm font-semibold text-white/90">
                  S
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-white/40">Asistente</p>
                  <h2 className="text-xl font-semibold tracking-tight">Sanctuary</h2>
                </div>
              </div>
              <motion.button
                onClick={onClose}
                whileTap={{ scale: 0.94 }}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10"
              >
                <span className="material-symbols-outlined">close</span>
              </motion.button>
            </header>

            <div className="relative flex flex-1 flex-col overflow-hidden px-5 pb-5 sm:px-6 sm:pb-6">
              <div className="flex flex-1 flex-col justify-between">
                <div className="flex flex-col items-center pt-2 text-center sm:pt-4">
                  <motion.button
                    onClick={toggleListening}
                    animate={
                      listening
                        ? speechActive
                          ? { scale: [1, 1.04, 1], boxShadow: ['0 0 0 0 rgba(59,130,246,0.16)', '0 0 0 26px rgba(59,130,246,0.22)', '0 0 0 10px rgba(59,130,246,0.12)'] }
                          : { scale: [1, 1.02, 1], boxShadow: ['0 0 0 0 rgba(59,130,246,0.14)', '0 0 0 18px rgba(59,130,246,0.18)', '0 0 0 8px rgba(59,130,246,0.08)'] }
                        : { scale: 1, boxShadow: '0 0 0 0 rgba(59,130,246,0)' }
                    }
                    transition={{ duration: speechActive ? 0.65 : 1.1, repeat: listening ? Infinity : 0, ease: 'easeInOut' }}
                    className="relative flex h-36 w-36 items-center justify-center rounded-full border border-white/10 bg-[#0d1932] shadow-[0_0_70px_rgba(37,99,235,0.42)]"
                  >
                    {listening && (
                      <>
                        <motion.span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-full bg-blue-400/20"
                          animate={speechActive ? { scale: [0.94, 1.2, 0.98], opacity: [0.24, 0.55, 0.18] } : { scale: [0.96, 1.08, 1], opacity: [0.12, 0.26, 0.12] }}
                          transition={{ duration: speechActive ? 0.7 : 1.25, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        <motion.span
                          aria-hidden="true"
                          className="absolute inset-[14px] rounded-full bg-blue-400/18"
                          animate={speechActive ? { scale: [0.96, 1.1, 1], opacity: [0.2, 0.42, 0.16] } : { scale: [0.98, 1.04, 1], opacity: [0.1, 0.2, 0.1] }}
                          transition={{ duration: speechActive ? 0.52 : 1.05, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      </>
                    )}

                    <motion.span
                      className={`absolute inset-[18px] rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(96,165,250,0.9),rgba(37,99,235,0.92)_55%,rgba(30,41,59,1))] ${
                        isThinking ? 'opacity-70' : ''
                      }`}
                      animate={speechActive ? { scale: [1, 1.04, 0.99, 1] } : listening ? { scale: [1, 1.015, 1] } : { scale: 1 }}
                      transition={{ duration: speechActive ? 0.45 : 1.2, repeat: listening ? Infinity : 0, ease: 'easeInOut' }}
                    />

                    <span className="material-symbols-outlined relative z-10 text-5xl text-white">
                      {listening ? 'graphic_eq' : isThinking ? 'hourglass_top' : 'mic'}
                    </span>
                  </motion.button>

                  <div className="mt-8 max-w-[18rem] space-y-3">
                    <p className="text-[2.4rem] font-semibold leading-[0.95] tracking-tight text-white sm:text-5xl">
                      Agenda algo en lenguaje natural
                    </p>
                    <p className="text-base font-light text-white/60">
                      {assistantStatus}
                    </p>
                  </div>
                </div>

                <div className="mt-8 space-y-3">
                  <AnimatePresence mode="wait">
                    {isThinking ? (
                      <motion.div
                        key="thinking-card"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        className="rounded-[26px] border border-white/10 bg-white/5 p-5 backdrop-blur-3xl"
                      >
                        <div className="mb-4 flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/45">Procesando</p>
                          <span className="material-symbols-outlined text-white/50">motion_photos_on</span>
                        </div>
                        <TypingIndicator />
                      </motion.div>
                    ) : parsed ? (
                      <motion.div
                        key="card"
                        initial={{ opacity: 0, y: 18, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12, scale: 0.98 }}
                        className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-3xl"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <p className="text-sm uppercase tracking-[0.24em] text-white/40">Evento sugerido</p>
                            <h3 className="text-2xl font-semibold leading-tight">{parsed.title}</h3>
                            <p className="text-sm text-white/55">{parsed.time || 'Sin hora definida'}</p>
                          </div>
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/20 text-blue-200">
                            <span className="material-symbols-outlined">{parsed.icon || 'event'}</span>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {eventTags.map((tag) => (
                            <span key={tag} className="rounded-full bg-white/8 px-3 py-1 text-xs font-medium text-white/72">
                              {tag}
                            </span>
                          ))}
                        </div>

                        <button
                          onClick={() => { onAddEvent(parsed); onClose() }}
                          className="mt-5 w-full rounded-2xl bg-blue-500 py-3.5 font-semibold transition-colors hover:bg-blue-400"
                        >
                          Confirmar evento
                        </button>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="empty"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="rounded-[26px] border border-white/8 bg-white/[0.03] p-5 text-sm font-light text-white/55 backdrop-blur-3xl"
                      >
                        Dime algo como “reunión mañana a las 10” o “gym a las 6” y te preparo el evento antes de confirmarlo.
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="rounded-[24px] border border-white/8 bg-black/20 p-3 backdrop-blur-3xl">
                    <div className="mb-3 flex items-center justify-between px-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.26em] text-white/40">
                        {isThinking ? 'Procesando' : listening ? 'Escuchando' : 'Escribe o habla'}
                      </span>
                      <span className="material-symbols-outlined text-white/40">
                        {isThinking ? 'progress_activity' : listening ? 'hearing' : 'keyboard'}
                      </span>
                    </div>

                    <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className="h-full rounded-full bg-blue-400"
                        animate={
                          isThinking
                            ? { width: ['14%', '82%', '36%', '94%'] }
                            : listening
                              ? { width: speechActive ? ['28%', '72%', '46%'] : ['18%', '40%', '24%'] }
                              : { width: '12%' }
                        }
                        transition={{ duration: isThinking ? 1.6 : 1.2, repeat: isThinking || listening ? Infinity : 0, ease: 'easeInOut' }}
                      />
                    </div>

                    <div className="flex items-center gap-2 rounded-full bg-neutral-900/70 p-2 transition-shadow focus-within:ring-1 focus-within:ring-white/12">
                      <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={EXAMPLES[placeholderIdx]}
                        className="flex-1 bg-transparent px-4 py-2.5 text-white outline-none placeholder:text-neutral-500"
                        onKeyDown={(e) => e.key === 'Enter' && handleProcess(input)}
                      />
                      <button onClick={() => handleProcess(input)} className="rounded-full bg-white/8 p-2.5 text-white transition-colors hover:bg-white/12">
                        <span className="material-symbols-outlined">arrow_upward</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.section>
    </motion.div>
  )
}

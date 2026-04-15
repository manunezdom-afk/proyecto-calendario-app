import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { parseEvent } from '../utils/parseEvent'

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
  const [interimText, setInterimText] = useState('')
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [isThinking, setIsThinking] = useState(false)

  const recognitionRef = useRef(null)
  const silenceTimeoutRef = useRef(null)
  const transcriptRef = useRef('')
  const shouldProcessVoiceRef = useRef(false)
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

  function scheduleSilenceTimeout() {
    clearSilenceTimeout()
    silenceTimeoutRef.current = setTimeout(() => {
      if (recognitionRef.current && listeningRef.current) {
        stopListening(true)
      }
    }, 2000)
  }

  function normalizeTranscript(text) {
    return text.replace(/\s+/g, ' ').trim()
  }

  function handleProcess(text) {
    const normalizedText = normalizeTranscript(text)
    if (!normalizedText) {
      setIsThinking(false)
      return
    }

    setIsThinking(true)
    setParsed(null)
    setInput(normalizedText)
    setInterimText('')

    setTimeout(() => {
      setParsed(parseEvent(normalizedText))
      setIsThinking(false)
    }, 600)
  }

  function stopListening(processImmediately = false) {
    const recognition = recognitionRef.current
    if (!recognition) return

    clearSilenceTimeout()
    setListening(false)
    shouldProcessVoiceRef.current = processImmediately

    if (processImmediately) {
      const transcript = normalizeTranscript(transcriptRef.current || interimTextRef.current || inputValueRef.current)
      if (transcript) {
        transcriptRef.current = transcript
        setInterimText(transcript)
        setIsThinking(true)
      } else {
        shouldProcessVoiceRef.current = false
      }
    }

    try {
      recognition.stop()
    } catch {
      if (processImmediately && transcriptRef.current) handleProcess(transcriptRef.current)
    }
  }

  function toggleListening() {
    if (!recognitionRef.current || isThinking) return

    if (listening) {
      stopListening(true)
      return
    }

    transcriptRef.current = ''
    shouldProcessVoiceRef.current = false
    clearSilenceTimeout()
    setParsed(null)
    setInterimText('')

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
      setListening(true)
      setIsThinking(false)
      setInterimText('')
    }

    r.onspeechstart = () => {
      clearSilenceTimeout()
    }

    r.onspeechend = () => {
      scheduleSilenceTimeout()
    }

    r.onresult = (e) => {
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        final += e.results[i][0].transcript
      }

      const nextTranscript = normalizeTranscript([transcriptRef.current, final].filter(Boolean).join(' '))
      transcriptRef.current = nextTranscript
      shouldProcessVoiceRef.current = Boolean(nextTranscript)
      setInterimText(nextTranscript)
      scheduleSilenceTimeout()
    }

    r.onerror = () => {
      clearSilenceTimeout()
      setListening(false)
      setIsThinking(false)
    }

    r.onend = () => {
      clearSilenceTimeout()
      setListening(false)

      const finalTranscript = normalizeTranscript(transcriptRef.current)
      const shouldProcess = shouldProcessVoiceRef.current && finalTranscript

      shouldProcessVoiceRef.current = false
      transcriptRef.current = ''

      if (shouldProcess) {
        handleProcess(finalTranscript)
        return
      }

      setIsThinking(false)
      setInterimText('')
    }

    recognitionRef.current = r

    return () => {
      clearSilenceTimeout()
      try {
        r.stop()
      } catch {
        // noop
      }
    }
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-3 sm:p-6"
    >
      <motion.button
        type="button"
        aria-label="Cerrar asistente"
        onClick={onClose}
        className="absolute inset-0 backdrop-blur-xl"
      />

      <motion.section
        initial={{ y: '100%', opacity: 0.9 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0.9 }}
        transition={{ type: 'spring', damping: 28, stiffness: 240 }}
        className="relative z-10 flex h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[40px] border border-white/10 border-t border-t-white/5 bg-neutral-950/90 text-white shadow-2xl backdrop-blur-3xl"
      >
        <header className="flex items-center justify-between px-5 py-4 sm:px-6">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.28em] text-white/45">Asistente</p>
            <h2 className="text-lg font-semibold tracking-tight">Asistente Focus</h2>
          </div>
          <motion.button
            onClick={onClose}
            whileTap={{ scale: 0.94 }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/70 transition-colors hover:bg-white/10"
          >
            <span className="material-symbols-outlined">close</span>
          </motion.button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-6">
          <div className="flex min-h-full flex-col items-center justify-center gap-8 text-center">
            <div className="space-y-2">
              <p className="text-3xl font-semibold tracking-tight">Agenda algo en lenguaje natural</p>
              <p className="text-sm font-light text-neutral-400">
                {isThinking
                  ? 'Procesando tu evento...'
                  : listening
                    ? interimText || 'Te estoy escuchando...'
                    : EXAMPLES[placeholderIdx]}
              </p>
            </div>

            <motion.button
              onClick={toggleListening}
              animate={listening ? { scale: 1.12, boxShadow: '0 0 0 14px rgba(59,130,246,0.14)' } : { scale: 1, boxShadow: '0 0 0 0 rgba(59,130,246,0)' }}
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
              className={`flex h-24 w-24 items-center justify-center rounded-full shadow-2xl transition-colors ${
                listening ? 'bg-red-500' : isThinking ? 'bg-white/10 text-white/80' : 'bg-blue-600'
              }`}
            >
              <span className="material-symbols-outlined text-4xl">
                {listening ? 'graphic_eq' : isThinking ? 'hourglass_top' : 'mic'}
              </span>
            </motion.button>

            <AnimatePresence mode="wait">
              {isThinking ? (
                <TypingIndicator key="thinking" />
              ) : parsed ? (
                <motion.div
                  key="card"
                  initial={{ opacity: 0, y: 18, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.98 }}
                  className="w-full max-w-sm rounded-[1.75rem] border border-white/10 bg-white/5 p-6 text-center shadow-xl backdrop-blur-3xl"
                >
                  <p className="mb-2 text-2xl font-bold">{parsed.title}</p>
                  <p className="mb-5 text-white/60">{parsed.time}</p>
                  <button
                    onClick={() => { onAddEvent(parsed); onClose() }}
                    className="w-full rounded-xl bg-blue-500 py-3 font-bold transition-colors hover:bg-blue-400"
                  >
                    Confirmar
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="max-w-sm px-5 py-4 text-center text-sm font-light text-neutral-400"
                >
                  Dime qué quieres agendar y te propongo el evento antes de confirmarlo.
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="border-t border-white/5 p-4 sm:p-5">
          <div className="flex items-center gap-2 rounded-full bg-neutral-900/50 p-2 backdrop-blur-3xl transition-shadow focus-within:ring-1 focus-within:ring-white/10">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={EXAMPLES[placeholderIdx]}
              className="flex-1 bg-transparent px-4 py-2 text-white outline-none placeholder:text-neutral-500"
              onKeyDown={(e) => e.key === 'Enter' && handleProcess(input)}
            />
            <button onClick={() => handleProcess(input)} className="rounded-full bg-white/8 p-2.5 text-white transition-colors hover:bg-white/12">
              <span className="material-symbols-outlined">arrow_upward</span>
            </button>
          </div>
        </div>
      </motion.section>
    </motion.div>
  )
}

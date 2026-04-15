import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { parseEvent } from '../utils/parseEvent'

const SR = typeof window !== 'undefined' && (/** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition)

// Mirrors the COMMAND_PREFIXES in parseEvent.js — kept in sync
const INTENT_RE = /^(?:acu[eé]rdame(?:\s+de)?|recu[eé]rdame(?:\s+de)?|me\s+recuerd[ae]s?(?:\s+de)?|no\s+me\s+dejes\s+olvidar(?:\s+de)?|anota(?:me)?|me\s+anot[aá]s?|ag[eé]ndame|agr[eé]game|pon(?:me)?|met[eé]me|quiero|necesito|tengo(?:\s+que)?|voy\s+a(?:\s+tener)?|program[aá]me|cre[aá]me)\s+/i
const CONNECTOR_RE = /^(?:que|por\s+favor|para\s+que|un[ao]?\s+evento\s+de)\s+/i
function cleanIntent(raw) {
  let t = raw.trim()
  for (let i = 0; i < 5; i++) {
    const prev = t
    t = t.replace(INTENT_RE, '').replace(CONNECTOR_RE, '').trim()
    if (t === prev) break
  }
  return t || raw
}

export default function AssistantView({ onClose, onAddEvent }) {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [parsed, setParsed] = useState(null)

  const srRef = useRef(null)
  const silenceRef = useRef(null)
  const doneRef = useRef(false)

  useEffect(() => {
    if (!SR) return
    const r = new SR()
    r.lang = 'es-ES'
    r.continuous = false
    r.interimResults = false
    r.onstart = () => { doneRef.current = false; setIsListening(true) }
    r.onresult = (e) => {
      clearTimeout(silenceRef.current)
      const text = Array.from(e.results).map(res => res[0].transcript).join(' ').trim()
      if (text && !doneRef.current) { doneRef.current = true; process(text) }
    }
    r.onerror = () => { clearTimeout(silenceRef.current); setIsListening(false) }
    r.onend = () => { clearTimeout(silenceRef.current); setIsListening(false) }
    srRef.current = r
    return () => { clearTimeout(silenceRef.current); try { r.abort() } catch {} }
  }, [])

  function process(text) {
    const clean = cleanIntent(text)
    if (!clean) return
    setTranscript(clean)
    setIsProcessing(true)
    setParsed(null)
    setIsListening(false)
    setTimeout(() => { setParsed(parseEvent(clean)); setIsProcessing(false) }, 600)
  }

  function toggleListening() {
    if (isProcessing) return
    if (isListening) { clearTimeout(silenceRef.current); srRef.current?.stop(); return }
    doneRef.current = false
    setTranscript('')
    setParsed(null)
    try { srRef.current?.start() } catch {}
    silenceRef.current = setTimeout(() => srRef.current?.stop(), 8000)
  }

  const statusText = isProcessing
    ? 'Procesando tu evento...'
    : isListening
      ? 'Te estoy escuchando...'
      : 'Toca para hablarle a Focus'

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#05070b] text-white"
    >
      {/* Dot grid background */}
      <div aria-hidden="true" className="absolute inset-0 opacity-35"
        style={{ backgroundImage: 'radial-gradient(circle at center,rgba(255,255,255,0.13) 1px,transparent 1px)', backgroundSize: '14px 14px' }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(59,130,246,0.15),transparent_50%)]" />

      {/* Close button — top right */}
      <motion.button
        onClick={onClose} whileTap={{ scale: 0.92 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/50 backdrop-blur hover:bg-white/10"
        style={{ top: 'max(env(safe-area-inset-top), 1.25rem)' }}
      >
        <span className="material-symbols-outlined text-[1.1rem]">close</span>
      </motion.button>

      {/* Center content */}
      <motion.div
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative z-10 flex w-full max-w-xs flex-col items-center gap-8 px-6"
      >
        {/* Branding */}
        <div className="flex flex-col items-center gap-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.45em] text-white/30">Asistente</p>
          <h1 className="text-2xl font-bold tracking-tight text-white">Focus</h1>
        </div>

        {/* ── BIG MIC BUTTON ── */}
        <div className="relative flex items-center justify-center">
          {/* Pulse rings — solo al escuchar */}
          {isListening && [0, 1].map(i => (
            <motion.span key={i} aria-hidden="true"
              className="absolute rounded-full border border-blue-400/20"
              style={{ width: 180 + i * 50, height: 180 + i * 50 }}
              animate={{ scale: [1, 1.08 + i * 0.04, 1], opacity: [0.55, 0.08, 0.55] }}
              transition={{ duration: 1.8 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.35 }}
            />
          ))}

          {/* Gradient border ring */}
          <motion.span aria-hidden="true"
            className="absolute rounded-full"
            style={{ width: 164, height: 164, padding: 1.5,
              background: isListening
                ? 'conic-gradient(from 0deg, rgba(59,130,246,0.9), rgba(147,197,253,0.5), rgba(59,130,246,0.9))'
                : 'conic-gradient(from 0deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04), rgba(255,255,255,0.12))'
            }}
            animate={isListening ? { rotate: 360 } : { rotate: 0 }}
            transition={{ duration: 3, repeat: isListening ? Infinity : 0, ease: 'linear' }}
          />

          <motion.button
            onClick={toggleListening}
            whileTap={{ scale: 0.94 }}
            animate={isListening
              ? { boxShadow: ['0 0 0 0 rgba(59,130,246,0.3)', '0 0 55px 12px rgba(59,130,246,0.45)', '0 0 0 0 rgba(59,130,246,0.3)'] }
              : { boxShadow: '0 0 35px 0px rgba(59,130,246,0.18)' }}
            transition={{ duration: 1.4, repeat: isListening ? Infinity : 0, ease: 'easeInOut' }}
            className="relative z-10 flex h-40 w-40 items-center justify-center rounded-full bg-[#08101f] backdrop-blur-sm"
          >
            <motion.span
              className={`material-symbols-outlined text-5xl transition-colors duration-300 ${
                isListening ? 'text-blue-300' : isProcessing ? 'text-white/40' : 'text-white/85'
              }`}
              animate={isListening ? { scale: [1, 1.08, 1] } : { scale: 1 }}
              transition={{ duration: 0.7, repeat: isListening ? Infinity : 0, ease: 'easeInOut' }}
            >
              {isListening ? 'graphic_eq' : isProcessing ? 'hourglass_top' : 'mic'}
            </motion.span>
          </motion.button>
        </div>

        {/* Status text */}
        <div className="flex flex-col items-center gap-1 text-center">
          <AnimatePresence mode="wait">
            <motion.p key={statusText}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className={`text-base font-medium ${isListening ? 'text-blue-300' : isProcessing ? 'text-white/70' : 'text-white/50'}`}
            >
              {statusText}
            </motion.p>
          </AnimatePresence>
          {transcript && !isListening && (
            <p className="max-w-[240px] truncate text-xs text-white/30">{transcript}</p>
          )}
        </div>

        {/* Event card — aparece cuando se parseó un evento */}
        <AnimatePresence>
          {(isProcessing || parsed) && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }} transition={{ duration: 0.3 }}
              className="w-full rounded-[22px] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl"
            >
              {isProcessing ? (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-white/35">Analizando...</p>
                  <div className="flex gap-2">
                    {[0, 1, 2].map(i => (
                      <motion.div key={i} className="h-2 w-2 rounded-full bg-blue-400"
                        animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.1 }}
                      />
                    ))}
                  </div>
                </div>
              ) : parsed && (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[9px] uppercase tracking-[0.22em] text-white/35">Evento detectado</p>
                      <h3 className="mt-0.5 text-xl font-bold leading-tight text-white">{parsed.title}</h3>
                      <p className="mt-1 text-sm text-white/50">{parsed.time || 'Sin hora definida'}</p>
                    </div>
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-500/20 text-blue-300">
                      <span className="material-symbols-outlined">{parsed.icon || 'event'}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[parsed.date, parsed.section === 'evening' ? 'Tarde' : 'Focus'].filter(Boolean).map(tag => (
                      <span key={tag} className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-[10px] font-medium text-blue-300">{tag}</span>
                    ))}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => { onAddEvent(parsed); onClose() }}
                      className="flex-1 rounded-xl bg-blue-500 py-3 text-sm font-bold transition-colors hover:bg-blue-400">
                      Confirmar evento
                    </button>
                    <button onClick={() => { setParsed(null); setTranscript('') }}
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/40 hover:bg-white/10">
                      <span className="material-symbols-outlined text-base">close</span>
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Text input */}
        <div className="flex w-full items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.04] px-4 py-3 backdrop-blur focus-within:border-white/15 focus-within:bg-white/[0.06]">
          <input
            value={transcript} onChange={e => setTranscript(e.target.value)}
            placeholder='O escribe: "gym a las 6 de la tarde"'
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/20"
            onKeyDown={e => e.key === 'Enter' && process(transcript)}
          />
          <button onClick={() => process(transcript)}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/80 text-white hover:bg-blue-500">
            <span className="material-symbols-outlined text-sm">arrow_upward</span>
          </button>
        </div>

      </motion.div>
    </motion.div>
  )
}

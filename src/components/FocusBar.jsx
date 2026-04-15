import { useState, useRef, useEffect } from 'react'
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

export default function FocusBar({ onAddEvent }) {
  const [text, setText] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [parsed, setParsed] = useState(null)
  const [isFocused, setIsFocused] = useState(false)

  const inputRef = useRef(null)
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
      const t = Array.from(e.results).map(res => res[0].transcript).join(' ').trim()
      if (t && !doneRef.current) { doneRef.current = true; process(t) }
    }
    r.onerror = () => { clearTimeout(silenceRef.current); setIsListening(false) }
    r.onend = () => { clearTimeout(silenceRef.current); setIsListening(false) }
    srRef.current = r
    return () => { clearTimeout(silenceRef.current); try { r.abort() } catch {} }
  }, [])

  function process(input) {
    const clean = cleanIntent(input)
    if (!clean) return
    setText(clean)
    setIsProcessing(true)
    setParsed(null)
    setIsFocused(false)
    inputRef.current?.blur()
    setTimeout(() => { setParsed(parseEvent(clean)); setIsProcessing(false) }, 600)
  }

  function toggleMic() {
    if (isProcessing) return
    if (isListening) { clearTimeout(silenceRef.current); srRef.current?.stop(); return }
    doneRef.current = false
    setText('')
    setParsed(null)
    try { srRef.current?.start() } catch {}
    silenceRef.current = setTimeout(() => srRef.current?.stop(), 8000)
  }

  function confirm() {
    onAddEvent(parsed)
    setParsed(null)
    setText('')
  }

  function dismiss() {
    setParsed(null)
    setText('')
  }

  const isActive = isFocused || !!text || isListening
  const hasText = text.trim().length > 0

  return (
    <div
      className="fixed bottom-24 left-0 right-0 z-30 flex flex-col items-center gap-3 px-5"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* ── Result card ── */}
      <AnimatePresence>
        {(isProcessing || parsed) && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90 shadow-2xl backdrop-blur-xl"
          >
            {isProcessing ? (
              <div className="flex items-center gap-3 px-4 py-3.5">
                <motion.span
                  className="material-symbols-outlined text-[1.1rem] text-indigo-400"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                >
                  progress_activity
                </motion.span>
                <p className="text-sm text-white/50">Procesando...</p>
              </div>
            ) : parsed && (
              <div className="p-4">
                {/* Event info */}
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                    <span className="material-symbols-outlined text-[1.15rem]">{parsed.icon || 'event'}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold leading-tight text-white">{parsed.title}</p>
                    <p className="mt-0.5 text-xs text-white/40">
                      {[parsed.time, parsed.date].filter(Boolean).join(' · ') || 'Sin hora definida'}
                    </p>
                  </div>
                </div>
                {/* Actions */}
                <div className="mt-3.5 flex gap-2">
                  <button
                    onClick={confirm}
                    className="flex-1 rounded-xl bg-indigo-500 py-2.5 text-[13px] font-semibold text-white transition-opacity active:opacity-80"
                  >
                    Agregar
                  </button>
                  <button
                    onClick={dismiss}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/35 transition-colors active:bg-white/10"
                  >
                    <span className="material-symbols-outlined text-[1rem]">close</span>
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input pill ── */}
      <div className="w-full max-w-sm">
        <motion.div
          animate={
            isListening
              ? { boxShadow: '0 0 0 2px rgba(99,102,241,0.5), 0 8px 32px rgba(0,0,0,0.4)' }
              : isActive
              ? { boxShadow: '0 0 0 1.5px rgba(255,255,255,0.12), 0 8px 32px rgba(0,0,0,0.35)' }
              : { boxShadow: '0 4px 20px rgba(0,0,0,0.25)' }
          }
          transition={{ duration: 0.2 }}
          className="flex items-center gap-2 rounded-2xl border border-white/[0.09] bg-slate-800/80 px-2 py-2 backdrop-blur-2xl"
        >
          {/* Mic button */}
          <motion.button
            onClick={toggleMic}
            animate={isListening ? { scale: [1, 1.1, 1] } : { scale: 1 }}
            transition={{ duration: 0.7, repeat: isListening ? Infinity : 0, ease: 'easeInOut' }}
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${
              isListening
                ? 'bg-indigo-500/25 text-indigo-300'
                : 'bg-white/[0.06] text-white/40 hover:bg-white/10 hover:text-white/60'
            }`}
          >
            <span className="material-symbols-outlined text-[1.05rem]">
              {isListening ? 'graphic_eq' : 'mic'}
            </span>
          </motion.button>

          {/* Text input */}
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={e => e.key === 'Enter' && hasText && process(text)}
            placeholder="Dile algo a Focus..."
            className="flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/25"
          />

          {/* Send button */}
          <AnimatePresence>
            {isActive && (
              <motion.button
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                onClick={() => hasText && process(text)}
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${
                  hasText
                    ? 'bg-indigo-500 text-white'
                    : 'bg-white/[0.06] text-white/20'
                }`}
              >
                <span className="material-symbols-outlined text-[1.05rem]">arrow_upward</span>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}

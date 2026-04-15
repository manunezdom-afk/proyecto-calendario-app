import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { parseEvent } from '../utils/parseEvent'

const SR = typeof window !== 'undefined' && (/** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition)
const INTENT_RE = /^(?:acu[eé]rdame(?:\s+de)?|recu[eé]rdame(?:\s+de)?|anota|quiero|tengo\s+que)\s+/i
const CONNECTOR_RE = /^(?:que|por\s+favor)\s+/i

function cleanIntent(raw) {
  let t = raw.trim()
  for (let i = 0; i < 3; i++) {
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

  return (
    <div className="fixed bottom-24 left-0 right-0 z-30 flex flex-col items-center gap-2 px-4"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* ── Result / processing card ── */}
      <AnimatePresence>
        {(isProcessing || parsed) && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1117]/95 p-4 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
          >
            {isProcessing ? (
              <div className="flex items-center gap-3">
                <motion.span className="material-symbols-outlined text-base text-blue-400"
                  animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                  progress_activity
                </motion.span>
                <p className="text-sm text-white/50">Procesando tu evento...</p>
              </div>
            ) : parsed && (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/30">Evento detectado</p>
                    <p className="mt-0.5 truncate text-base font-semibold text-white">{parsed.title}</p>
                    <p className="text-xs text-white/40">
                      {[parsed.time, parsed.date].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300">
                    <span className="material-symbols-outlined text-sm">{parsed.icon || 'event'}</span>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={confirm}
                    className="flex-1 rounded-xl bg-blue-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-400">
                    Confirmar
                  </button>
                  <button onClick={dismiss}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/45 transition-colors hover:bg-white/10">
                    Descartar
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input bar ── */}
      <div className="w-full max-w-md">
        <motion.div
          layout
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={`flex items-center gap-2.5 rounded-2xl border backdrop-blur-2xl shadow-[0_4px_28px_rgba(0,0,0,0.35)] transition-all duration-200 ${
            isActive
              ? 'border-white/15 bg-[#0d1117]/95 px-3.5 py-3'
              : 'border-white/8 bg-[#0d1117]/80 px-4 py-3.5'
          }`}
        >
          {/* Mic */}
          <motion.button onClick={toggleMic}
            animate={isListening ? { scale: [1, 1.12, 1] } : { scale: 1 }}
            transition={{ duration: 0.75, repeat: isListening ? Infinity : 0, ease: 'easeInOut' }}
            className={`flex flex-shrink-0 items-center justify-center rounded-full transition-colors ${
              isListening ? 'h-7 w-7 bg-blue-500/25 text-blue-400' : 'text-white/35 hover:text-white/60'
            }`}
          >
            <span className="material-symbols-outlined text-[1.1rem]">
              {isListening ? 'graphic_eq' : 'mic'}
            </span>
          </motion.button>

          {/* Input */}
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={e => e.key === 'Enter' && text.trim() && process(text)}
            placeholder="Dile algo a Focus..."
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
          />

          {/* Send */}
          <AnimatePresence>
            {isActive && (
              <motion.button
                initial={{ opacity: 0, scale: 0.75 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.75 }} transition={{ duration: 0.15 }}
                onClick={() => text.trim() && process(text)}
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
                  text.trim() ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-white/8 text-white/20'
                }`}
              >
                <span className="material-symbols-outlined text-sm">arrow_upward</span>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}

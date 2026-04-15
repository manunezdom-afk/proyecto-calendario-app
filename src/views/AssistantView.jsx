import { useState, useEffect, useRef } from 'react'
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

  const statusLabel = isProcessing ? 'Procesando tu evento...' : isListening ? 'Escuchando tu plan...' : 'Presiona el mic y habla'

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="fixed inset-0 z-[100] overflow-hidden bg-[#05070b] text-white"
    >
      <div aria-hidden="true" className="absolute inset-0 opacity-40"
        style={{ backgroundImage: 'radial-gradient(circle at center,rgba(255,255,255,0.12) 1px,transparent 1px)', backgroundSize: '14px 14px' }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.18),transparent_34%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.08),transparent_28%)]" />

      <motion.section
        initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }} transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative z-10 mx-auto flex h-full w-full max-w-md flex-col"
        style={{ paddingTop: 'max(env(safe-area-inset-top),1rem)', paddingBottom: 'max(env(safe-area-inset-bottom),1rem)' }}
      >
        <div className="flex-1 px-3 pb-3 sm:px-5 sm:pb-5">
          <div className="relative flex h-full overflow-hidden rounded-[34px] border border-white/15 bg-[linear-gradient(180deg,rgba(25,25,28,0.96),rgba(10,10,12,0.98))] shadow-[0_30px_120px_rgba(0,0,0,0.65)] backdrop-blur-3xl sm:rounded-[42px]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.28),transparent_60%)]" />

            {/* ── LEFT COLUMN ── */}
            <div className="relative flex w-[46%] flex-col items-center justify-between border-r border-white/[0.07] px-4 py-5">
              {/* Logo */}
              <div className="flex items-center gap-2 self-start">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/10 text-xs font-semibold">S</div>
                <div>
                  <p className="text-[9px] uppercase tracking-[0.28em] text-white/40">Asistente</p>
                  <p className="text-sm font-semibold leading-none tracking-tight">Sanctuary</p>
                </div>
              </div>

              {/* Mic + title */}
              <div className="flex flex-col items-center gap-5">
                <motion.button onClick={toggleListening}
                  animate={isListening
                    ? { scale: [1, 1.04, 1], boxShadow: ['0 0 0 0 rgba(59,130,246,0.14)', '0 0 0 22px rgba(59,130,246,0.22)', '0 0 0 8px rgba(59,130,246,0.08)'] }
                    : { scale: 1 }}
                  transition={{ duration: 1.1, repeat: isListening ? Infinity : 0, ease: 'easeInOut' }}
                  className="relative flex h-28 w-28 items-center justify-center rounded-full border border-white/10 bg-[#0d1932] shadow-[0_0_60px_rgba(37,99,235,0.45)]"
                >
                  {isListening && (
                    <motion.span aria-hidden="true" className="absolute inset-0 rounded-full bg-blue-400/20"
                      animate={{ scale: [0.96, 1.14, 1], opacity: [0.14, 0.34, 0.14] }}
                      transition={{ duration: 1.25, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                  <motion.span
                    className={`absolute inset-[14px] rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(96,165,250,0.9),rgba(37,99,235,0.92)_55%,rgba(30,41,59,1))] ${isProcessing ? 'opacity-60' : ''}`}
                    animate={isListening ? { scale: [1, 1.018, 1] } : { scale: 1 }}
                    transition={{ duration: 1.2, repeat: isListening ? Infinity : 0, ease: 'easeInOut' }}
                  />
                  <span className="material-symbols-outlined relative z-10 text-4xl text-white">
                    {isListening ? 'graphic_eq' : isProcessing ? 'hourglass_top' : 'mic'}
                  </span>
                </motion.button>

                <p className="text-center text-[1.4rem] font-semibold leading-[1.1] tracking-tight">
                  Organiza mi tarde para estudiar y hacer ejercicio...
                </p>
              </div>

              {/* Close */}
              <motion.button onClick={onClose} whileTap={{ scale: 0.94 }}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10">
                <span className="material-symbols-outlined text-xl">close</span>
              </motion.button>
            </div>

            {/* ── RIGHT COLUMN ── */}
            <div className="relative flex flex-1 flex-col px-4 py-5">
              {/* Status */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.26em] text-white/40">
                    {isProcessing ? 'Procesando' : isListening ? 'Escuchando' : 'Listo'}
                  </p>
                  <p className="text-xs font-medium text-white/75">{statusLabel}</p>
                </div>
                <AnimatePresence>
                  {(isListening || isProcessing) && (
                    <motion.div key="spin" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5">
                      <motion.span className="material-symbols-outlined text-sm text-blue-400"
                        animate={{ rotate: isProcessing ? 360 : 0 }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}>
                        {isProcessing ? 'progress_activity' : 'hearing'}
                      </motion.span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Progress bar */}
              <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full bg-blue-400"
                  animate={isProcessing ? { width: ['14%', '82%', '36%', '94%'] } : isListening ? { width: ['18%', '56%', '28%'] } : { width: '12%' }}
                  transition={{ duration: isProcessing ? 1.6 : 1.2, repeat: isProcessing || isListening ? Infinity : 0, ease: 'easeInOut' }}
                />
              </div>

              {/* Card area */}
              <div className="flex flex-1 flex-col">
                <AnimatePresence mode="wait">
                  {isProcessing ? (
                    <motion.div key="thinking" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      className="rounded-[18px] border border-white/10 bg-white/5 p-4 backdrop-blur-3xl">
                      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/40">Analizando...</p>
                      <div className="flex items-center gap-2">
                        {[0, 1, 2].map(i => (
                          <motion.div key={i} className="h-2 w-2 rounded-full bg-blue-400"
                            animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  ) : parsed ? (
                    <motion.div key="card" initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
                      className="rounded-[18px] border border-white/10 bg-white/5 p-4 backdrop-blur-3xl">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[9px] uppercase tracking-[0.22em] text-white/40">Evento sugerido</p>
                          <h3 className="truncate text-base font-semibold leading-tight">{parsed.title}</h3>
                          <p className="mt-0.5 text-xs text-white/50">{parsed.time || 'Sin hora'}</p>
                        </div>
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-200">
                          <span className="material-symbols-outlined text-sm">{parsed.icon || 'event'}</span>
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {[parsed.date, parsed.time, parsed.section === 'evening' ? 'Tarde' : 'Focus'].filter(Boolean).map(tag => (
                          <span key={tag} className="rounded-full bg-white/8 px-2.5 py-0.5 text-[10px] font-medium text-white/60">{tag}</span>
                        ))}
                      </div>
                      <button onClick={() => { onAddEvent(parsed); onClose() }}
                        className="mt-3 w-full rounded-xl bg-blue-500 py-2.5 text-xs font-semibold transition-colors hover:bg-blue-400">
                        Confirmar evento
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex flex-1 flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-white/10 p-4 text-center">
                      <span className="material-symbols-outlined text-2xl text-white/20">calendar_add_on</span>
                      <p className="text-[11px] font-light leading-relaxed text-white/35">
                        Di un evento en voz alta o escríbelo abajo
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Text input */}
              <div className="mt-3 flex items-center gap-2 rounded-2xl bg-neutral-900/70 px-3 py-2 focus-within:ring-1 focus-within:ring-white/10">
                <input value={transcript} onChange={e => setTranscript(e.target.value)}
                  placeholder='Ej: "gym a las 6 de la tarde"'
                  className="flex-1 bg-transparent text-xs text-white outline-none placeholder:text-neutral-500"
                  onKeyDown={e => e.key === 'Enter' && process(transcript)}
                />
                <button onClick={() => process(transcript)}
                  className="rounded-full bg-white/8 p-1.5 text-white transition-colors hover:bg-white/12">
                  <span className="material-symbols-outlined text-sm">arrow_upward</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      </motion.section>
    </motion.div>
  )
}

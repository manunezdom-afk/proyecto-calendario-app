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

  const stripLabel = isProcessing ? 'PROCESANDO' : isListening ? 'ESCUCHANDO' : 'SANCTUARY'
  const stripColor = isProcessing ? 'text-red-400' : isListening ? 'text-blue-400' : 'text-white/20'

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="fixed inset-0 z-[100] overflow-hidden bg-[#05070b] text-white"
    >
      {/* Dot grid */}
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
        <div className="flex-1 px-3 pb-3 sm:px-4 sm:pb-4">
          {/* Card container */}
          <div className="relative flex h-full overflow-hidden rounded-[34px] border border-white/15 bg-[linear-gradient(180deg,rgba(22,22,26,0.97),rgba(9,9,11,0.99))] shadow-[0_32px_100px_rgba(0,0,0,0.7)] backdrop-blur-3xl sm:rounded-[40px]">
            {/* Blue top glow */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_40%_0%,rgba(59,130,246,0.32),transparent_65%)]" />

            {/* ══ LEFT COLUMN ══ */}
            <div className="relative flex w-[54%] flex-col items-center justify-between py-5 pl-5 pr-3">
              {/* Sanctuary header */}
              <div className="flex items-center gap-2 self-start">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-xs font-bold text-white/90">S</div>
                <div>
                  <p className="text-[8px] uppercase tracking-[0.3em] text-white/35">Asistente</p>
                  <p className="text-sm font-semibold leading-none tracking-tight">Sanctuary</p>
                </div>
              </div>

              {/* Mic + title */}
              <div className="flex flex-col items-center gap-6 text-center">
                <motion.button onClick={toggleListening}
                  animate={isListening
                    ? { scale: [1, 1.05, 1], boxShadow: ['0 0 0 0 rgba(59,130,246,0.15)', '0 0 0 28px rgba(59,130,246,0.25)', '0 0 0 10px rgba(59,130,246,0.1)'] }
                    : { scale: 1, boxShadow: '0 0 0 0 rgba(59,130,246,0)' }}
                  transition={{ duration: 1.05, repeat: isListening ? Infinity : 0, ease: 'easeInOut' }}
                  className="relative flex h-36 w-36 items-center justify-center rounded-full border border-white/10 bg-[#0b1628] shadow-[0_0_72px_rgba(37,99,235,0.5)]"
                >
                  {isListening && (
                    <>
                      <motion.span aria-hidden="true" className="absolute inset-0 rounded-full bg-blue-400/15"
                        animate={{ scale: [0.95, 1.18, 1], opacity: [0.12, 0.38, 0.12] }}
                        transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      <motion.span aria-hidden="true" className="absolute inset-[12px] rounded-full bg-blue-400/10"
                        animate={{ scale: [0.97, 1.08, 1], opacity: [0.1, 0.22, 0.1] }}
                        transition={{ duration: 1.0, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }}
                      />
                    </>
                  )}
                  <motion.span
                    className={`absolute inset-[16px] rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(96,165,250,0.92),rgba(37,99,235,0.94)_52%,rgba(20,30,55,1))] shadow-[inset_0_2px_8px_rgba(255,255,255,0.15)] ${isProcessing ? 'opacity-65' : ''}`}
                    animate={isListening ? { scale: [1, 1.02, 1] } : { scale: 1 }}
                    transition={{ duration: 1.15, repeat: isListening ? Infinity : 0, ease: 'easeInOut' }}
                  />
                  <span className="material-symbols-outlined relative z-10 text-[2.6rem] text-white drop-shadow-lg">
                    {isListening ? 'graphic_eq' : isProcessing ? 'hourglass_top' : 'mic'}
                  </span>
                </motion.button>

                <p className="max-w-[11rem] text-[1.65rem] font-bold leading-[1.08] tracking-[-0.01em] text-white">
                  Organiza mi tarde para estudiar y hacer ejercicio...
                </p>
              </div>

              {/* Close */}
              <motion.button onClick={onClose} whileTap={{ scale: 0.92 }}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white/60 hover:bg-white/10">
                <span className="material-symbols-outlined text-[1.1rem]">close</span>
              </motion.button>
            </div>

            {/* Vertical divider */}
            <div className="my-4 w-px bg-white/[0.06]" />

            {/* ══ RIGHT COLUMN — cards ══ */}
            <div className="flex flex-1 flex-col py-4 pl-3 pr-2">
              {/* Status label */}
              <div className="mb-3 flex items-center gap-1.5">
                <motion.span
                  animate={isListening ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
                  transition={{ duration: 1.2, repeat: isListening ? Infinity : 0 }}
                  className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isListening ? 'bg-blue-400' : isProcessing ? 'bg-red-400' : 'bg-white/20'}`}
                />
                <p className="truncate text-[9px] font-semibold uppercase tracking-[0.25em] text-white/45">
                  {isListening ? 'Escuchando tu plan...' : isProcessing ? 'Procesando...' : 'Di un evento'}
                </p>
              </div>

              {/* Card area — flex-1 */}
              <div className="flex flex-1 flex-col gap-2.5 overflow-hidden">
                <AnimatePresence mode="wait">
                  {isProcessing ? (
                    <motion.div key="thinking"
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      className="rounded-[16px] border border-white/10 bg-white/[0.05] p-3.5 backdrop-blur-xl"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/35">Analizando</p>
                        <span className="material-symbols-outlined text-[14px] text-white/30">motion_photos_on</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {[0, 1, 2].map(i => (
                          <motion.div key={i} className="h-1.5 w-1.5 rounded-full bg-blue-400"
                            animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.1 }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  ) : parsed ? (
                    <motion.div key="card"
                      initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                      className="rounded-[16px] border border-white/10 bg-white/[0.05] p-3.5 backdrop-blur-xl"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="mb-0.5 text-[8px] uppercase tracking-[0.22em] text-white/35">Evento</p>
                          <h3 className="truncate text-[0.9rem] font-bold leading-snug text-white">{parsed.title}</h3>
                          <p className="mt-0.5 text-[10px] text-white/50">{parsed.time || 'Sin hora'}</p>
                        </div>
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300">
                          <span className="material-symbols-outlined text-[14px]">{parsed.icon || 'event'}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {[parsed.date, parsed.section === 'evening' ? 'Tarde' : 'Mañana'].filter(Boolean).map(tag => (
                          <span key={tag} className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[9px] font-medium text-blue-300">{tag}</span>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => { onAddEvent(parsed); onClose() }}
                          className="flex-1 rounded-xl bg-blue-500 py-2 text-[11px] font-bold transition-colors hover:bg-blue-400">
                          Confirmar
                        </button>
                        <button onClick={() => setParsed(null)}
                          className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/50 hover:bg-white/10">
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex flex-1 flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-white/[0.08] px-3 py-6 text-center">
                      <span className="material-symbols-outlined text-[1.6rem] text-white/15">calendar_add_on</span>
                      <p className="text-[10px] leading-relaxed text-white/30">Presiona el mic<br/>y habla</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Text input */}
              <div className="mt-2.5 flex items-center gap-1.5 rounded-2xl bg-black/30 px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-white/10">
                <input value={transcript} onChange={e => setTranscript(e.target.value)}
                  placeholder='Escribe un evento...'
                  className="flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-neutral-600"
                  onKeyDown={e => e.key === 'Enter' && process(transcript)}
                />
                <button onClick={() => process(transcript)}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/80 text-white hover:bg-blue-400">
                  <span className="material-symbols-outlined text-[13px]">arrow_upward</span>
                </button>
              </div>
            </div>

            {/* ══ STATUS STRIP (right edge) ══ */}
            <div className="flex w-7 flex-col items-center justify-center border-l border-white/[0.05] bg-white/[0.015]">
              <motion.span
                animate={isProcessing ? { opacity: [1, 0.5, 1] } : { opacity: 1 }}
                transition={{ duration: 0.8, repeat: isProcessing ? Infinity : 0 }}
                className={`select-none text-[8px] font-bold tracking-[0.35em] ${stripColor}`}
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                {stripLabel}
              </motion.span>
            </div>

          </div>
        </div>
      </motion.section>
    </motion.div>
  )
}

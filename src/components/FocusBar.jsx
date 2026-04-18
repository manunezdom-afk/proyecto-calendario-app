import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserMemories } from '../hooks/useUserMemories'

const SR = typeof window !== 'undefined' &&
  (/** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition)

async function callFocusAssistant({ message, events, memories }) {
  const res = await fetch('/api/focus-assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, events, history: [], memories }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw Object.assign(new Error(data.error || 'error'), { code: data.error })
  }
  return res.json()
}

export default function FocusBar({
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
  events = [],
  inline = false,
}) {
  const { memories, addMemory } = useUserMemories()
  const [text, setText]             = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isThinking, setIsThinking]   = useState(false)
  const [reply, setReply]             = useState(null)   // { content, actions }
  const [isFocused, setIsFocused]     = useState(false)

  const inputRef   = useRef(null)
  const srRef      = useRef(null)
  const silenceRef = useRef(null)
  const doneRef    = useRef(false)

  useEffect(() => {
    if (!SR) return
    const r = new SR()
    r.lang = 'es-ES'
    r.continuous = false
    r.interimResults = false
    r.onstart = () => { doneRef.current = false; setIsListening(true) }
    r.onresult = (e) => {
      clearTimeout(silenceRef.current)
      const t = Array.from(e.results).map((res) => res[0].transcript).join(' ').trim()
      if (t && !doneRef.current) { doneRef.current = true; handleSend(t) }
    }
    r.onerror = () => { clearTimeout(silenceRef.current); setIsListening(false) }
    r.onend   = () => { clearTimeout(silenceRef.current); setIsListening(false) }
    srRef.current = r
    return () => { clearTimeout(silenceRef.current); try { r.abort() } catch {} }
  }, [])

  async function handleSend(input) {
    const msg = (input ?? text).trim()
    if (!msg || isThinking) return

    setText('')
    setIsListening(false)
    setReply(null)
    clearTimeout(silenceRef.current)
    try { srRef.current?.stop() } catch {}

    setIsThinking(true)

    try {
      const result = await callFocusAssistant({ message: msg, events, memories })
      const { reply: replyText, actions = [] } = result

      // Ejecutar acciones en el calendario y memorias
      for (const action of actions) {
        if (action.type === 'add_event' && action.event) {
          onAddEvent?.(action.event)
        } else if (action.type === 'edit_event' && action.id) {
          onEditEvent?.(action.id, action.updates ?? {})
        } else if (action.type === 'delete_event' && action.id) {
          onDeleteEvent?.(action.id)
        } else if (action.type === 'remember' && action.memory) {
          addMemory?.(action.memory)
        }
      }

      setReply({ content: replyText, actions })
    } catch (err) {
      const errMsg =
        err.code === 'no_api_key' || err.code === 'invalid_api_key'
          ? 'Configura tu API key en Importar/Exportar → Foto.'
          : 'Error al conectar con la IA. Intenta de nuevo.'
      setReply({ content: errMsg, actions: [] })
    } finally {
      setIsThinking(false)
    }
  }

  function toggleMic() {
    if (isThinking) return
    if (isListening) { clearTimeout(silenceRef.current); srRef.current?.stop(); return }
    doneRef.current = false
    setText('')
    setReply(null)
    try { srRef.current?.start() } catch {}
    silenceRef.current = setTimeout(() => srRef.current?.stop(), 10000)
  }

  const isActive = isFocused || !!text || isListening
  const hasText  = text.trim().length > 0

  // ── Inline mode (dentro del planner, tema claro) ──────────────────────────
  if (inline) {
    return (
      <div className="mb-8 space-y-2">
        {/* Burbuja de respuesta IA */}
        <AnimatePresence>
          {(isThinking || reply) && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden rounded-2xl border border-outline/10 bg-surface-container-lowest shadow-sm"
            >
              {isThinking ? (
                <div className="flex items-center gap-3 px-4 py-3">
                  <motion.span
                    className="material-symbols-outlined text-[1rem] text-primary"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                  >
                    progress_activity
                  </motion.span>
                  <p className="text-sm text-on-surface-variant">Focus está pensando...</p>
                </div>
              ) : reply && (
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                      <span className="material-symbols-outlined text-[0.85rem]">auto_awesome</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-on-surface leading-relaxed">{reply.content}</p>
                      {/* Chips de acciones */}
                      {reply.actions?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {reply.actions.map((a, i) => (
                            <span
                              key={i}
                              className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary"
                            >
                              <span className="material-symbols-outlined text-[12px]">check_circle</span>
                              {a.type === 'add_event'    ? `Agregado: ${a.event?.title ?? ''}` :
                               a.type === 'edit_event'   ? 'Evento actualizado' :
                               a.type === 'delete_event' ? 'Evento eliminado' : a.type}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setReply(null)}
                      className="flex-shrink-0 text-outline/40 hover:text-outline transition-colors"
                    >
                      <span className="material-symbols-outlined text-[1rem]">close</span>
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input bar */}
        <div
          className={`flex items-center gap-2 rounded-2xl border bg-surface-container-lowest px-2 py-2 transition-all duration-200 ${
            isListening
              ? 'border-primary/40 shadow-[0_0_0_3px_rgba(0,88,188,0.08)]'
              : isFocused
              ? 'border-outline/30 shadow-sm'
              : 'border-outline/15'
          }`}
        >
          <motion.button
            onClick={toggleMic}
            animate={isListening ? { scale: [1, 1.1, 1] } : { scale: 1 }}
            transition={{ duration: 0.7, repeat: isListening ? Infinity : 0, ease: 'easeInOut' }}
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${
              isListening
                ? 'bg-primary/10 text-primary'
                : 'bg-surface-container text-outline hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[1.05rem]">
              {isListening ? 'graphic_eq' : 'mic'}
            </span>
          </motion.button>

          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => e.key === 'Enter' && hasText && handleSend()}
            placeholder="Habla con Nova..."
            disabled={isThinking}
            className="flex-1 bg-transparent text-[14px] text-on-surface outline-none placeholder:text-outline/50 disabled:opacity-50"
          />

          <AnimatePresence>
            {isActive && (
              <motion.button
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                onClick={() => hasText && handleSend()}
                disabled={isThinking || !hasText}
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${
                  hasText && !isThinking
                    ? 'bg-primary text-white'
                    : 'bg-surface-container text-outline/40'
                }`}
              >
                <span className="material-symbols-outlined text-[1.05rem]">arrow_upward</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // ── Floating mode ─────────────────────────────────────────────────────────
  return (
    <div
      className="fixed bottom-24 left-0 right-0 z-30 flex flex-col items-center gap-3 px-5"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <AnimatePresence>
        {(isThinking || reply) && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90 shadow-2xl backdrop-blur-xl"
          >
            {isThinking ? (
              <div className="flex items-center gap-3 px-4 py-3.5">
                <motion.span
                  className="material-symbols-outlined text-[1.1rem] text-indigo-400"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                >
                  progress_activity
                </motion.span>
                <p className="text-sm text-white/50">Focus está pensando...</p>
              </div>
            ) : reply && (
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-300 mt-0.5">
                    <span className="material-symbols-outlined text-[0.9rem]">auto_awesome</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-white/90 leading-relaxed">{reply.content}</p>
                    {reply.actions?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {reply.actions.map((a, i) => (
                          <span
                            key={i}
                            className="flex items-center gap-1 rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-medium text-indigo-300"
                          >
                            <span className="material-symbols-outlined text-[12px]">check_circle</span>
                            {a.type === 'add_event'    ? `Agregado: ${a.event?.title ?? ''}` :
                             a.type === 'edit_event'   ? 'Evento actualizado' :
                             a.type === 'delete_event' ? 'Evento eliminado' : a.type}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setReply(null)}
                    className="flex-shrink-0 text-white/30 hover:text-white/60 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[1rem]">close</span>
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

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

          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => e.key === 'Enter' && hasText && handleSend()}
            placeholder="Habla con Nova..."
            disabled={isThinking}
            className="flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/25 disabled:opacity-50"
          />

          <AnimatePresence>
            {isActive && (
              <motion.button
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                onClick={() => hasText && handleSend()}
                disabled={isThinking || !hasText}
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${
                  hasText && !isThinking
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

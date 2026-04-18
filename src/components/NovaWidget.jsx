import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserProfile } from '../hooks/useUserProfile'

const SR =
  typeof window !== 'undefined' &&
  (/** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition)

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
      { headers: { 'Accept-Language': 'es' } },
    )
    const data = await r.json()
    return {
      city: data.address?.city || data.address?.town || data.address?.village || '',
      country: data.address?.country || '',
    }
  } catch { return { city: '', country: '' } }
}

// Simula streaming: revela palabras con delay para sensación instantánea
function useSimulatedStream(fullText, isLoading) {
  const [displayed, setDisplayed] = useState('')
  const timerRef = useRef(null)

  useEffect(() => {
    if (!fullText) { setDisplayed(''); return }
    if (!isLoading) { setDisplayed(fullText); return }

    setDisplayed('')
    const words = fullText.split(' ')
    let i = 0

    function next() {
      if (i >= words.length) return
      setDisplayed(words.slice(0, i + 1).join(' '))
      i++
      timerRef.current = setTimeout(next, 28)
    }
    timerRef.current = setTimeout(next, 0)
    return () => clearTimeout(timerRef.current)
  }, [fullText, isLoading])

  return displayed
}

export default function NovaWidget({
  events = [],
  tasks = [],
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
  onToggleTask,
  onProposeActions,   // (actions, {reply}) => void — modo propuesta
  proposeMode = true, // si true, Nova no ejecuta directo; encola sugerencias
  onOpenInbox,
  isDesktop = false,
}) {
  const { profile } = useUserProfile()
  const [isOpen, setIsOpen]         = useState(false)
  const [input, setInput]           = useState('')
  const [reply, setReply]           = useState('')
  const [isLoading, setIsLoading]   = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [chips, setChips]           = useState([])  // { id, icon, label, done }
  const [location, setLocation]     = useState(null)

  const inputRef    = useRef(null)
  const srRef       = useRef(null)
  const pressTimer  = useRef(null)
  const historyRef  = useRef([])
  const responseRef = useRef(null)  // scroll anchor

  const displayedText = useSimulatedStream(reply, isLoading)

  // Geolocalización (una vez)
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(async ({ coords: { latitude: lat, longitude: lon } }) => {
      const { city, country } = await reverseGeocode(lat, lon)
      setLocation({ lat, lon, city, country })
    }, () => {})
  }, [])

  // Atajo global Cmd/Ctrl+K
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(prev => {
          if (!prev) setTimeout(() => inputRef.current?.focus(), 60)
          return !prev
        })
      }
      if (e.key === 'Escape' && isOpen) setIsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  // Foco automático al abrir
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 80)
  }, [isOpen])

  // Auto-scroll al respuesta
  useEffect(() => {
    if (displayedText) responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [displayedText])

  // Speech recognition
  useEffect(() => {
    if (!SR) return
    const r = new SR()
    r.lang = 'es-ES'
    r.continuous = false
    r.interimResults = false
    r.onresult = (e) => {
      const text = Array.from(e.results).map(res => res[0].transcript).join(' ').trim()
      if (text) { setInput(text); sendMessage(text) }
    }
    r.onerror  = () => setIsListening(false)
    r.onend    = () => setIsListening(false)
    srRef.current = r
    return () => { try { r.abort() } catch {} }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function startVoice() {
    if (!SR || isLoading) return
    try { srRef.current?.start(); setIsListening(true) } catch {}
  }

  function stopVoice() {
    try { srRef.current?.stop() } catch {}
    setIsListening(false)
  }

  // Long press en la pastilla: tap = toggle, hold 500ms = voz
  function onPillPointerDown(e) {
    if (e.button && e.button !== 0) return
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null
      setIsOpen(true)
      setTimeout(() => startVoice(), 150)
    }, 500)
  }

  function onPillPointerUp() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
      setIsOpen(prev => {
        if (!prev) setTimeout(() => inputRef.current?.focus(), 60)
        return !prev
      })
    }
  }

  function onPillPointerLeave() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  // Ejecutar acciones y mostrar chips
  const executeAction = useCallback((action) => {
    if (!action?.type) return
    const id = `${Date.now()}-${Math.random()}`

    const chipDefs = {
      add_event:      { icon: 'add_circle',  label: `Creando "${action.event?.title || ''}"` },
      edit_event:     { icon: 'edit',        label: `Actualizando evento` },
      delete_event:   { icon: 'delete',      label: `Eliminando evento` },
      mark_task_done: { icon: 'task_alt',    label: `Completando tarea` },
    }

    const def = chipDefs[action.type]
    if (def) {
      setChips(prev => [...prev, { id, ...def, done: false }])
      setTimeout(() => setChips(prev => prev.map(c => c.id === id ? { ...c, done: true } : c)), 400)
    }

    if (action.type === 'add_event')      onAddEvent?.(action.event)
    else if (action.type === 'edit_event')   onEditEvent?.(action.id, action.updates ?? {})
    else if (action.type === 'delete_event') onDeleteEvent?.(action.id)
    else if (action.type === 'mark_task_done') onToggleTask?.(action.id)
  }, [onAddEvent, onEditEvent, onDeleteEvent, onToggleTask])

  async function sendMessage(text) {
    const msg = (text ?? input).trim()
    if (!msg || isLoading) return

    setInput('')
    setReply('')
    setChips([])
    setIsLoading(true)

    historyRef.current = [...historyRef.current, { role: 'user', content: msg }]

    try {
      const res = await fetch('/api/focus-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          events,
          tasks,
          history: historyRef.current.slice(0, -1).slice(-8),
          location,
          profile,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || `Error ${res.status}`)
      }

      const data = await res.json()
      const { reply: replyText = '', actions = [] } = data

      // ── Modo propuesta: encolar sugerencias en vez de ejecutar ───────────
      if (proposeMode && actions.length > 0 && onProposeActions) {
        onProposeActions(actions, { reply: replyText })

        // Chips visuales: "Propuesta: X"
        const proposalChips = actions.map((action) => {
          const labelMap = {
            add_event:      `Propuesta: crear "${action.event?.title || 'evento'}"`,
            edit_event:     `Propuesta: actualizar evento`,
            delete_event:   `Propuesta: eliminar evento`,
            mark_task_done: `Propuesta: completar tarea`,
          }
          const iconMap = {
            add_event: 'add_circle',
            edit_event: 'edit_calendar',
            delete_event: 'delete',
            mark_task_done: 'task_alt',
          }
          return {
            id: `${Date.now()}-${Math.random()}`,
            icon: iconMap[action.type] || 'auto_awesome',
            label: labelMap[action.type] || 'Propuesta',
            done: true, // propuesta ya encolada
            proposed: true,
          }
        })
        setChips(proposalChips)

        const suffix = actions.length === 1
          ? 'Revisa la propuesta en la bandeja antes de aplicarla.'
          : `Preparé ${actions.length} propuestas. Revísalas en la bandeja.`
        setReply(replyText ? `${replyText} ${suffix}` : suffix)
      } else {
        // Modo directo (fallback): ejecutar inmediatamente
        for (const action of actions) executeAction(action)
        setReply(replyText || (actions.length > 0 ? 'Listo.' : 'No pude procesar eso.'))
      }

      historyRef.current = [...historyRef.current, { role: 'assistant', content: replyText }]
    } catch (err) {
      setReply('No pude conectarme. Intenta de nuevo.')
    } finally {
      setIsLoading(false)
    }
  }

  // Posición según viewport
  const position = isDesktop ? 'fixed bottom-6 right-6' : 'fixed bottom-[112px] right-4'

  const hasContent = displayedText || chips.length > 0 || isLoading

  return (
    <div className={`${position} z-[60]`}>
      <AnimatePresence mode="wait">
        {isOpen ? (
          // ── Panel expandido ───────────────────────────────────────────────
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.88, y: 12 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.88, y: 12 }}
            transition={{ type: 'spring', damping: 26, stiffness: 340 }}
            className="w-80 rounded-[20px] overflow-hidden shadow-2xl shadow-black/12 border border-slate-200/70"
            style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', transformOrigin: 'bottom right' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <motion.span
                  className="material-symbols-outlined text-[15px] text-blue-500"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                  animate={isLoading ? { rotate: [0, 360] } : { rotate: 0 }}
                  transition={isLoading ? { duration: 2, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }}
                >
                  auto_awesome
                </motion.span>
                <span className="text-[13px] font-semibold text-slate-700">Nova</span>
                {isLoading && (
                  <motion.div
                    className="flex gap-0.5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    {[0, 1, 2].map(i => (
                      <motion.div
                        key={i}
                        className="w-1 h-1 rounded-full bg-blue-400"
                        animate={{ y: [0, -3, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12 }}
                      />
                    ))}
                  </motion.div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-slate-300 font-mono">⌘K</span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <span className="material-symbols-outlined text-[13px]">close</span>
                </button>
              </div>
            </div>

            {/* Área de respuesta */}
            <AnimatePresence>
              {hasContent && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="max-h-52 overflow-y-auto px-4 py-3 space-y-2"
                >
                  {/* Chips de acciones */}
                  {chips.map(chip => (
                    <motion.div
                      key={chip.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg w-fit ${
                        chip.done
                          ? 'text-emerald-600 bg-emerald-50'
                          : 'text-blue-600 bg-blue-50'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: chip.done ? "'FILL' 1" : '' }}>
                        {chip.done ? 'check_circle' : chip.icon}
                      </span>
                      {chip.label}
                    </motion.div>
                  ))}

                  {/* Texto de respuesta */}
                  {displayedText && (
                    <p className="text-[13px] leading-relaxed text-slate-600">
                      {displayedText}
                      {isLoading && (
                        <motion.span
                          animate={{ opacity: [1, 0] }}
                          transition={{ duration: 0.5, repeat: Infinity }}
                          className="inline-block w-0.5 h-3.5 bg-blue-400 ml-0.5 align-middle rounded-full"
                        />
                      )}
                    </p>
                  )}

                  {/* CTA: abrir bandeja si hubo propuestas */}
                  {chips.some(c => c.proposed) && onOpenInbox && !isLoading && (
                    <motion.button
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => { onOpenInbox(); setIsOpen(false) }}
                      className="mt-1 flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[13px]">inbox</span>
                      Abrir bandeja
                      <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
                    </motion.button>
                  )}

                  {/* Skeleton mientras carga y no hay texto aún */}
                  {isLoading && !displayedText && chips.length === 0 && (
                    <div className="space-y-1.5">
                      {[90, 75, 60].map((w, i) => (
                        <motion.div
                          key={i}
                          className="h-2.5 rounded-full bg-slate-100"
                          style={{ width: `${w}%` }}
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
                        />
                      ))}
                    </div>
                  )}
                  <div ref={responseRef} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Placeholder vacío cuando no hay contenido */}
            {!hasContent && (
              <div className="px-4 py-3">
                <p className="text-[12px] text-slate-300 italic">Pregunta algo o da una instrucción…</p>
              </div>
            )}

            {/* Input */}
            <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-2">
              <button
                onPointerDown={isListening ? stopVoice : startVoice}
                disabled={isLoading}
                className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all ${
                  isListening
                    ? 'bg-red-50 text-red-500 ring-2 ring-red-200'
                    : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50 disabled:opacity-30'
                }`}
              >
                <motion.span
                  className="material-symbols-outlined text-[17px]"
                  animate={isListening ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                  transition={isListening ? { duration: 0.8, repeat: Infinity } : {}}
                >
                  {isListening ? 'stop' : 'mic'}
                </motion.span>
              </button>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
                }}
                placeholder={isListening ? 'Escuchando…' : 'Escribe o habla…'}
                disabled={isLoading || isListening}
                className="flex-1 text-[13px] bg-transparent outline-none text-slate-700 placeholder:text-slate-300 disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isLoading}
                className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 active:scale-90 transition-all disabled:opacity-25"
              >
                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
              </button>
            </div>
          </motion.div>
        ) : (
          // ── Pastilla cerrada ──────────────────────────────────────────────
          <motion.button
            key="pill"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{    opacity: 0, scale: 0.7 }}
            transition={{ type: 'spring', damping: 18, stiffness: 300 }}
            onPointerDown={onPillPointerDown}
            onPointerUp={onPillPointerUp}
            onPointerLeave={onPillPointerLeave}
            className="flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-2xl text-white text-[13px] font-semibold select-none active:scale-95 transition-transform"
            style={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #7c3aed 100%)',
              boxShadow: '0 8px 24px rgba(59,130,246,0.35), 0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            <motion.span
              className="material-symbols-outlined text-[17px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
              animate={{ rotate: [0, 8, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, repeatDelay: 4 }}
            >
              auto_awesome
            </motion.span>
            Nova
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

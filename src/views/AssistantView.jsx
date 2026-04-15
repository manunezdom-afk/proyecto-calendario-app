import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const SR = typeof window !== 'undefined' &&
  (/** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition)

const API_KEY_STORAGE = 'focus_anthropic_key'

function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || ''
}

/** Llama a la función Netlify de Focus */
async function callFocusAssistant({ message, events, history, apiKey }) {
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers['x-user-api-key'] = apiKey

  const res = await fetch('/api/focus-assistant', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, events, history }),
  })

  if (!res.ok) {
    const rawBody = await res.text().catch(() => '')
    let data = {}

    try {
      data = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      data = {}
    }

    const error = Object.assign(
      new Error(data.message || data.error || rawBody || 'error'),
      {
        status: res.status,
        code: data.error,
        details: rawBody,
      },
    )

    console.error('[AssistantView] focus-assistant fetch failed', {
      status: res.status,
      code: data.error,
      message: data.message,
      details: rawBody,
    })

    throw error
  }
  return res.json()
}

/** Muestra chips de acciones ejecutadas */
function ActionChips({ actions }) {
  if (!actions?.length) return null
  const labels = {
    add_event: (a) => `Evento agregado: ${a.event?.title ?? ''}`,
    edit_event: () => `Evento actualizado`,
    delete_event: () => `Evento eliminado`,
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {actions.map((a, i) => (
        <span
          key={i}
          className="flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-medium text-blue-300"
        >
          <span className="material-symbols-outlined text-[13px]">check_circle</span>
          {labels[a.type]?.(a) ?? a.type}
        </span>
      ))}
    </div>
  )
}

export default function AssistantView({ onClose, onAddEvent, onEditEvent, onDeleteEvent, events = [] }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '¡Hola! Soy Focus, tu asistente personal. ¿En qué te puedo ayudar hoy?', actions: [] }
  ])
  const [input, setInput]           = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isThinking, setIsThinking]   = useState(false)
  const [noKey, setNoKey]             = useState(false)

  const srRef       = useRef(null)
  const silenceRef  = useRef(null)
  const doneRef     = useRef(false)
  const scrollRef   = useRef(null)
  const inputRef    = useRef(null)

  // Historial para el contexto del modelo (solo role + content)
  const historyRef = useRef([
    { role: 'assistant', content: '¡Hola! Soy Focus, tu asistente personal. ¿En qué te puedo ayudar hoy?' }
  ])

  // Speech recognition
  useEffect(() => {
    if (!SR) return
    const r = new SR()
    r.lang = 'es-ES'
    r.continuous = false
    r.interimResults = false
    r.onstart = () => { doneRef.current = false; setIsListening(true) }
    r.onresult = (e) => {
      clearTimeout(silenceRef.current)
      const text = Array.from(e.results).map((res) => res[0].transcript).join(' ').trim()
      if (text && !doneRef.current) { doneRef.current = true; handleSend(text) }
    }
    r.onerror = () => { clearTimeout(silenceRef.current); setIsListening(false) }
    r.onend   = () => { clearTimeout(silenceRef.current); setIsListening(false) }
    srRef.current = r
    return () => { clearTimeout(silenceRef.current); try { r.abort() } catch {} }
  }, [])

  // Scroll al último mensaje
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isThinking])

  function toggleMic() {
    if (isThinking) return
    if (isListening) { clearTimeout(silenceRef.current); srRef.current?.stop(); return }
    doneRef.current = false
    setInput('')
    try { srRef.current?.start() } catch {}
    silenceRef.current = setTimeout(() => srRef.current?.stop(), 10000)
  }

  async function handleSend(text) {
    const msg = (text ?? input).trim()
    if (!msg || isThinking) return

    setInput('')
    setIsListening(false)
    clearTimeout(silenceRef.current)
    try { srRef.current?.stop() } catch {}

    // Agregar mensaje del usuario
    setMessages((prev) => [...prev, { role: 'user', content: msg }])
    historyRef.current = [...historyRef.current, { role: 'user', content: msg }]

    const apiKey = getApiKey()
    if (!apiKey && !import.meta.env.VITE_HAS_SERVER_KEY) {
      setNoKey(true)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Necesito una API key para funcionar como IA. Ve a Importar/Exportar → Foto para configurarla.',
          actions: [],
        },
      ])
      return
    }

    setIsThinking(true)
    setNoKey(false)

    try {
      // Enviar solo el historial anterior (sin el mensaje actual que ya va en "message")
      const historyToSend = historyRef.current.slice(0, -1) // quitar el último (user msg actual)

      const result = await callFocusAssistant({
        message: msg,
        events,
        history: historyToSend.slice(-10), // máx 10 mensajes de contexto
        apiKey,
      })

      const { reply, actions = [] } = result

      // Ejecutar acciones en el calendario
      for (const action of actions) {
        if (action.type === 'add_event' && action.event) {
          onAddEvent?.(action.event)
        } else if (action.type === 'edit_event' && action.id) {
          onEditEvent?.(action.id, action.updates ?? {})
        } else if (action.type === 'delete_event' && action.id) {
          onDeleteEvent?.(action.id)
        }
      }

      // Guardar respuesta en historial
      historyRef.current = [...historyRef.current, { role: 'assistant', content: reply }]

      setMessages((prev) => [...prev, { role: 'assistant', content: reply, actions }])
    } catch (err) {
      console.error('[AssistantView] Error exacto al conectar con /api/focus-assistant:', {
        message: err?.message,
        code: err?.code,
        status: err?.status,
        details: err?.details,
      })

      const errMsg =
        err.code === 'no_api_key'
          ? 'Configura tu API key en Importar/Exportar → Foto para usar la IA.'
          : err.code === 'invalid_api_key'
          ? 'La API key no es válida. Revísala en Importar/Exportar → Foto.'
          : 'Ocurrió un error al conectar con la IA. Intenta de nuevo.'

      setMessages((prev) => [...prev, { role: 'assistant', content: errMsg, actions: [] }])
    } finally {
      setIsThinking(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#05070b] text-white"
    >
      {/* Fondo decorativo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage: 'radial-gradient(circle at center,rgba(255,255,255,0.12) 1px,transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.12),transparent_55%)]" />

      {/* ── Header ── */}
      <div
        className="relative z-10 flex items-center justify-between px-5 pb-3 pt-safe"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        <div className="flex items-center gap-3">
          {/* Mic indicator */}
          <motion.div
            animate={isListening
              ? { boxShadow: ['0 0 0 0 rgba(59,130,246,0.5)', '0 0 0 8px rgba(59,130,246,0)', '0 0 0 0 rgba(59,130,246,0.5)'] }
              : {}}
            transition={{ duration: 1.4, repeat: isListening ? Infinity : 0 }}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              isListening ? 'bg-blue-500/20 text-blue-300' : 'bg-white/[0.06] text-white/40'
            }`}
          >
            <span className="material-symbols-outlined text-[1.1rem]">
              {isListening ? 'graphic_eq' : 'auto_awesome'}
            </span>
          </motion.div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.4em] text-white/30">Asistente</p>
            <h1 className="text-base font-bold leading-tight tracking-tight text-white">Focus</h1>
          </div>
        </div>

        <motion.button
          onClick={onClose}
          whileTap={{ scale: 0.9 }}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/50 hover:bg-white/10"
        >
          <span className="material-symbols-outlined text-[1.1rem]">close</span>
        </motion.button>
      </div>

      {/* ── Mensajes ── */}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto px-4 py-2 space-y-3"
      >
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="mr-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-300">
                <span className="material-symbols-outlined text-[0.85rem]">auto_awesome</span>
              </div>
            )}
            <div
              className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'rounded-tr-sm bg-blue-500 text-white'
                  : 'rounded-tl-sm bg-white/[0.07] text-white/90'
              }`}
            >
              <p className="text-sm leading-relaxed">{msg.content}</p>
              {msg.role === 'assistant' && <ActionChips actions={msg.actions} />}
            </div>
          </motion.div>
        ))}

        {/* Thinking indicator */}
        <AnimatePresence>
          {isThinking && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex justify-start"
            >
              <div className="mr-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-300">
                <span className="material-symbols-outlined text-[0.85rem]">auto_awesome</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-white/[0.07] px-4 py-3">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i} className="h-1.5 w-1.5 rounded-full bg-blue-400"
                    animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.12 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Input ── */}
      <div
        className="relative z-10 px-4 pb-safe"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        {/* Alerta sin API key */}
        <AnimatePresence>
          {noKey && (
            <motion.p
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mb-2 text-center text-[11px] text-amber-400/80"
            >
              Configura tu API key en Importar/Exportar → Foto para usar la IA
            </motion.p>
          )}
        </AnimatePresence>

        <div className={`flex items-center gap-2 rounded-2xl border px-2 py-2 backdrop-blur-xl transition-all duration-200 ${
          isListening
            ? 'border-blue-500/40 bg-blue-500/[0.07] shadow-[0_0_0_3px_rgba(59,130,246,0.1)]'
            : 'border-white/[0.08] bg-white/[0.05]'
        }`}>
          {/* Mic */}
          <motion.button
            onClick={toggleMic}
            disabled={isThinking}
            animate={isListening ? { scale: [1, 1.12, 1] } : { scale: 1 }}
            transition={{ duration: 0.7, repeat: isListening ? Infinity : 0, ease: 'easeInOut' }}
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${
              isListening
                ? 'bg-blue-500/20 text-blue-300'
                : isThinking
                ? 'bg-white/[0.04] text-white/20'
                : 'bg-white/[0.06] text-white/40 hover:bg-white/10 hover:text-white/60'
            }`}
          >
            <span className="material-symbols-outlined text-[1.1rem]">
              {isListening ? 'graphic_eq' : 'mic'}
            </span>
          </motion.button>

          {/* Input */}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={isListening ? 'Escuchando...' : 'Escríbele a Focus...'}
            disabled={isThinking}
            className="flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/25 disabled:opacity-50"
          />

          {/* Send */}
          <AnimatePresence>
            {(input.trim() || !isListening) && (
              <motion.button
                initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.15 }}
                onClick={() => handleSend()}
                disabled={isThinking || !input.trim()}
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${
                  input.trim() && !isThinking
                    ? 'bg-blue-500 text-white hover:bg-blue-400'
                    : 'bg-white/[0.05] text-white/20'
                }`}
              >
                <span className="material-symbols-outlined text-[1.05rem]">arrow_upward</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

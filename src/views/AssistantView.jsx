import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const SR = typeof window !== 'undefined' &&
  (/** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition)

const CONTACTS_SUPPORTED =
  typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window

const API_KEY_STORAGE = 'focus_anthropic_key'
function getApiKey() { return localStorage.getItem(API_KEY_STORAGE) || '' }

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
      { headers: { 'Accept-Language': 'es' } },
    )
    const data = await r.json()
    const city = data.address?.city || data.address?.town || data.address?.village || ''
    const country = data.address?.country || ''
    return { city, country }
  } catch {
    return { city: '', country: '' }
  }
}

async function callFocusAssistant({ message, events, history, apiKey, location, contacts }) {
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers['x-user-api-key'] = apiKey
  const res = await fetch('/api/focus-assistant', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, events, history, location, contacts }),
  })
  if (!res.ok) {
    const rawBody = await res.text().catch(() => '')
    let data = {}
    try { data = rawBody ? JSON.parse(rawBody) : {} } catch {}
    throw Object.assign(new Error(data.message || data.error || 'error'), {
      status: res.status,
      code: data.error,
    })
  }
  return res.json()
}

/** Text-to-speech con voz española si está disponible */
function speak(text) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { resolve(); return }
    window.speechSynthesis.cancel()

    const doSpeak = () => {
      const utter = new SpeechSynthesisUtterance(text)
      utter.lang = 'es-ES'
      utter.rate = 1.0
      utter.pitch = 1.0
      const voices = window.speechSynthesis.getVoices()
      const esVoice = voices.find((v) => v.lang.startsWith('es'))
      if (esVoice) utter.voice = esVoice
      utter.onend = resolve
      utter.onerror = resolve
      window.speechSynthesis.speak(utter)
    }

    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak()
    } else {
      const handler = () => {
        window.speechSynthesis.removeEventListener('voiceschanged', handler)
        doSpeak()
      }
      window.speechSynthesis.addEventListener('voiceschanged', handler)
      setTimeout(doSpeak, 800) // fallback si voiceschanged no dispara
    }
  })
}

/** Barras de forma de onda */
function WaveformBars({ active }) {
  const heights = [0.35, 0.65, 0.9, 0.75, 1.0, 0.8, 0.55, 0.7, 0.4]
  return (
    <div className="flex items-center justify-center gap-[3px]" style={{ height: 32 }}>
      {heights.map((h, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full bg-blue-400/60"
          animate={active
            ? { scaleY: [h * 0.25, h, h * 0.45, h * 0.8, h * 0.25] }
            : { scaleY: 0.12 }}
          transition={{
            duration: 0.85,
            repeat: active ? Infinity : 0,
            delay: i * 0.07,
            ease: 'easeInOut',
          }}
          style={{ height: 32, transformOrigin: 'center' }}
        />
      ))}
    </div>
  )
}

/** Anillos que se expanden cuando está escuchando */
function PulsingRings({ active }) {
  return (
    <>
      {[200, 164, 132].map((size, i) => (
        <motion.div
          key={size}
          className="absolute rounded-full border border-blue-500/20"
          style={{ width: size, height: size }}
          animate={active
            ? { scale: [1, 1.28], opacity: [0.55, 0] }
            : { scale: 1, opacity: 0 }}
          transition={active
            ? { duration: 1.8, repeat: Infinity, delay: i * 0.45, ease: 'easeOut' }
            : { duration: 0.35 }}
        />
      ))}
    </>
  )
}

// ─── Configuración visual por estado ────────────────────────────────────────
const STATE_CFG = {
  idle: {
    label: 'Toca para hablar',
    border: 'rgba(255,255,255,0.08)',
    bg: 'rgba(255,255,255,0.04)',
    icon: 'mic',
    iconColor: 'rgba(255,255,255,0.28)',
  },
  listening: {
    label: 'Escuchando...',
    border: 'rgba(59,130,246,0.55)',
    bg: 'rgba(59,130,246,0.12)',
    icon: 'graphic_eq',
    iconColor: 'rgb(147,197,253)',
  },
  thinking: {
    label: 'Pensando...',
    border: 'rgba(99,102,241,0.45)',
    bg: 'rgba(99,102,241,0.08)',
    icon: 'auto_awesome',
    iconColor: 'rgb(165,180,252)',
  },
  speaking: {
    label: 'Focus',
    border: 'rgba(59,130,246,0.30)',
    bg: 'rgba(59,130,246,0.07)',
    icon: 'volume_up',
    iconColor: 'rgb(147,197,253)',
  },
}

// ─── Componente principal ────────────────────────────────────────────────────
export default function AssistantView({ onClose, onAddEvent, onEditEvent, onDeleteEvent, events = [] }) {
  const [status, setStatus]     = useState('idle')
  const [lastReply, setLastReply] = useState('')
  const [location, setLocation] = useState(null)
  const [contacts, setContacts] = useState([])

  // Ref para leer el status actual dentro de los callbacks de SR
  const statusRef  = useRef('idle')
  const historyRef = useRef([])
  const srRef      = useRef(null)
  const silenceRef = useRef(null)
  const doneRef    = useRef(false)

  function updateStatus(s) {
    statusRef.current = s
    setStatus(s)
  }

  // Geolocalización al montar
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lon } }) => {
        const { city, country } = await reverseGeocode(lat, lon)
        setLocation({ lat, lon, city, country })
      },
      () => {},
    )
  }, [])

  // Configurar Speech Recognition
  useEffect(() => {
    if (!SR) return
    const r = new SR()
    r.lang = 'es-ES'
    r.continuous = false
    r.interimResults = false
    r.onstart  = () => { doneRef.current = false; updateStatus('listening') }
    r.onresult = (e) => {
      clearTimeout(silenceRef.current)
      const text = Array.from(e.results).map((res) => res[0].transcript).join(' ').trim()
      if (text && !doneRef.current) { doneRef.current = true; handleVoiceInput(text) }
    }
    r.onerror  = () => { clearTimeout(silenceRef.current); updateStatus('idle') }
    r.onend    = () => {
      clearTimeout(silenceRef.current)
      if (statusRef.current === 'listening') updateStatus('idle')
    }
    srRef.current = r
    return () => {
      clearTimeout(silenceRef.current)
      try { r.abort() } catch {}
      window.speechSynthesis?.cancel()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleVoiceInput(text) {
    updateStatus('thinking')
    setLastReply('')
    historyRef.current = [...historyRef.current, { role: 'user', content: text }]

    try {
      const result = await callFocusAssistant({
        message: text,
        events,
        history: historyRef.current.slice(0, -1).slice(-10),
        apiKey: getApiKey(),
        location,
        contacts,
      })

      const { reply, actions = [] } = result

      for (const action of actions) {
        if (action.type === 'add_event' && action.event)       onAddEvent?.(action.event)
        else if (action.type === 'edit_event' && action.id)    onEditEvent?.(action.id, action.updates ?? {})
        else if (action.type === 'delete_event' && action.id)  onDeleteEvent?.(action.id)
      }

      historyRef.current = [...historyRef.current, { role: 'assistant', content: reply }]
      setLastReply(reply)
      updateStatus('speaking')
      await speak(reply)
      updateStatus('idle')
    } catch (err) {
      const errMsg =
        err.code === 'no_api_key'      ? 'Configura tu API key para usar Focus.' :
        err.code === 'invalid_api_key' ? 'La API key no es válida. Revísala.' :
                                         'No pude conectarme. Intenta de nuevo.'
      setLastReply(errMsg)
      updateStatus('speaking')
      await speak(errMsg)
      updateStatus('idle')
    }
  }

  function handleMicPress() {
    const s = statusRef.current
    if (s === 'thinking') return
    if (s === 'speaking') {
      window.speechSynthesis?.cancel()
      updateStatus('idle')
      return
    }
    if (s === 'listening') {
      clearTimeout(silenceRef.current)
      srRef.current?.stop()
      return
    }
    // idle → empezar a escuchar
    doneRef.current = false
    try { srRef.current?.start() } catch {}
    silenceRef.current = setTimeout(() => srRef.current?.stop(), 10000)
  }

  async function handleShareContacts() {
    if (!CONTACTS_SUPPORTED) return
    try {
      const selected = await /** @type {any} */ (navigator).contacts.select(
        ['name', 'tel', 'email'],
        { multiple: true },
      )
      setContacts(selected.map((c) => ({
        name:  c.name?.[0]  ?? '',
        tel:   c.tel?.[0]   ?? '',
        email: c.email?.[0] ?? '',
      })))
    } catch {}
  }

  const cfg         = STATE_CFG[status]
  const isListening = status === 'listening'
  const isThinking  = status === 'thinking'
  const isSpeaking  = status === 'speaking'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-[100] flex flex-col bg-[#05070b] text-white"
    >
      {/* Fondo — puntos */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage: 'radial-gradient(circle at center,rgba(255,255,255,0.18) 1px,transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
      {/* Gradiente azul superior */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.09),transparent_58%)]" />

      {/* ── Header ── */}
      <div
        className="relative z-10 flex items-center justify-between px-5 pb-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        {/* Logo + ubicación */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06]">
            <span className="material-symbols-outlined text-[0.9rem] text-white/35">auto_awesome</span>
          </div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.4em] text-white/25">Asistente</p>
            <h1 className="text-sm font-bold leading-tight tracking-tight text-white">Focus</h1>
          </div>
          {location?.city && (
            <span className="flex items-center gap-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/28">
              <span className="material-symbols-outlined text-[10px]">location_on</span>
              {location.city}
            </span>
          )}
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-2">
          {CONTACTS_SUPPORTED && (
            <motion.button
              onClick={handleShareContacts}
              whileTap={{ scale: 0.88 }}
              title={contacts.length > 0 ? `${contacts.length} contacto(s)` : 'Compartir contactos'}
              className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/10 transition-colors ${
                contacts.length > 0
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'bg-white/[0.05] text-white/30 hover:bg-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-[0.9rem]">contacts</span>
            </motion.button>
          )}
          <motion.button
            onClick={onClose}
            whileTap={{ scale: 0.88 }}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/35 hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[0.9rem]">close</span>
          </motion.button>
        </div>
      </div>

      {/* ── Área central ── */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8">

        {/* Círculo principal con anillos */}
        <div className="relative flex h-56 w-56 items-center justify-center">

          {/* Anillos pulsantes (escuchando) */}
          <PulsingRings active={isListening} />

          {/* Spinner de "pensando" */}
          <motion.div
            className="absolute rounded-full"
            style={{
              width: 116,
              height: 116,
              background: 'conic-gradient(from 0deg, rgba(99,102,241,0.55), transparent 60%)',
              borderRadius: '50%',
            }}
            animate={isThinking ? { rotate: 360 } : { rotate: 0, opacity: 0 }}
            transition={isThinking
              ? { duration: 1.1, repeat: Infinity, ease: 'linear' }
              : { duration: 0.25 }}
          />

          {/* Botón principal */}
          <motion.button
            onClick={handleMicPress}
            disabled={isThinking}
            whileTap={!isThinking ? { scale: 0.9 } : {}}
            animate={{
              scale: isListening ? [1, 1.05, 1] : 1,
              boxShadow: isListening
                ? [
                    '0 0 0px 0px rgba(59,130,246,0)',
                    '0 0 32px 10px rgba(59,130,246,0.22)',
                    '0 0 0px 0px rgba(59,130,246,0)',
                  ]
                : isSpeaking
                ? '0 0 22px 6px rgba(59,130,246,0.12)'
                : '0 0 0px 0px rgba(0,0,0,0)',
            }}
            transition={isListening
              ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.3 }}
            className="relative flex h-[108px] w-[108px] items-center justify-center rounded-full transition-colors duration-300"
            style={{
              border: `1.5px solid ${cfg.border}`,
              background: cfg.bg,
            }}
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={cfg.icon}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.18 }}
                className="material-symbols-outlined text-[2.1rem]"
                style={{ color: cfg.iconColor }}
              >
                {cfg.icon}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>

        {/* Forma de onda (hablando) */}
        <WaveformBars active={isSpeaking} />

        {/* Etiqueta de estado */}
        <AnimatePresence mode="wait">
          <motion.p
            key={status}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.18 }}
            className="text-[13px] font-medium tracking-widest text-white/35 uppercase"
          >
            {cfg.label}
          </motion.p>
        </AnimatePresence>

        {/* Última respuesta (subtítulo sutil) */}
        <AnimatePresence>
          {lastReply ? (
            <motion.p
              key="reply"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="mx-10 max-w-xs text-center text-[12px] leading-relaxed text-white/18"
            >
              {lastReply}
            </motion.p>
          ) : (
            // Espacio reservado para no desplazar el layout
            <div className="h-[36px]" />
          )}
        </AnimatePresence>
      </div>

      {/* Safe area inferior */}
      <div style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.25rem)' }} />
    </motion.div>
  )
}

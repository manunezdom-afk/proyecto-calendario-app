import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const SR = typeof window !== 'undefined' &&
  (/** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition)

const CONTACTS_SUPPORTED =
  typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window

const API_KEY_STORAGE    = 'focus_anthropic_key'
const OPENAI_KEY_STORAGE = 'focus_openai_key'
const VOICE_STORAGE      = 'focus_tts_voice'

function getApiKey()    { return localStorage.getItem(API_KEY_STORAGE) || '' }
function getOpenAIKey() { return localStorage.getItem(OPENAI_KEY_STORAGE) || '' }
function getVoice()     { return localStorage.getItem(VOICE_STORAGE) || 'nova' }
function saveVoice(v)   { localStorage.setItem(VOICE_STORAGE, v) }

// Voces disponibles de OpenAI TTS
const TTS_VOICES = [
  { id: 'nova',    label: 'Nova',    desc: 'Femenina, cálida' },
  { id: 'shimmer', label: 'Shimmer', desc: 'Femenina, suave' },
  { id: 'alloy',   label: 'Alloy',   desc: 'Neutral' },
  { id: 'echo',    label: 'Echo',    desc: 'Masculina, clara' },
  { id: 'fable',   label: 'Fable',   desc: 'Narrativa' },
  { id: 'onyx',    label: 'Onyx',    desc: 'Masculina, grave' },
]

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
      status: res.status, code: data.error,
    })
  }
  return res.json()
}

/** Elige la mejor voz española disponible en Web Speech API */
function getBestVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  const es = voices.filter((v) => v.lang.startsWith('es'))
  for (const name of ['Paulina', 'Monica', 'Raquel', 'Sabina', 'Laura', 'Helena', 'Valeria', 'Jorge']) {
    const v = es.find((v) => v.name.includes(name))
    if (v) return v
  }
  return es.find((v) => !v.localService) ?? es[0] ?? null
}

/** Fallback: Web Speech API con la mejor voz disponible */
function speakWebSpeech(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) { resolve(); return }
    window.speechSynthesis.cancel()
    const doSpeak = () => {
      const utter = new SpeechSynthesisUtterance(text)
      utter.lang = 'es-ES'
      utter.rate = 1.05
      utter.pitch = 1.0
      const voice = getBestVoice()
      if (voice) utter.voice = voice
      utter.onend = resolve
      utter.onerror = resolve
      window.speechSynthesis.speak(utter)
    }
    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak()
    } else {
      let timer
      const h = () => {
        window.speechSynthesis.removeEventListener('voiceschanged', h)
        clearTimeout(timer)
        doSpeak()
      }
      window.speechSynthesis.addEventListener('voiceschanged', h)
      timer = setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', h)
        doSpeak()
      }, 800)
    }
  })
}

/**
 * TTS principal:
 * 1. Intenta /api/tts (OpenAI TTS — voz seleccionada por el usuario)
 * 2. Si no hay key o falla → Web Speech API con mejor voz disponible
 */
async function speak({ text, voice, stopAudio, audioElRef, audioUrlRef }) {
  stopAudio?.()
  const selectedVoice = String(voice || getVoice() || 'nova').toLowerCase()
  try {
    const openaiKey = getOpenAIKey()
    const headers = { 'Content-Type': 'application/json' }
    if (openaiKey) headers['x-openai-key'] = openaiKey

    // Timeout compatible con iOS Safari (sin AbortSignal.timeout)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 9000)

    // Debug/tracking
    console.log('Voz actual enviada:', selectedVoice)

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, voice: selectedVoice }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))

    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      return new Promise((resolve) => {
        const audio = audioElRef?.current
        if (!audio) {
          URL.revokeObjectURL(url)
          speakWebSpeech(text).then(resolve)
          return
        }

        let settled = false
        const cleanup = () => {
          try { URL.revokeObjectURL(url) } catch {}
          if (audioUrlRef) audioUrlRef.current = null
          try { audio.pause() } catch {}
          try { audio.removeAttribute('src') } catch {}
          try { audio.load?.() } catch {}
        }
        const fallback = () => { if (settled) return; settled = true; cleanup(); speakWebSpeech(text).then(resolve) }
        audio.onended = () => { if (settled) return; settled = true; cleanup(); resolve() }
        audio.onerror = fallback

        console.log('-> Enviando a OpenAI la voz:', selectedVoice)

        if (audioUrlRef) audioUrlRef.current = url
        audio.src = url
        audio.play().catch(fallback)
      })
    }
  } catch { /* sin key, timeout, o error de red → fallback */ }
  return speakWebSpeech(text)
}

// ─── Orb central ────────────────────────────────────────────────────────────
function Orb({ status, onPress }) {
  const isListening = status === 'listening'
  const isThinking  = status === 'thinking'
  const isSpeaking  = status === 'speaking'
  const isIdle      = status === 'idle'

  return (
    <div className="relative flex items-center justify-center" style={{ width: 240, height: 240 }}>

      {/* Anillo exterior — escuchando */}
      {[240, 200, 168].map((size, i) => (
        <motion.div
          key={size}
          className="absolute rounded-full"
          style={{
            width: size, height: size,
            border: '1px solid rgba(99,179,237,0.18)',
          }}
          animate={isListening
            ? { scale: [1, 1.18], opacity: [0.6, 0] }
            : { scale: 1, opacity: 0 }}
          transition={isListening
            ? { duration: 2, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }
            : { duration: 0.4 }}
        />
      ))}

      {/* Halo de fondo suave */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: 160, height: 160 }}
        animate={{
          boxShadow: isListening
            ? ['0 0 0px 0px rgba(59,130,246,0)', '0 0 60px 20px rgba(59,130,246,0.18)', '0 0 0px 0px rgba(59,130,246,0)']
            : isSpeaking
            ? '0 0 40px 12px rgba(59,130,246,0.12)'
            : isThinking
            ? '0 0 30px 8px rgba(139,92,246,0.10)'
            : '0 0 0px 0px rgba(0,0,0,0)',
        }}
        transition={isListening
          ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.6 }}
      />

      {/* Borde giratorio — pensando */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 136, height: 136,
          background: 'conic-gradient(from 0deg, rgba(139,92,246,0.7) 0%, transparent 50%)',
          borderRadius: '50%',
        }}
        animate={isThinking ? { rotate: 360, opacity: 1 } : { rotate: 0, opacity: 0 }}
        transition={isThinking
          ? { duration: 1.2, repeat: Infinity, ease: 'linear' }
          : { duration: 0.3 }}
      />

      {/* Círculo principal */}
      <motion.button
        onClick={onPress}
        disabled={isThinking}
        whileTap={!isThinking ? { scale: 0.93 } : {}}
        animate={{
          scale: isListening ? [1, 1.06, 1] : isSpeaking ? [1, 1.03, 1] : 1,
        }}
        transition={isListening || isSpeaking
          ? { duration: isListening ? 1.4 : 1.8, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.3 }}
        className="relative flex h-[128px] w-[128px] items-center justify-center rounded-full"
        style={{
          background: isListening
            ? 'radial-gradient(circle, rgba(59,130,246,0.22) 0%, rgba(59,130,246,0.06) 100%)'
            : isThinking
            ? 'radial-gradient(circle, rgba(139,92,246,0.16) 0%, rgba(139,92,246,0.04) 100%)'
            : isSpeaking
            ? 'radial-gradient(circle, rgba(59,130,246,0.14) 0%, rgba(59,130,246,0.03) 100%)'
            : 'radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
          border: isListening
            ? '1px solid rgba(59,130,246,0.45)'
            : isThinking
            ? '1px solid rgba(139,92,246,0.35)'
            : isSpeaking
            ? '1px solid rgba(59,130,246,0.25)'
            : '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={status}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.2 }}
            className="material-symbols-outlined select-none"
            style={{
              fontSize: '2.2rem',
              color: isListening ? 'rgb(147,197,253)'
                : isThinking    ? 'rgb(196,181,253)'
                : isSpeaking    ? 'rgb(147,197,253)'
                : 'rgba(255,255,255,0.25)',
            }}
          >
            {isListening ? 'graphic_eq'
              : isThinking ? 'auto_awesome'
              : isSpeaking ? 'volume_up'
              : 'mic'}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      {/* Barras de onda debajo del orb — hablando */}
      <div className="absolute -bottom-8 flex items-center justify-center gap-[3px]">
        {[0.4, 0.7, 1, 0.75, 0.55, 0.85, 0.45].map((h, i) => (
          <motion.div
            key={i}
            className="w-[3px] rounded-full bg-blue-400/50"
            animate={isSpeaking
              ? { scaleY: [h * 0.2, h, h * 0.4, h * 0.9, h * 0.2] }
              : { scaleY: 0.1 }}
            transition={{
              duration: 0.85, repeat: isSpeaking ? Infinity : 0,
              delay: i * 0.08, ease: 'easeInOut',
            }}
            style={{ height: 24, transformOrigin: 'center' }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Componente principal ────────────────────────────────────────────────────
export default function AssistantView({ onClose, onAddEvent, onEditEvent, onDeleteEvent, events = [] }) {
  const [status, setStatus]         = useState('idle')
  const [lastReply, setLastReply]   = useState('')
  const [location, setLocation]     = useState(null)
  const [contacts, setContacts]     = useState([])
  const [selectedVoice, setSelectedVoice] = useState(() => (getVoice() || 'nova').toLowerCase())
  const [showVoices, setShowVoices] = useState(false)

  const statusRef       = useRef('idle')
  const historyRef      = useRef([])
  const srRef           = useRef(null)
  const silenceRef      = useRef(null)
  const doneRef         = useRef(false)
  const voiceInputRef   = useRef(null)
  const voiceRef        = useRef('nova')
  const audioElRef      = useRef(null)
  const audioUrlRef     = useRef(null)
  const audioCtxRef     = useRef(null)
  const audioUnlockedRef = useRef(false)

  function updateStatus(s) { statusRef.current = s; setStatus(s) }

  useEffect(() => { voiceRef.current = (selectedVoice || 'nova').toLowerCase() }, [selectedVoice])

  async function unlockAudio() {
    if (audioUnlockedRef.current) return
    const AC = /** @type {any} */ (window).AudioContext || /** @type {any} */ (window).webkitAudioContext
    if (!AC) { audioUnlockedRef.current = true; return }
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AC()
      const ctx = audioCtxRef.current
      if (ctx?.state === 'suspended') await ctx.resume()
      const src = ctx.createBufferSource()
      src.buffer = ctx.createBuffer(1, 1, 22050)
      src.connect(ctx.destination)
      src.start(0)
      src.stop(0)
      audioUnlockedRef.current = true
    } catch {}
  }

  function stopAudioRef() {
    const audio = audioElRef.current
    if (audio) {
      try { audio.pause() } catch {}
      try { audio.currentTime = 0 } catch {}
      try { audio.removeAttribute('src') } catch {}
      try { audio.load?.() } catch {}
    }
    if (audioUrlRef.current) {
      try { URL.revokeObjectURL(audioUrlRef.current) } catch {}
      audioUrlRef.current = null
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
  }

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(async ({ coords: { latitude: lat, longitude: lon } }) => {
      const { city, country } = await reverseGeocode(lat, lon)
      setLocation({ lat, lon, city, country })
    }, () => {})
  }, [])

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
      if (text && !doneRef.current) { doneRef.current = true; voiceInputRef.current?.(text) }
    }
    r.onerror  = () => { clearTimeout(silenceRef.current); updateStatus('idle') }
    r.onend    = () => { clearTimeout(silenceRef.current); if (statusRef.current === 'listening') updateStatus('idle') }
    srRef.current = r
    return () => { clearTimeout(silenceRef.current); try { r.abort() } catch {}; stopAudioRef() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleVoiceInput(text) {
    updateStatus('thinking')
    setLastReply('')
    historyRef.current = [...historyRef.current, { role: 'user', content: text }]
    try {
      const result = await callFocusAssistant({
        message: text, events,
        history: historyRef.current.slice(0, -1).slice(-10),
        apiKey: getApiKey(), location, contacts,
      })
      const { reply, actions = [] } = result
      for (const action of actions) {
        if (action.type === 'add_event' && action.event)      onAddEvent?.(action.event)
        else if (action.type === 'edit_event' && action.id)   onEditEvent?.(action.id, action.updates ?? {})
        else if (action.type === 'delete_event' && action.id) onDeleteEvent?.(action.id)
      }
      historyRef.current = [...historyRef.current, { role: 'assistant', content: reply }]
      setLastReply(reply)
      updateStatus('speaking')
      await speak({
        text: reply,
        voice: voiceRef.current,
        stopAudio: stopAudioRef,
        audioElRef,
        audioUrlRef,
      })
      updateStatus('idle')
    } catch (err) {
      const msg =
        err.code === 'no_api_key'      ? 'Configura tu API key para usar Focus.' :
        err.code === 'invalid_api_key' ? 'La API key no es válida.' :
                                         'No pude conectarme. Intenta de nuevo.'
      setLastReply(msg)
      updateStatus('speaking')
      await speak({
        text: msg,
        voice: voiceRef.current,
        stopAudio: stopAudioRef,
        audioElRef,
        audioUrlRef,
      })
      updateStatus('idle')
    }
  }

  // Actualizar ref en cada render para que onresult siempre llame la versión fresca
  voiceInputRef.current = handleVoiceInput

  function handleOrbPress() {
    unlockAudio()
    const s = statusRef.current
    if (s === 'thinking') return
    if (s === 'speaking') { stopAudioRef(); updateStatus('idle'); return }
    if (s === 'listening') { clearTimeout(silenceRef.current); srRef.current?.stop(); return }
    doneRef.current = false
    try { srRef.current?.start() } catch {}
    silenceRef.current = setTimeout(() => srRef.current?.stop(), 10000)
  }

  async function handleShareContacts() {
    if (!CONTACTS_SUPPORTED) return
    try {
      const sel = await /** @type {any} */ (navigator).contacts.select(['name', 'tel', 'email'], { multiple: true })
      setContacts(sel.map((c) => ({ name: c.name?.[0] ?? '', tel: c.tel?.[0] ?? '', email: c.email?.[0] ?? '' })))
    } catch {}
  }

  const statusLabel = {
    idle:      'Toca para hablar',
    listening: 'Escuchando',
    thinking:  'Procesando',
    speaking:  'Focus',
  }[status]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden"
      style={{ background: '#06080f' }}
    >
      {/* Glow ambiental central */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 70% 55% at 50% 52%, rgba(59,130,246,0.07) 0%, transparent 70%)',
        }}
      />

      {/* ── Header minimalista ── */}
      <div
        className="relative z-50 flex items-center justify-between px-6"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1.1rem)', paddingBottom: '0.75rem' }}
      >
        {/* Audio player controlado por React (remonta al cambiar la voz) */}
        <audio key={selectedVoice} ref={audioElRef} preload="auto" playsInline className="hidden" />

        {/* Marca + ubicación */}
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/20">Focus</p>
          {location?.city && (
            <span className="flex items-center gap-0.5 text-[10px] text-white/18">
              <span className="material-symbols-outlined text-[10px]">location_on</span>
              {location.city}
            </span>
          )}
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-2">
          {/* Selector de voz */}
          <div className="relative">
            <motion.button
              onClick={() => setShowVoices((v) => !v)}
              whileTap={{ scale: 0.88 }}
              className="flex h-8 items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 text-white/30 hover:text-white/50 transition-colors"
            >
              <span className="material-symbols-outlined text-[0.85rem]">record_voice_over</span>
              <span className="text-[10px] font-medium capitalize">{selectedVoice}</span>
            </motion.button>

            <AnimatePresence>
              {showVoices && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-10 z-50 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#0e1117] shadow-xl"
                >
                  {TTS_VOICES.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        const next = String(v.id || 'nova').toLowerCase()
                        saveVoice(next)
                        setSelectedVoice(next)
                        voiceRef.current = next
                        stopAudioRef()
                        setShowVoices(false)
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06] ${
                        selectedVoice === v.id ? 'text-blue-300' : 'text-white/50'
                      }`}
                    >
                      <div>
                        <p className="text-[12px] font-medium">{v.label}</p>
                        <p className="text-[10px] text-white/25">{v.desc}</p>
                      </div>
                      {selectedVoice === v.id && (
                        <span className="material-symbols-outlined text-[0.85rem] text-blue-400">check</span>
                      )}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {CONTACTS_SUPPORTED && (
            <motion.button
              onClick={handleShareContacts}
              whileTap={{ scale: 0.88 }}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                contacts.length > 0
                  ? 'bg-blue-500/20 text-blue-300/80'
                  : 'text-white/20 hover:text-white/40'
              }`}
            >
              <span className="material-symbols-outlined text-[1rem]">contacts</span>
            </motion.button>
          )}
          <motion.button
            onClick={onClose}
            whileTap={{ scale: 0.88 }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/20 hover:text-white/40 transition-colors"
          >
            <span className="material-symbols-outlined text-[1rem]">close</span>
          </motion.button>
        </div>
      </div>

      {/* ── Zona principal ── */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-12">

        {/* Orb */}
        <Orb status={status} onPress={handleOrbPress} />

        {/* Etiqueta de estado */}
        <AnimatePresence mode="wait">
          <motion.p
            key={status}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-[11px] font-medium uppercase tracking-[0.4em]"
            style={{ color: 'rgba(255,255,255,0.22)' }}
          >
            {statusLabel}
          </motion.p>
        </AnimatePresence>

        {/* Respuesta / transcripción */}
        <AnimatePresence>
          {lastReply && (
            <motion.p
              key="reply"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3 }}
              className="mx-10 max-w-[280px] text-center text-[13px] leading-relaxed"
              style={{ color: 'rgba(255,255,255,0.30)' }}
            >
              {lastReply}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Safe area inferior */}
      <div style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }} />
    </motion.div>
  )
}

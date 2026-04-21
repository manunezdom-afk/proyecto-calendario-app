import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserProfile } from '../hooks/useUserProfile'
import { useUserMemories } from '../hooks/useUserMemories'
import { logSignal } from '../services/signalsService'
import { getCachedBehavior } from '../services/behaviorAnalysis'

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
  const { memories, addMemory } = useUserMemories()
  const [isOpen, setIsOpen]         = useState(false)
  const [input, setInput]           = useState('')
  const [reply, setReply]           = useState('')
  const [isLoading, setIsLoading]   = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [chips, setChips]           = useState([])  // { id, icon, label, done }
  const [location, setLocation]     = useState(null)
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false)
  const [photoPreview, setPhotoPreview]         = useState(null)
  const [chatHistory, setChatHistory] = useState(() => {
    try {
      const raw = sessionStorage.getItem('nova_history')
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) return arr.filter(
          h => h && typeof h === 'object' && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string'
        )
      }
    } catch {}
    return []
  })

  const inputRef    = useRef(null)
  const srRef       = useRef(null)
  const pressTimer  = useRef(null)
  const historyRef  = useRef([])
  const chatEndRef  = useRef(null)
  const photoInputRef = useRef(null)
  // Speech recognition internals (ver useEffect de SR más abajo):
  //   · isRunningRef       — guard real del estado del engine (más fiable que
  //     el state de React para gatillar start/stop desde el onPointerDown/click)
  //   · silenceTimerRef    — timer que cortamos/reprogramamos en cada onresult
  //     para forzar stop() al primer silencio de ~900ms (mucho más rápido que
  //     el timeout interno del browser, que en iOS ronda los 2-3s).
  //   · finalTextRef       — acumulador de resultados finales a lo largo de la
  //     sesión. Se envía a sendMessage cuando onend dispara.
  //   · sendMessageRef     — ref a la última versión de sendMessage, porque el
  //     useEffect del SR corre una sola vez y sendMessage depende de muchas
  //     piezas de estado/props.
  const isRunningRef    = useRef(false)
  const silenceTimerRef = useRef(null)
  const finalTextRef    = useRef('')
  const sendMessageRef  = useRef(null)

  const displayedText = useSimulatedStream(reply, isLoading)

  // Geolocalización (una vez) con timeout para no dejar location en null para siempre
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lon } }) => {
        const { city, country } = await reverseGeocode(lat, lon)
        setLocation({ lat, lon, city, country })
      },
      () => {},
      { timeout: 6000, maximumAge: 600000 },
    )
  }, [])

  // Rehidratar historial persistido desde sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('nova_history')
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) {
          historyRef.current = arr.filter(
            h => h && typeof h === 'object' && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string',
          )
        }
      }
    } catch {}
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

  // Auto-scroll al fondo del chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, displayedText, chips])

  // Ref a la última versión de sendMessage — el useEffect del SR se monta una
  // sola vez y si capturáramos el closure inicial, al dictar tendríamos un
  // sendMessage con estado desactualizado (historial, chips, events, etc.).
  useEffect(() => { sendMessageRef.current = sendMessage })

  // Speech recognition
  //
  // Cambios clave respecto al flujo anterior:
  //   · interimResults=true  → recibimos resultados parciales mientras el
  //     usuario habla. Permite dos cosas: (1) mostrar live el texto en el input
  //     para que se sienta responsivo; (2) implementar nuestro propio silence
  //     detector que corta en ~900ms en vez de esperar los 2-3s del browser.
  //   · silence timer       → reiniciado en cada onresult. Al expirar, llamamos
  //     stop(). En iOS/Safari este es el fix clave a "tarda demasiado en
  //     detectar que terminé de hablar".
  //   · onspeechend también fuerza stop() — algunos browsers lo disparan antes
  //     que el silence timer (mejor aprovecharlo).
  //   · onend es el punto único donde enviamos el texto final a sendMessage.
  //     Antes se enviaba en onresult (al ser continuous=false funcionaba, pero
  //     ahora con interim hay múltiples onresult — consolidamos en onend).
  useEffect(() => {
    if (!SR) return
    const r = new SR()
    r.lang = 'es-ES'
    r.continuous = false
    r.interimResults = true

    r.onresult = (e) => {
      let finalAdd = ''
      let interim  = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript
        if (e.results[i].isFinal) finalAdd += seg
        else interim += seg
      }
      if (finalAdd) {
        finalTextRef.current = (finalTextRef.current + ' ' + finalAdd).replace(/\s+/g, ' ').trim()
      }
      const preview = (finalTextRef.current + ' ' + interim).replace(/\s+/g, ' ').trim()
      if (preview) setInput(preview)

      // Reset silence timer: 900ms sin nuevos resultados → cortamos.
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = setTimeout(() => {
        try { r.stop() } catch {}
      }, 900)
    }

    // Algunos browsers (Chrome desktop, Safari en ciertas versiones) disparan
    // onspeechend al instante cuando detectan silencio acústico. Lo usamos
    // como otra señal para cortar rápido.
    r.onspeechend = () => {
      try { r.stop() } catch {}
    }

    r.onerror = () => {
      clearTimeout(silenceTimerRef.current)
      isRunningRef.current = false
      setIsListening(false)
    }

    r.onend = () => {
      clearTimeout(silenceTimerRef.current)
      isRunningRef.current = false
      setIsListening(false)
      const text = finalTextRef.current.trim()
      finalTextRef.current = ''
      if (text) {
        setInput(text)
        sendMessageRef.current?.(text)
      }
    }

    srRef.current = r
    return () => {
      clearTimeout(silenceTimerRef.current)
      try { r.abort() } catch {}
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function startVoice() {
    if (!SR || isLoading) return
    const r = srRef.current
    if (!r) return
    // Si una sesión anterior quedó a medio cerrar (onend aún no disparó),
    // start() tira InvalidStateError. Abort() fuerza reset y reintentamos
    // después de un tick para que el engine libere el lock.
    if (isRunningRef.current) {
      try { r.abort() } catch {}
      isRunningRef.current = false
      setTimeout(() => startVoice(), 60)
      return
    }
    try {
      finalTextRef.current = ''
      setInput('')
      r.start()
      isRunningRef.current = true
      setIsListening(true)
    } catch {
      try { r.abort() } catch {}
      isRunningRef.current = false
      setIsListening(false)
    }
  }

  function stopVoice() {
    clearTimeout(silenceTimerRef.current)
    try { srRef.current?.stop() } catch {}
    // isListening se limpia en onend para reflejar el estado real del engine
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
    else if (action.type === 'remember')     addMemory?.(action.memory)
  }, [onAddEvent, onEditEvent, onDeleteEvent, onToggleTask, addMemory])

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const preview = URL.createObjectURL(file)
    setPhotoPreview(preview)
    setIsOpen(true)
    setReply('')
    setChips([])
    setIsAnalyzingPhoto(true)

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const res = await fetch('/api/analyze-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: [{ base64, mediaType: file.type || 'image/jpeg' }] }),
      })

      const data = await res.json()
      const events = data?.events ?? []

      if (events.length === 0) {
        setReply('No encontré eventos claros en la foto. Podés describirlos con texto.')
      } else {
        const names = events.map(ev => `"${ev.title}"`).join(', ')
        const msg = events.length === 1
          ? `Encontré 1 evento en la foto: ${names}. ¿Lo agrego al calendario?`
          : `Encontré ${events.length} eventos en la foto: ${names}. ¿Los agrego?`
        setReply(msg)

        historyRef.current = [
          ...historyRef.current,
          { role: 'user', content: '[Foto enviada]' },
          { role: 'assistant', content: msg },
        ]
        setChatHistory([...historyRef.current])
        try { sessionStorage.setItem('nova_history', JSON.stringify(historyRef.current.slice(-40))) } catch {}

        setChips(events.map((ev, i) => ({
          id: `photo-ev-${i}`,
          icon: 'event',
          label: ev.title + (ev.time ? ` · ${ev.time}` : '') + (ev.date ? ` · ${ev.date}` : ''),
          done: false,
          photoEvent: ev,
        })))
      }
    } catch {
      setReply('No pude analizar la foto. Intentá de nuevo.')
    } finally {
      setIsAnalyzingPhoto(false)
      URL.revokeObjectURL(preview)
      setPhotoPreview(null)
    }
  }

  function confirmPhotoEvents() {
    chips.filter(c => c.photoEvent).forEach(c => {
      onAddEvent?.({
        id: `${Date.now()}-${Math.random()}`,
        title: c.photoEvent.title,
        time: c.photoEvent.time ?? '',
        date: c.photoEvent.date ?? null,
        description: '',
        section: 'focus',
        icon: 'event',
        dotColor: 'bg-secondary-container',
        featured: false,
      })
    })
    setChips(prev => prev.map(c => c.photoEvent ? { ...c, done: true } : c))
    setReply('¡Listo! Eventos agregados al calendario.')
  }

  async function sendMessage(text) {
    const msg = (text ?? input).trim()
    if (!msg || isLoading || isListening) return
    if (msg.length > 4000) {
      setReply('El mensaje es demasiado largo. Acortalo por favor.')
      return
    }

    setInput('')
    setReply('')
    setChips([])
    setIsLoading(true)

    historyRef.current = [...historyRef.current, { role: 'user', content: msg }]
    setChatHistory([...historyRef.current])

    logSignal('nova_message', {
      length: msg.length,
      hour: new Date().getHours(),
      weekday: new Date().getDay(),
    })

    try {
      const res = await fetch('/api/focus-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          events,
          tasks,
          history: historyRef.current.slice(0, -1).slice(-20),
          location,
          profile,
          memories,
          behavior: getCachedBehavior(),
          clientNow: Date.now(),
          clientTimezone: (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC',
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const code = data?.error
        const statusMsg = {
          rate_limit:           'Muchos mensajes seguidos. Esperá unos segundos.',
          upstream_rate_limit:  'Muchos mensajes seguidos. Esperá unos segundos.',
          upstream_overloaded:  'El servicio está sobrecargado. Reintentá.',
          invalid_api_key:      'Servicio no disponible en este momento.',
          no_api_key:           'Servicio no disponible en este momento.',
          message_too_long:     'Mensaje demasiado largo.',
          llm_bad_output:       'No pude procesarlo. Repetí por favor.',
        }[code] || data?.message || `Error ${res.status}`
        throw new Error(statusMsg)
      }

      const data = await res.json()
      const { reply: replyText = '', actions = [] } = data

      // Las memorias se aplican directo en cualquier modo (son transparentes, sin inbox)
      const memoryActions = actions.filter(a => a?.type === 'remember')
      const otherActions  = actions.filter(a => a?.type !== 'remember')
      for (const mem of memoryActions) executeAction(mem)

      // ── Modo propuesta: encolar el resto en vez de ejecutar ──────────────
      if (proposeMode && otherActions.length > 0 && onProposeActions) {
        onProposeActions(otherActions, { reply: replyText })

        // Chips visuales: "Propuesta: X"
        const proposalChips = otherActions.map((action) => {
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

        const suffix = otherActions.length === 1
          ? 'Revisa la propuesta en la bandeja antes de aplicarla.'
          : `Preparé ${otherActions.length} propuestas. Revísalas en la bandeja.`
        setReply(replyText ? `${replyText} ${suffix}` : suffix)
      } else {
        // Modo directo (fallback): ejecutar inmediatamente
        for (const action of otherActions) executeAction(action)
        setReply(replyText || (otherActions.length > 0 || memoryActions.length > 0 ? 'Listo.' : 'No pude procesar eso.'))
      }

      historyRef.current = [...historyRef.current, { role: 'assistant', content: replyText }]
      setChatHistory([...historyRef.current])
      setReply('')
      // Persistir historial para que sobreviva a refresh (útil en PWA)
      try {
        sessionStorage.setItem('nova_history', JSON.stringify(historyRef.current.slice(-40)))
      } catch {}
    } catch (err) {
      const errMsg = err?.message && typeof err.message === 'string' && err.message.length < 200
        ? err.message
        : 'No pude conectarme. Intenta de nuevo.'
      historyRef.current = [...historyRef.current, { role: 'assistant', content: errMsg }]
      setChatHistory([...historyRef.current])
      setReply('')
    } finally {
      setIsLoading(false)
    }
  }

  // Posiciones.
  // Pastilla cerrada: bottom-right. Safe-area + 116px en mobile para no
  // chocar con el bottom nav (iOS home indicator incluido).
  // Panel abierto: en desktop sigue siendo el card flotante junto a la pastilla;
  // en mobile se comporta como bottom sheet nativo (backdrop + sheet full-width
  // anclado al borde inferior con safe-area).
  const pillPositionClass = isDesktop ? 'fixed bottom-6 right-6' : 'fixed right-4'
  const pillPositionStyle = isDesktop
    ? undefined
    : { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 116px)' }

  // Panel reutilizable: el contenido es el mismo en desktop y mobile, cambia
  // solo el contenedor exterior (card flotante vs bottom sheet).
  const panelBody = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 flex-shrink-0">
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
        </div>
        <div className="flex items-center gap-1">
          {isDesktop && (
            <span className="text-[10px] text-slate-300 font-mono">⌘K</span>
          )}
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Cerrar Nova"
            className={`flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors ${isDesktop ? 'w-6 h-6' : 'w-10 h-10'}`}
          >
            <span className={`material-symbols-outlined ${isDesktop ? 'text-[13px]' : 'text-[18px]'}`}>close</span>
          </button>
        </div>
      </div>

      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2 min-h-0">
        {chatHistory.length === 0 && !isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-10">
            <span
              className="material-symbols-outlined text-[36px] text-blue-200 mb-2"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              auto_awesome
            </span>
            <p className="text-[12px] text-slate-300">Pregunta algo o da una instrucción</p>
          </div>
        )}

        {chatHistory.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
              msg.role === 'user'
                ? 'bg-blue-500 text-white rounded-br-[6px]'
                : 'bg-slate-100 text-slate-700 rounded-bl-[6px]'
            }`}>
              {msg.content}
            </div>
          </motion.div>
        ))}

        {/* Burbuja de respuesta en curso */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="max-w-[85%] font-nova px-3 py-2 rounded-2xl rounded-bl-[6px] bg-slate-100 text-[13.5px] text-slate-700 leading-relaxed">
              {displayedText ? (
                <>
                  {displayedText}
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    className="inline-block w-0.5 h-3.5 bg-blue-400 ml-0.5 align-middle rounded-full"
                  />
                </>
              ) : (
                <div className="flex gap-1 py-0.5">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-slate-400"
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Chips de acciones (debajo del último mensaje de Nova) */}
        {chips.length > 0 && !isLoading && (
          <div className="flex justify-start">
            <div className="flex flex-col gap-1.5 max-w-[85%]">
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
              {chips.some(c => c.proposed) && onOpenInbox && (
                <motion.button
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => { onOpenInbox(); setIsOpen(false) }}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-blue-600 hover:bg-blue-100 transition-colors w-fit"
                >
                  <span className="material-symbols-outlined text-[13px]">inbox</span>
                  Abrir bandeja
                  <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
                </motion.button>
              )}
              {chips.some(c => c.photoEvent && !c.done) && (
                <button
                  onClick={confirmPhotoEvents}
                  className="mt-0.5 py-1.5 px-3 rounded-xl bg-blue-500 text-white text-[12px] font-semibold hover:bg-blue-600 active:scale-95 transition-all w-fit"
                >
                  Agregar al calendario
                </button>
              )}
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-2 flex-shrink-0">
        {/* Cámara */}
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          disabled={isLoading || isListening || isAnalyzingPhoto}
          className={`flex-shrink-0 flex items-center justify-center rounded-full text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:scale-90 transition-all disabled:opacity-30 ${isDesktop ? 'w-8 h-8' : 'w-11 h-11'}`}
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
          aria-label="Enviar foto a Nova"
        >
          <motion.span
            className={`material-symbols-outlined ${isDesktop ? 'text-[17px]' : 'text-[20px]'}`}
            animate={isAnalyzingPhoto ? { rotate: [0, 360] } : { rotate: 0 }}
            transition={isAnalyzingPhoto ? { duration: 1.2, repeat: Infinity, ease: 'linear' } : {}}
          >
            {isAnalyzingPhoto ? 'progress_activity' : 'add_a_photo'}
          </motion.span>
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhoto}
        />

        {/* Mic
            Antes usaba onPointerDown: inconsistente en iOS (un micro-scroll
            dispara pointercancel y la orden de start() llega en un estado
            inestable). Ahora usa onClick igual que la cámara — el browser
            filtra ruido (touch que se movió = no click) y la interacción se
            siente idéntica a la de la cámara.
            Hitbox ampliada a 44×44 en mobile (estándar Apple HIG) + motion.span
            con pointerEvents:none para que la animación del icono no absorba
            taps en los bordes. */}
        <button
          type="button"
          onClick={isListening ? stopVoice : startVoice}
          disabled={isLoading || isAnalyzingPhoto || !SR}
          className={`flex-shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-all ${isDesktop ? 'w-8 h-8' : 'w-11 h-11'} ${
            isListening
              ? 'bg-red-50 text-red-500 ring-2 ring-red-200'
              : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50 disabled:opacity-30'
          }`}
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
          aria-label={isListening ? 'Detener dictado' : 'Dictar con voz'}
          aria-pressed={isListening}
        >
          <motion.span
            className={`material-symbols-outlined ${isDesktop ? 'text-[17px]' : 'text-[20px]'}`}
            style={{ pointerEvents: 'none' }}
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
          placeholder={isAnalyzingPhoto ? 'Analizando foto…' : isListening ? 'Escuchando…' : 'Escribe o habla…'}
          disabled={isLoading || isListening || isAnalyzingPhoto}
          className={`flex-1 bg-transparent outline-none text-slate-700 placeholder:text-slate-300 disabled:opacity-50 ${isDesktop ? 'text-[13px]' : 'text-[15px]'}`}
        />
        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || isLoading || isAnalyzingPhoto}
          className={`flex-shrink-0 flex items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 active:scale-90 transition-all disabled:opacity-25 ${isDesktop ? 'w-7 h-7' : 'w-10 h-10'}`}
          aria-label="Enviar mensaje"
        >
          <span className={`material-symbols-outlined ${isDesktop ? 'text-[14px]' : 'text-[18px]'}`}>arrow_upward</span>
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Pastilla cerrada — posición fija bottom-right, mismo layout en desktop y mobile */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            key="pill-wrap"
            className={`${pillPositionClass} z-[60]`}
            style={pillPositionStyle}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{    opacity: 0, scale: 0.7 }}
            transition={{ type: 'spring', damping: 18, stiffness: 300 }}
          >
            <button
              onPointerDown={onPillPointerDown}
              onPointerUp={onPillPointerUp}
              onPointerLeave={onPillPointerLeave}
              className="flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-2xl text-white text-[13px] font-semibold select-none active:scale-95 transition-transform"
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #7c3aed 100%)',
                boxShadow: '0 8px 24px rgba(59,130,246,0.35), 0 2px 8px rgba(0,0,0,0.1)',
              }}
              aria-label="Abrir Nova"
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
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Panel abierto — desktop: card flotante; mobile: bottom sheet con backdrop */}
      <AnimatePresence>
        {isOpen && (isDesktop ? (
          <motion.div
            key="panel-desktop"
            className={`${pillPositionClass} z-[60]`}
            style={pillPositionStyle}
            initial={{ opacity: 0, scale: 0.88, y: 12 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.88, y: 12 }}
            transition={{ type: 'spring', damping: 26, stiffness: 340 }}
          >
            <div
              className="w-80 rounded-[20px] overflow-hidden shadow-2xl shadow-black/12 border border-slate-200/70 flex flex-col"
              style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', transformOrigin: 'bottom right', height: '460px' }}
            >
              {panelBody}
            </div>
          </motion.div>
        ) : (
          <div key="panel-mobile" className="fixed inset-0 z-[70]">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setIsOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              aria-hidden="true"
            />
            {/* Bottom sheet */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 340 }}
              className="absolute left-0 right-0 bottom-0 bg-white rounded-t-[22px] flex flex-col shadow-2xl"
              style={{
                height: 'min(82vh, 640px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              }}
              role="dialog"
              aria-label="Nova"
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-slate-200" />
              </div>
              {panelBody}
            </motion.div>
          </div>
        ))}
      </AnimatePresence>
    </>
  )
}

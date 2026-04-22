import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserMemories } from '../hooks/useUserMemories'
import MicButton from './MicButton'
import { isIOSSafari } from '../lib/permissions'

// En Safari iPhone webkitSpeechRecognition existe desde iOS 14.5 y sí funciona
// en muchos contextos (Safari regular con permiso concedido). Antes gateábamos
// SR=null preventivamente en todo iOS Safari — resultado: el mic NUNCA
// intentaba dictar en iPhone y siempre caía al banner de "usa el teclado",
// incluso cuando el dictado web funcionaba perfectamente. Ahora dejamos que
// intente; si el engine responde con 'not-allowed' en iOS Safari (típico en
// PWA standalone), onerror cae al mensaje de dictado por teclado. Ese es el
// contrato correcto: probar primero, degradar sólo si falla.
const SR = typeof window !== 'undefined' &&
  (/** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition)

// Busca el evento que Nova intentó borrar cuando manda un id que no existe.
// Extrae título/hora del texto del reply y matchea contra los eventos reales.
function resolveEventIdFromReply(events, replyText, action) {
  if (!Array.isArray(events) || events.length === 0) return null
  const text = String(replyText || '').toLowerCase()

  // 1. Match por título mencionado entre comillas en el reply
  const quoted = text.match(/['"]([^'"]{3,80})['"]/)
  if (quoted) {
    const needle = quoted[1].toLowerCase().trim()
    const hit = events.find(e => (e.title || '').toLowerCase().includes(needle) || needle.includes((e.title || '').toLowerCase()))
    if (hit) return hit.id
  }

  // 2. Match por hora mencionada ("a las 2:15 PM", "14:15")
  const timeMatch = text.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/)
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10)
    const m = timeMatch[2]
    const period = timeMatch[3]
    if (period === 'pm' && h < 12) h += 12
    if (period === 'am' && h === 12) h = 0
    const hh24 = String(h).padStart(2, '0')
    const targets = [`${hh24}:${m}`, `${h}:${m} ${period?.toUpperCase() || 'PM'}`]
    const hit = events.find(e => {
      const t = String(e.time || '').toLowerCase().replace(/\s+/g, '')
      return targets.some(tt => t === tt.toLowerCase().replace(/\s+/g, ''))
    })
    if (hit) return hit.id
  }

  return null
}

// Texto humano para los chips de acción que muestra FocusBar debajo del reply.
// Antes se caía al valor crudo (`action.type`) para cualquier tipo no mapeado,
// y por eso en móvil aparecía "add_task" en vez de "Tarea agregada".
function describeAction(a) {
  if (!a?.type) return ''
  switch (a.type) {
    case 'add_event':    return `Agregado: ${a.event?.title ?? 'evento'}`
    case 'edit_event':   return 'Evento actualizado'
    case 'delete_event': return 'Evento eliminado'
    case 'add_task':     return `Tarea agregada: ${a.task?.label ?? 'pendiente'}`
    case 'toggle_task':  return 'Tarea completada'
    case 'delete_task':  return 'Tarea eliminada'
    case 'remember':     return 'Memoria guardada'
    default:             return 'Acción aplicada'
  }
}

// Normaliza un título para comparar eventos de forma tolerante (sin acentos,
// mayúsculas ni espacios extra). Lo usamos para asociar tareas detectadas por
// Nova al evento al que pertenecen cuando solo vino el título, no el id.
function normalizeTitleForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveLinkedEventId(events, task) {
  if (!task || !Array.isArray(events) || events.length === 0) return null
  if (task.linkedEventId && events.some(e => e.id === task.linkedEventId)) return task.linkedEventId
  const wantTitle = normalizeTitleForMatch(task.linkedEventTitle)
  const wantTime  = String(task.linkedEventTime || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!wantTitle && !wantTime) return null
  const byTitleAndTime = events.find(e => {
    const t = normalizeTitleForMatch(e.title)
    const h = String(e.time || '').trim().toLowerCase().replace(/\s+/g, '')
    return wantTitle && wantTime && t === wantTitle && h === wantTime
  })
  if (byTitleAndTime) return byTitleAndTime.id
  const byTime = wantTime ? events.find(e => String(e.time || '').trim().toLowerCase().replace(/\s+/g, '') === wantTime) : null
  if (byTime) return byTime.id
  const byTitle = wantTitle ? events.find(e => normalizeTitleForMatch(e.title) === wantTitle) : null
  return byTitle?.id || null
}

async function callFocusAssistant({ message, events, tasks, memories, history }) {
  const res = await fetch('/api/focus-assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      events,
      tasks,
      history,
      memories,
      clientNow: Date.now(),
      clientTimezone: (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC',
    }),
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
  onAddTask,
  onToggleTask,
  onDeleteTask,
  events = [],
  tasks = [],
  inline = false,
}) {
  const { memories, addMemory } = useUserMemories()
  const [text, setText]             = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isThinking, setIsThinking]   = useState(false)
  const [reply, setReply]             = useState(null)   // { content, actions }
  const [isFocused, setIsFocused]     = useState(false)
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false)

  const inputRef   = useRef(null)
  const srRef      = useRef(null)
  const silenceRef = useRef(null)
  const restartTimerRef = useRef(null)
  const photoInputRef = useRef(null)
  const historyRef = useRef([])

  // Sesión de voz: misma lógica que NovaWidget.
  //   · sessionActiveRef  — intención del usuario ("sigo queriendo dictar").
  //     Distingue onend natural del engine (auto-relanzamos) de stop() real.
  //   · sessionStartRef   — timestamp para cortar sesiones que pasen MAX_SESSION_MS.
  //   · finalTextRef      — acumulador del texto definitivo entre reinicios
  //     del engine. Se envía al cerrar la sesión.
  //   · isRunningRef      — estado real del engine; evita start() duplicados.
  const sessionActiveRef = useRef(false)
  const sessionStartRef  = useRef(0)
  const finalTextRef     = useRef('')
  const isRunningRef     = useRef(false)

  // Silencio tolerante: 1800ms permite pausas para pensar sin cortar.
  const SILENCE_MS = 1800
  const MAX_SESSION_MS = 60_000

  // Ref a la última versión de handleSend: el efecto de SR se monta una sola
  // vez; sin ref llamaríamos al handleSend con props/estado desactualizados.
  const handleSendRef = useRef(null)

  // Rehidratar historial persistido (compartido con NovaWidget via sessionStorage)
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

  // Voz:
  //   · interimResults=true → texto en vivo en el input y reset de silenceTimer
  //     sobre cada partial (el timer sólo avanza en silencio real).
  //   · Silencio de corte 1800ms, no los ~10s del setTimeout anterior. Antes
  //     enviaba al primer onresult (cortaba a mitad de frase); ahora espera
  //     silencio real para consolidar la frase completa.
  //   · continuous=false + auto-relanzar en onend → dictado largo sin que
  //     iOS/Chrome corten solos tras unos segundos.
  //   · Tope de 60s como guardia final por sesión.
  useEffect(() => {
    if (!SR) return
    const r = new SR()
    r.lang = 'es-ES'
    r.continuous = false
    r.interimResults = true

    r.onstart = () => { setIsListening(true) }

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
      if (preview) setText(preview)

      clearTimeout(silenceRef.current)
      silenceRef.current = setTimeout(() => {
        sessionActiveRef.current = false
        try { r.stop() } catch {}
      }, SILENCE_MS)
    }

    r.onerror = (ev) => {
      const recoverable = ev?.error === 'no-speech' || ev?.error === 'aborted'
      if (recoverable && sessionActiveRef.current &&
          Date.now() - sessionStartRef.current < MAX_SESSION_MS) {
        return
      }
      sessionActiveRef.current = false
      isRunningRef.current = false
      clearTimeout(silenceRef.current)
      clearTimeout(restartTimerRef.current)
      setIsListening(false)
      // Errores bloqueantes: antes fallaban en silencio y el usuario veía
      // "el mic no hace nada". Ahora los reflejamos en la burbuja de reply.
      const blocking = ev?.error
      if (blocking === 'not-allowed' || blocking === 'service-not-allowed') {
        // En iOS Safari, not-allowed puede dispararse aunque el permiso del
        // sistema esté concedido (bug conocido de WebKit, especialmente en
        // PWA standalone). Mostrar "Permiso denegado" ahí contradice a
        // Ajustes. Degradamos al dictado por teclado, que sí funciona.
        if (isIOSSafari()) {
          setReply({
            content: 'En iPhone, si el dictado web no arranca puedes usar el micrófono del teclado: toca el campo y pulsa el icono de micrófono sobre el teclado.',
            actions: [],
          })
          setTimeout(() => inputRef.current?.focus(), 60)
        } else {
          setReply({
            content: 'Permiso de micrófono denegado. Ábrelo en los ajustes del sistema y vuelve a intentarlo.',
            actions: [],
          })
        }
      } else if (blocking === 'audio-capture') {
        setReply({
          content: 'No se pudo acceder al micrófono. Revisa que otra app no lo esté usando.',
          actions: [],
        })
      }
    }

    r.onend = () => {
      isRunningRef.current = false

      // Si el usuario sigue queriendo dictar y no pasamos del tope, relanzamos.
      if (sessionActiveRef.current &&
          Date.now() - sessionStartRef.current < MAX_SESSION_MS) {
        clearTimeout(restartTimerRef.current)
        restartTimerRef.current = setTimeout(() => {
          if (!sessionActiveRef.current) return
          try {
            r.start()
            isRunningRef.current = true
          } catch {
            setTimeout(() => {
              if (!sessionActiveRef.current) return
              try {
                r.start()
                isRunningRef.current = true
              } catch {
                sessionActiveRef.current = false
                clearTimeout(silenceRef.current)
                setIsListening(false)
                const txt = finalTextRef.current.trim()
                finalTextRef.current = ''
                if (txt) handleSendRef.current?.(txt)
              }
            }, 140)
          }
        }, 70)
        return
      }

      // Fin real de sesión: enviar lo acumulado.
      // Usamos handleSendRef en lugar de handleSend directo: el effect de SR
      // se monta una sola vez, así que el closure sobre handleSend capturaba
      // events/tasks/memories del primer render y el dictado terminaba
      // invocándose con estado desactualizado.
      clearTimeout(silenceRef.current)
      clearTimeout(restartTimerRef.current)
      setIsListening(false)
      const txt = finalTextRef.current.trim()
      finalTextRef.current = ''
      if (txt) handleSendRef.current?.(txt)
    }

    srRef.current = r
    return () => {
      clearTimeout(silenceRef.current)
      clearTimeout(restartTimerRef.current)
      try { r.abort() } catch {}
    }
  }, [])

  async function handleSend(input) {
    const msg = (input ?? text).trim()
    if (!msg || isThinking) return

    setText('')
    setIsListening(false)
    setReply(null)
    // Cerrar sesión de voz si estaba abierta — evita que onend auto-relance.
    sessionActiveRef.current = false
    clearTimeout(silenceRef.current)
    clearTimeout(restartTimerRef.current)
    try { srRef.current?.stop() } catch {}

    setIsThinking(true)

    historyRef.current = [...historyRef.current, { role: 'user', content: msg }]

    try {
      const result = await callFocusAssistant({
        message: msg,
        events,
        tasks,
        memories,
        history: historyRef.current.slice(0, -1).slice(-20),
      })
      const { reply: replyText, actions = [] } = result

      // Ejecutar acciones en el calendario, tareas y memorias
      for (const action of actions) {
        if (action.type === 'add_event' && action.event) {
          onAddEvent?.(action.event)
        } else if (action.type === 'edit_event' && action.id) {
          const realId = events.some(e => e.id === action.id)
            ? action.id
            : (events.find(e => e.title === action.updates?.title || e.time === action.updates?.time)?.id || null)
          if (realId) onEditEvent?.(realId, action.updates ?? {})
        } else if (action.type === 'delete_event' && action.id) {
          const realId = events.some(e => e.id === action.id)
            ? action.id
            : resolveEventIdFromReply(events, replyText, action)
          if (realId) onDeleteEvent?.(realId)
          else console.warn('[Nova] delete_event con id no encontrado:', action.id)
        } else if (action.type === 'add_task' && action.task) {
          // Si Nova emitió la tarea ligada a un evento (linkedEventId, o
          // linkedEventTitle/linkedEventTime como fallback), resolvemos el id
          // real del evento para que la tarea aparezca como subtarea debajo
          // del bloque correspondiente en Mi Día.
          const linkedEventId = resolveLinkedEventId(events, action.task)
          const taskPayload = linkedEventId
            ? { ...action.task, linkedEventId }
            : action.task
          onAddTask?.(taskPayload)
        } else if (action.type === 'toggle_task' && action.id) {
          const realId = tasks.some(t => t.id === action.id)
            ? action.id
            : (tasks.find(t => (t.label || '').toLowerCase() === String(action.label || '').toLowerCase())?.id || null)
          if (realId) onToggleTask?.(realId)
        } else if (action.type === 'delete_task' && action.id) {
          const realId = tasks.some(t => t.id === action.id)
            ? action.id
            : (tasks.find(t => (t.label || '').toLowerCase() === String(action.label || '').toLowerCase())?.id || null)
          if (realId) onDeleteTask?.(realId)
        } else if (action.type === 'remember' && action.memory) {
          addMemory?.(action.memory)
        }
      }

      historyRef.current = [...historyRef.current, { role: 'assistant', content: replyText || '' }]
      try {
        sessionStorage.setItem('nova_history', JSON.stringify(historyRef.current.slice(-40)))
      } catch {}

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

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setReply(null)
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
      const extracted = Array.isArray(data?.events) ? data.events : []

      if (extracted.length === 0) {
        setReply({ content: 'No encontré eventos claros en la foto. Intenta con otra o descríbelos con texto.', actions: [] })
      } else {
        const actions = []
        for (const ev of extracted) {
          const newEvent = {
            id: `${Date.now()}-${Math.random()}`,
            title: ev.title,
            time: ev.time ?? '',
            date: ev.date ?? null,
            description: '',
            section: 'focus',
            icon: 'event',
            dotColor: 'bg-secondary-container',
            featured: false,
          }
          onAddEvent?.(newEvent)
          actions.push({ type: 'add_event', event: newEvent })
        }
        const summary = extracted.length === 1
          ? `Agregué 1 evento desde la foto: "${extracted[0].title}".`
          : `Agregué ${extracted.length} eventos desde la foto.`
        setReply({ content: summary, actions })
      }
    } catch {
      setReply({ content: 'No pude analizar la foto. Intenta de nuevo.', actions: [] })
    } finally {
      setIsAnalyzingPhoto(false)
    }
  }

  // Mantener la ref a la última versión de handleSend en cada render.
  useEffect(() => { handleSendRef.current = handleSend })

  function toggleMic() {
    if (isThinking) return
    // Sin Web Speech API en absoluto (desktop Firefox, navegadores antiguos).
    // En iOS Safari sí existe, así que no caemos aquí — dejamos que intente y
    // onerror degrada al teclado si realmente falla.
    if (!SR) {
      setReply({
        content: isIOSSafari()
          ? 'En iPhone puedes dictar con el micrófono del teclado: toca el campo y pulsa el icono de micrófono sobre el teclado.'
          : 'Este navegador no soporta dictado por voz. Escribe tu mensaje.',
        actions: [],
      })
      setTimeout(() => inputRef.current?.focus(), 60)
      return
    }
    const r = srRef.current
    if (!r) return

    // Si ya está escuchando, el usuario quiere detener: cerramos sesión.
    if (isListening || isRunningRef.current) {
      sessionActiveRef.current = false
      clearTimeout(silenceRef.current)
      clearTimeout(restartTimerRef.current)
      try { r.stop() } catch {}
      return
    }

    // Arranque de sesión nueva.
    finalTextRef.current = ''
    setText('')
    setReply(null)
    sessionActiveRef.current = true
    sessionStartRef.current = Date.now()
    try {
      r.start()
      isRunningRef.current = true
    } catch {
      // InvalidStateError por engine aún liberando lock — abort y reintenta.
      sessionActiveRef.current = false
      try { r.abort() } catch {}
      isRunningRef.current = false
      setTimeout(() => {
        try {
          sessionActiveRef.current = true
          sessionStartRef.current = Date.now()
          r.start()
          isRunningRef.current = true
        } catch {
          sessionActiveRef.current = false
        }
      }, 120)
    }
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
                              {describeAction(a)}
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

        {/* Input bar
            Layout: [cam] [input..............] [MIC] [send]
            - Cámara a la izquierda (acción secundaria de media).
            - Mic separado de la cámara por todo el input: acción primaria de
              voz en la zona del pulgar, con relleno de color y tamaño superior
              al resto para ganar jerarquía clara.
            - Desktop conserva tamaños compactos vía lg:*. */}
        <div
          className={`flex items-center gap-2 rounded-2xl border bg-surface-container-lowest px-2 py-2 transition-all duration-200 ${
            isListening
              ? 'border-[#7c6bff]/50 shadow-[0_0_0_3px_rgba(124,107,255,0.12)]'
              : isFocused
              ? 'border-outline/30 shadow-sm'
              : 'border-outline/15'
          }`}
        >
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={isThinking || isAnalyzingPhoto}
            aria-label="Enviar foto"
            className="flex h-10 w-10 lg:h-9 lg:w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-container text-outline hover:bg-surface-container-high hover:text-on-surface transition-colors disabled:opacity-40 select-none"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
          >
            <motion.span
              className="material-symbols-outlined text-[1.2rem] lg:text-[1.05rem]"
              animate={isAnalyzingPhoto ? { rotate: 360 } : { rotate: 0 }}
              transition={isAnalyzingPhoto ? { duration: 1.2, repeat: Infinity, ease: 'linear' } : {}}
              style={{ pointerEvents: 'none' }}
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

          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => {
              setIsFocused(true)
              // iOS PWA a veces no desplaza el input al abrir el teclado.
              // Forzamos scroll tras la animación del teclado (~280ms) como
              // red de seguridad.
              setTimeout(() => {
                inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }, 280)
            }}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => e.key === 'Enter' && hasText && handleSend()}
            placeholder={isAnalyzingPhoto ? 'Analizando foto…' : isListening ? 'Escuchando…' : 'Habla con Nova...'}
            disabled={isThinking || isAnalyzingPhoto}
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="off"
            // text-[16px] es crítico en iOS: Safari auto-zooma al enfocar
            // cualquier input con font-size < 16px, arruinando el layout.
            className="flex-1 min-w-0 bg-transparent text-[16px] text-on-surface outline-none placeholder:text-outline/50 disabled:opacity-50"
          />

          {/* Mic — versión única y discreta (MicButton). */}
          {/* No gateamos `disabled` con `!SR`: en Safari iPhone webkitSpeechRecognition
              no existe y el HTML `disabled` mataba el tap sin feedback. El botón
              ahora responde siempre y toggleMic maneja el fallback. */}
          <MicButton
            isListening={isListening}
            disabled={isThinking}
            onToggle={toggleMic}
          />

          <AnimatePresence>
            {isActive && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                onClick={() => hasText && handleSend()}
                disabled={isThinking || !hasText}
                className={`flex h-10 w-10 lg:h-9 lg:w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors select-none ${
                  hasText && !isThinking
                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                    : 'bg-surface-container text-outline/40'
                }`}
                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
              >
                <span className="material-symbols-outlined text-[1.2rem] lg:text-[1.05rem]" style={{ pointerEvents: 'none' }}>arrow_upward</span>
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
      className="fixed left-0 right-0 z-30 flex flex-col items-center gap-3 px-5"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 116px)' }}
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
          {/* [cam] [input] [MIC] [send] — mismo orden que el modo inline.
              Mismo patrón <button>+motion.span que inline para evitar
              que iOS Safari pierda taps cuando motion.button re-renderiza. */}
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={isThinking || isAnalyzingPhoto}
            aria-label="Enviar foto"
            className="flex h-10 w-10 lg:h-9 lg:w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-white/40 hover:bg-white/10 hover:text-white/60 transition-colors disabled:opacity-40 select-none"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
          >
            <motion.span
              className="material-symbols-outlined text-[1.2rem] lg:text-[1.05rem]"
              animate={isAnalyzingPhoto ? { rotate: 360 } : { rotate: 0 }}
              transition={isAnalyzingPhoto ? { duration: 1.2, repeat: Infinity, ease: 'linear' } : {}}
              style={{ pointerEvents: 'none' }}
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

          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => {
              setIsFocused(true)
              setTimeout(() => {
                inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }, 280)
            }}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => e.key === 'Enter' && hasText && handleSend()}
            placeholder={isAnalyzingPhoto ? 'Analizando foto…' : isListening ? 'Escuchando…' : 'Habla con Nova...'}
            disabled={isThinking || isAnalyzingPhoto}
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="off"
            className="flex-1 min-w-0 bg-transparent text-[16px] text-white outline-none placeholder:text-white/25 disabled:opacity-50"
          />

          {/* Mic — versión única y discreta (MicButton). El modo floating
              vive sobre un fondo oscuro, pero mantenemos el mismo estilo
              para no volver a divergir entre vistas. */}
          {/* No gateamos `disabled` con `!SR`: en Safari iPhone webkitSpeechRecognition
              no existe y el HTML `disabled` mataba el tap sin feedback. El botón
              ahora responde siempre y toggleMic maneja el fallback. */}
          <MicButton
            isListening={isListening}
            disabled={isThinking}
            onToggle={toggleMic}
          />

          <AnimatePresence>
            {isActive && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                onClick={() => hasText && handleSend()}
                disabled={isThinking || !hasText}
                className={`flex h-10 w-10 lg:h-9 lg:w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors select-none ${
                  hasText && !isThinking
                    ? 'bg-white text-slate-900 hover:bg-white/90'
                    : 'bg-white/[0.06] text-white/20'
                }`}
                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
              >
                <span className="material-symbols-outlined text-[1.2rem] lg:text-[1.05rem]" style={{ pointerEvents: 'none' }}>arrow_upward</span>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}

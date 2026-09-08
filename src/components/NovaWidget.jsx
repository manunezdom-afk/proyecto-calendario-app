import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserProfile } from '../hooks/useUserProfile'
import { useUserMemories } from '../hooks/useUserMemories'
import MicButton from './MicButton'
import { logSignal } from '../services/signalsService'
import { getCachedBehavior } from '../services/behaviorAnalysis'
import { apiFetch } from '../lib/apiClient'
import { isIOSSafari } from '../lib/permissions'
import { createVAD } from '../lib/voiceActivityDetector'
import { readPreferenceSync } from '../hooks/useAppPreferences'
import { novaSay } from '../utils/novaPersonality'
import { useAuth } from '../context/AuthContext'
import { prepareAssistantResponse, applyAssistantActions, enqueueAssistantReview, completedRetryableFailure, actionLabel } from '../utils/assistantContract.js'
import { subscribeModalStack } from '../utils/modalStack'
import { hasAIConsent, grantAIConsent } from '../lib/aiConsent'
import AIConsentCard from './AIConsentCard'
import { advanceAccountEpoch } from '../utils/verifiedMutation.js'
import { assistantSessionKey, readAssistantHistory, prepareLogicalRequest, clearLogicalRequest } from '../utils/assistantSession.js'

// En Safari iPhone webkitSpeechRecognition existe desde iOS 14.5 y sí funciona
// en Safari regular con permiso concedido. Antes gateábamos SR=null
// preventivamente en todo iOS Safari — el mic nunca intentaba dictar en
// iPhone y siempre caía al banner de teclado. Ahora dejamos que intente; si
// realmente falla con 'not-allowed' en iOS Safari (típico en PWA standalone),
// onerror degrada al dictado por teclado.
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

function NovaWidget({
  events = [],
  tasks = [],
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
  onToggleTask,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onProposeActions,   // (actions, {reply}) => void — modo propuesta
  proposeMode = false, // El contrato exige revisión para propuestas, borrados y memorias.
  onOpenInbox,
  isDesktop = false,
}) {
  const { profile } = useUserProfile()
  const { user } = useAuth()
  const { memories, addMemory, deleteMemory, deleteMemories } = useUserMemories()
  const epochRef = useRef(null)
  epochRef.current = advanceAccountEpoch(epochRef.current, user?.id)
  const liveRef = useRef(null)
  liveRef.current = { epoch: epochRef.current, userId: user?.id, events, tasks, memories, onAddEvent, onEditEvent, onDeleteEvent,
    onAddTask, onUpdateTask, onDeleteTask, onAddMemory: addMemory, onDeleteMemory: deleteMemory, onDeleteMemories: deleteMemories }
  const busyRef = useRef(false)
  const requestRef = useRef(null)
  const photoRequestRef = useRef(null)
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const [consentPendingPhoto, setConsentPendingPhoto] = useState(null)
  const [isOpen, setIsOpen]         = useState(false)
  const [input, setInput]           = useState('')
  const [reply, setReply]           = useState('')
  const [isLoading, setIsLoading]   = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [chips, setChips]           = useState([])  // { id, icon, label, done }
  const [location, setLocation]     = useState(null)
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false)
  const [photoPreview, setPhotoPreview]         = useState(null)
  const [modalCount, setModalCount]             = useState(0)
  // Mensaje retenido a la espera del consentimiento de IA (Guideline
  // 5.1.2(i)): el primer envío se pausa hasta que el usuario acepte.
  const [consentPendingMsg, setConsentPendingMsg] = useState(null)

  // Escondemos la pastilla de Nova mientras haya algún sheet/modal abierto
  // (QuickAdd, RecurringMeeting, etc.): superponerla sobre el contenido del
  // sheet no aporta — el usuario está en una tarea concreta — y además la
  // ocultamos sólo cuando Nova NO está abierta, porque si Nova sí está
  // abierta la pastilla es la forma de cerrarla.
  useEffect(() => subscribeModalStack(setModalCount), [])
  const hidePillForModal = modalCount > 0 && !isOpen
  const [chatHistory, setChatHistory] = useState(() => {
    try {
      const raw = sessionStorage.getItem(assistantSessionKey('history', user?.id))
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
  //     el state de React para gatillar start/stop desde el click del botón)
  //   · sessionActiveRef   — intención del usuario: "sigo queriendo dictar".
  //     Permite distinguir un onend natural del engine (que auto-relanzamos)
  //     de un stop() explícito por silencio o por botón (que cierra sesión).
  //   · sessionStartRef    — timestamp de inicio, usado para cortar sesiones
  //     que superen MAX_SESSION_MS aunque el engine quiera seguir.
  //   · silenceTimerRef    — timer que cortamos/reprogramamos en cada onresult
  //     (incluidos interim). Al expirar, cerramos la sesión. Antes era 900ms
  //     — demasiado agresivo, cortaba mini-pausas para pensar. Ahora 1800ms.
  //   · restartTimerRef    — delay pequeño tras onend para volver a llamar
  //     start() sin chocar con InvalidStateError (engine aún liberando locks).
  //   · finalTextRef       — acumulador de resultados finales a lo largo de la
  //     sesión. Se envía a sendMessage cuando la sesión se cierra de verdad.
  //   · sendMessageRef     — ref a la última versión de sendMessage, porque el
  //     useEffect del SR corre una sola vez y sendMessage depende de muchas
  //     piezas de estado/props.
  const isRunningRef    = useRef(false)
  const sessionActiveRef = useRef(false)
  const sessionStartRef  = useRef(0)
  const silenceTimerRef = useRef(null)
  const restartTimerRef = useRef(null)
  const finalTextRef    = useRef('')
  const sendMessageRef  = useRef(null)
  const openHistoryLengthRef = useRef(0)
  // VAD (Voice Activity Detector) corre en paralelo al SpeechRecognition.
  // Detecta fin-de-habla por audio real (no por ausencia de transcript) y
  // resetea el silenceTimer también con sonidos paralingüísticos como
  // "mmm" o respiraciones, que el SR ignora.
  const vadHandleRef = useRef(null)
  const [commitProgress, setCommitProgress] = useState(0)

  // Timer-only: 1800ms de tolerancia para pausas pensativas. Sólo se aplica
  // cuando el VAD no pudo arrancar (mic ocupado, navegador antiguo, etc.).
  const TIMER_ONLY_SILENCE_MS = 1800
  // Con VAD activo: 2200ms como red de seguridad por si el VAD no detectó
  // bien el silencio (entornos extremadamente ruidosos donde el noise floor
  // se calibró alto). El cierre real lo decide normalmente el VAD mucho antes.
  const VAD_FALLBACK_SILENCE_MS = 2200
  // Tope de sesión de dictado — si el engine del browser deja de funcionar
  // o el usuario se olvidó el mic abierto, cerramos a los 60s. Suficiente
  // para dictar un evento o tarea larga sin sentirse atado.
  const MAX_SESSION_MS = 60_000

  // El intervalo del silence timer depende de si el VAD está activo. Como el
  // useEffect del SR captura su closure, leemos el valor vivo desde un ref
  // para que cuando el VAD arranque/falle, el siguiente reset use el valor
  // correcto sin remontar el SR.
  const silenceMsRef = useRef(TIMER_ONLY_SILENCE_MS)

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
    historyRef.current = readAssistantHistory(sessionStorage, user?.id)
    requestRef.current = null; photoRequestRef.current = null
    setConsentPendingMsg(null); setConsentPendingPhoto(null)
    setChatHistory(historyRef.current)
    setReply(''); setChips([])
  }, [user?.id])

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

  // Capturar longitud de historia pre-existente al abrir.
  // Foco automático SÓLO en desktop. En mobile (bottom sheet) enfocar al
  // abrir dispara el teclado iOS y produce un salto visual feo: la sheet
  // entra estable con header + sugerencias y al instante el teclado la
  // colapsa. Ahora la sheet aterriza calma y el teclado sólo aparece
  // cuando el usuario toca el input explícitamente.
  useEffect(() => {
    if (isOpen) {
      openHistoryLengthRef.current = historyRef.current.length
      if (isDesktop) {
        setTimeout(() => inputRef.current?.focus(), 80)
      }
    }
  }, [isOpen, isDesktop])

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
  // Objetivos de esta versión:
  //   1. Tolerar mini-pausas: el silencio de corte sube a 1800ms (antes 900ms).
  //   2. Aguantar dictado largo: si el engine termina por su cuenta (iOS Safari
  //      corta agresivo tras una frase, Chrome tira 'no-speech' a los ~5s),
  //      reiniciamos automáticamente mientras la sesión siga activa y no
  //      superemos MAX_SESSION_MS.
  //   3. Quitamos onspeechend — disparaba stop() inmediato en cuanto el browser
  //      detectaba una respiración, cortando al usuario mientras pensaba. El
  //      único criterio de fin es ahora nuestro silenceTimer basado en onresult.
  //   4. Único punto de flush a sendMessage: al cerrar sesión de verdad
  //      (sessionActiveRef=false + onend).
  useEffect(() => {
    if (!SR) return
    const r = new SR()
    r.lang = 'es-ES'
    // continuous=false es más estable cross-browser (iOS ignora continuous=true
    // y algunos Android tiran errores raros). Para dictado largo, nosotros
    // auto-relanzamos en onend si la sesión sigue activa.
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

      // Reset silence timer en cada onresult (incluidos interim → el engine
      // los emite mientras el usuario habla, así que el timer sólo avanza
      // cuando hay silencio real). Cuando hay VAD activo, el VAD también
      // dispara este reset por audio sobre umbral (incluyendo "mmm" y
      // respiraciones que el SR ignora) y cierra la sesión por hangover
      // antes de que llegue este timeout.
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = setTimeout(() => {
        // Silencio prolongado → cerramos sesión de verdad.
        sessionActiveRef.current = false
        try { r.stop() } catch {}
      }, silenceMsRef.current)
    }

    r.onerror = (ev) => {
      // 'no-speech' y 'aborted' son comunes cuando el engine se auto-cierra
      // sin haber oído nada. Si la sesión sigue activa y bajo el tope, dejamos
      // que onend decida si relanzar.
      const recoverable = ev?.error === 'no-speech' || ev?.error === 'aborted'
      if (recoverable && sessionActiveRef.current &&
          Date.now() - sessionStartRef.current < MAX_SESSION_MS) {
        return
      }
      sessionActiveRef.current = false
      isRunningRef.current = false
      clearTimeout(silenceTimerRef.current)
      clearTimeout(restartTimerRef.current)
      try { vadHandleRef.current?.stop() } catch {}
      vadHandleRef.current = null
      silenceMsRef.current = TIMER_ONLY_SILENCE_MS
      setCommitProgress(0)
      setIsListening(false)
      // Antes los errores bloqueantes caían en silencio. Si el usuario está
      // en un navegador que soporta SR pero denegó el permiso (o el OS lo
      // bloquea), ahora se lo decimos en vez de que "el mic no haga nada".
      const blocking = ev?.error
      if (blocking === 'not-allowed' || blocking === 'service-not-allowed') {
        // En iOS Safari, not-allowed puede dispararse aun con permiso del
        // sistema concedido (bug conocido, sobre todo en PWA standalone).
        // Mostrar "denegado" ahí contradice a Ajustes. Degradamos al dictado
        // del teclado nativo, que siempre funciona en iPhone.
        if (isIOSSafari()) {
          setReply('En iPhone, si el dictado web no arranca puedes usar el micrófono del teclado: toca el campo y pulsa el icono de micrófono sobre el teclado.')
          setTimeout(() => inputRef.current?.focus(), 60)
        } else {
          setReply('Permiso de micrófono denegado. Ábrelo en los ajustes del sistema y vuelve a intentarlo.')
        }
      } else if (blocking === 'audio-capture') {
        setReply('No se pudo acceder al micrófono. Revisa que otra app no lo esté usando.')
      }
    }

    r.onend = () => {
      isRunningRef.current = false

      // Si el usuario sigue queriendo dictar y no pasamos del tope, relanzamos
      // el engine. Esto es lo que permite dictado largo sin sentirse atado.
      // Importante: no tocamos silenceTimerRef aquí — sigue corriendo entre
      // reinicios para cerrar sesión por silencio total.
      if (sessionActiveRef.current &&
          Date.now() - sessionStartRef.current < MAX_SESSION_MS) {
        clearTimeout(restartTimerRef.current)
        restartTimerRef.current = setTimeout(() => {
          if (!sessionActiveRef.current) return
          try {
            r.start()
            isRunningRef.current = true
          } catch {
            // start() puede tirar InvalidStateError si el engine aún no
            // liberó el lock. Un retry más tarde suele bastar.
            setTimeout(() => {
              if (!sessionActiveRef.current) return
              try {
                r.start()
                isRunningRef.current = true
              } catch {
                sessionActiveRef.current = false
                clearTimeout(silenceTimerRef.current)
                setIsListening(false)
                // Flush lo que haya si el engine no pudo seguir.
                const text = finalTextRef.current.trim()
                finalTextRef.current = ''
                if (text) { setInput(text); sendMessageRef.current?.(text) }
              }
            }, 140)
          }
        }, 70)
        return
      }

      // Fin de sesión real → limpiar y enviar lo acumulado.
      clearTimeout(silenceTimerRef.current)
      clearTimeout(restartTimerRef.current)
      try { vadHandleRef.current?.stop() } catch {}
      vadHandleRef.current = null
      silenceMsRef.current = TIMER_ONLY_SILENCE_MS
      setCommitProgress(0)
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
      clearTimeout(restartTimerRef.current)
      try { vadHandleRef.current?.stop() } catch {}
      vadHandleRef.current = null
      try { r.abort() } catch {}
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function startVoice() {
    if (isLoading) return
    // Sin Web Speech API (desktop Firefox, navegadores antiguos). En iOS
    // Safari la API sí existe, así que no caemos acá — dejamos que intente y
    // onerror degrada al teclado si falla.
    if (!SR) {
      setReply(isIOSSafari()
        ? 'En iPhone puedes dictar con el micrófono del teclado: toca el campo y pulsa el icono de micrófono sobre el teclado.'
        : 'Este navegador no soporta dictado por voz. Escribe tu mensaje.')
      setTimeout(() => inputRef.current?.focus(), 60)
      return
    }
    const r = srRef.current
    if (!r) return
    // Si una sesión anterior quedó a medio cerrar (onend aún no disparó),
    // abort() fuerza reset; reintentamos tras un tick para que el engine
    // libere el lock.
    if (isRunningRef.current) {
      sessionActiveRef.current = false
      try { r.abort() } catch {}
      isRunningRef.current = false
      setTimeout(() => startVoice(), 80)
      return
    }
    try {
      finalTextRef.current = ''
      setInput('')
      sessionActiveRef.current = true
      sessionStartRef.current = Date.now()
      r.start()
      isRunningRef.current = true
      setIsListening(true)
      // Arrancamos el VAD en paralelo. Si falla (mic ocupado, getUserMedia
      // bloqueado, browser sin AudioContext) seguimos con el timer-only path
      // — el dictado igual funciona, sólo perdemos la mejora de latencia.
      bootVAD()
    } catch {
      sessionActiveRef.current = false
      try { r.abort() } catch {}
      isRunningRef.current = false
      setIsListening(false)
    }
  }

  // Arranca el VAD en paralelo al SpeechRecognition. La sesión es la
  // referencia canónica de "intención del usuario": si el usuario apretó stop
  // antes de que getUserMedia resolviera (ocurre en iOS porque el prompt de
  // permiso puede ir lento), descartamos el handle al instante para no dejar
  // un AudioContext huérfano consumiendo mic.
  async function bootVAD() {
    if (vadHandleRef.current) return
    const mySessionStart = sessionStartRef.current
    try {
      const handle = await createVAD({
        onSpeechActivity: () => {
          // El VAD detectó audio sobre umbral. Reseteamos el silence timer
          // (red de seguridad) — lo que cierra realmente la sesión es el
          // hangover del VAD vía onSpeechEnd.
          if (!sessionActiveRef.current) return
          clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = setTimeout(() => {
            sessionActiveRef.current = false
            try { srRef.current?.stop() } catch {}
          }, silenceMsRef.current)
        },
        onCountdown: (remaining, total) => {
          // Feedback visual del hangover en el botón. 0 = no estamos en
          // hangover (oculta el anillo). > 0 = arco proporcional al tiempo
          // que queda antes de cerrar.
          const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0
          setCommitProgress(frac)
        },
        onSpeechEnd: () => {
          // Silencio confirmado por audio real. Cerramos sesión inmediato
          // sin esperar el timeout de fallback — esto es lo que da la
          // sensación tipo ChatGPT de "0 lag" al terminar de hablar.
          if (!sessionActiveRef.current) return
          sessionActiveRef.current = false
          try { srRef.current?.stop() } catch {}
        },
      })
      // Mientras getUserMedia resolvía, el usuario pudo cerrar la sesión.
      // Si la sesión actual ya no es la nuestra, descartamos el handle.
      if (!sessionActiveRef.current || sessionStartRef.current !== mySessionStart) {
        try { handle.stop() } catch {}
        return
      }
      vadHandleRef.current = handle
      // Con VAD activo subimos el silence timer a 2.2s como red de
      // seguridad. El cierre real ocurre por onSpeechEnd, mucho antes.
      silenceMsRef.current = VAD_FALLBACK_SILENCE_MS
      // Si ya había un timer corriendo con el valor antiguo, lo
      // re-armamos con el nuevo umbral.
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = setTimeout(() => {
          sessionActiveRef.current = false
          try { srRef.current?.stop() } catch {}
        }, silenceMsRef.current)
      }
    } catch {
      // Sin VAD: seguimos con el timer-only path. No avisamos al usuario
      // — el dictado funciona igual, sólo con la latencia de antes.
      vadHandleRef.current = null
      silenceMsRef.current = TIMER_ONLY_SILENCE_MS
    }
  }

  function stopVoice() {
    // Marcar sesión como cerrada ANTES de stop() — así onend no auto-relanza.
    sessionActiveRef.current = false
    clearTimeout(silenceTimerRef.current)
    clearTimeout(restartTimerRef.current)
    try { vadHandleRef.current?.stop() } catch {}
    vadHandleRef.current = null
    setCommitProgress(0)
    silenceMsRef.current = TIMER_ONLY_SILENCE_MS
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
        // Auto-focus sólo en desktop. En mobile el tap abre la sheet pero
        // no enfoca el input — el teclado aparece sólo si el usuario toca
        // el campo (criterio explícito del usuario para evitar el salto).
        if (!prev && isDesktop) setTimeout(() => inputRef.current?.focus(), 60)
        return !prev
      })
    }
  }

  function onPillPointerLeave() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  async function handlePhoto(e, selectedFile = null, consentGranted = false) {
    const file = selectedFile || e?.target?.files?.[0]
    if (e?.target) e.target.value = ''
    if (!file || busyRef.current) return
    setIsOpen(true)
    if (!consentGranted && !hasAIConsent()) { setConsentPendingPhoto(file); return }
    busyRef.current = true
    const sentContext = liveRef.current
    const signature = `${sentContext.userId || 'guest'}:${file.name}:${file.size}:${file.lastModified}`
    try {
      const saved = await prepareLogicalRequest(localStorage, sentContext.userId, 'widget_photo', signature)
      photoRequestRef.current = { ...saved, signature, now: saved.createdAt }
    } catch {
      busyRef.current = false
      setReply('No pude guardar la solicitud en este dispositivo. Inténtalo de nuevo.')
      return
    }
    if (!mountedRef.current || liveRef.current.epoch !== sentContext.epoch) { busyRef.current = false; return }
    const photoRequest = photoRequestRef.current
    const preview = URL.createObjectURL(file)
    setPhotoPreview(preview)
    setReply(''); setChips([]); setIsAnalyzingPhoto(true)
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      if (!mountedRef.current || liveRef.current.epoch !== sentContext.epoch) return
      const res = await apiFetch('/api/analyze-photo', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Id': photoRequest.id },
        body: JSON.stringify({ images: [{ base64, mediaType: file.type || 'image/jpeg' }],
          clientNow: photoRequest.now, clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!mountedRef.current || liveRef.current.epoch !== sentContext.epoch) return
      if (!res.ok) {
        if (completedRetryableFailure(res.status, data, photoRequest.id)) { photoRequestRef.current = null; clearLogicalRequest(localStorage, sentContext.userId, 'widget_photo') }
        throw new Error(res.status === 401 ? 'Inicia sesión para analizar fotos.' : 'No pude analizar la foto. Vuelve a intentarlo.')
      }
      const extracted = Array.isArray(data.events) ? data.events : []
      if (!extracted.length) { setReply(novaSay('photo_no_events', readPreferenceSync('novaPersonality'))); return }
      const prepared = prepareAssistantResponse({ mode: 'proposal', proposed_actions: extracted.map(event => ({ type: 'add_event', event })) }, sentContext, { requestId: photoRequest.id })
      const outcome = prepared.ok ? enqueueAssistantReview(prepared.actions, onProposeActions) : prepared
      setReply(outcome.message)
      if (outcome.ok) setChips(prepared.actions.map(action => ({ id: action.actionId, icon: 'event', label: actionLabel(action), done: true, proposed: true })))
    } catch (error) {
      if (mountedRef.current && liveRef.current.epoch === sentContext.epoch) setReply(error.message || novaSay('error_connection', readPreferenceSync('novaPersonality')))
    } finally {
      busyRef.current = false
      URL.revokeObjectURL(preview)
      if (mountedRef.current) { setIsAnalyzingPhoto(false); setPhotoPreview(null) }
    }
  }

  async function sendMessage(text, consentGranted = false) {
    const msg = (text ?? input).trim()
    // No chequeamos isListening aquí: el flush desde r.onend llega justo
    // después de setIsListening(false) y la closure capturada aún ve
    // isListening=true, así que la guardia descartaba el texto dictado.
    // El input está deshabilitado mientras se escucha, así que no hay otra
    // vía donde esta verificación sea necesaria.
    if (!msg || busyRef.current) return
    if (msg.length > 4000) {
      setReply('El mensaje es demasiado largo. Acórtalo por favor.')
      return
    }

    // Primer uso de Nova en este dispositivo: retener el mensaje y pedir
    // consentimiento para el envío a proveedores de IA antes de transmitir.
    if (!consentGranted && !hasAIConsent()) {
      setConsentPendingMsg(msg)
      return
    }

    busyRef.current = true
    const sentContext = liveRef.current
    let requestId
    try {
      requestRef.current = await prepareLogicalRequest(localStorage, sentContext.userId, 'widget', msg)
      requestId = requestRef.current.id
    } catch {
      busyRef.current = false
      setReply('No pude guardar la solicitud en este dispositivo. Inténtalo de nuevo.')
      return
    }
    if (!mountedRef.current || liveRef.current.epoch !== sentContext.epoch) { busyRef.current = false; return }
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
      const res = await apiFetch('/api/focus-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
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
          // Personalidad local del usuario → el backend la inyecta en el
          // system prompt del LLM para que el tono del reply la refleje.
          // readPreferenceSync toma el valor justo antes de enviar (sin lag
          // por re-render) y sanea valores inválidos al default 'focus'.
          novaPersonality: readPreferenceSync('novaPersonality'),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const code = data?.error
        // quota_exceeded ahora trae un message ya armado por plan
        // (free / early_access). Lo preferimos al texto genérico.
        const statusMsg = code === 'quota_exceeded' && data?.message
          ? data.message
          : ({
              rate_limit:           'Muchos mensajes seguidos. Espera unos segundos.',
              upstream_rate_limit:  'Muchos mensajes seguidos. Espera unos segundos.',
              upstream_overloaded:  'El servicio está sobrecargado. Reintenta.',
              invalid_api_key:      'Servicio no disponible en este momento.',
              no_api_key:           'Servicio no disponible en este momento.',
              message_too_long:     'Mensaje demasiado largo.',
              llm_bad_output:       'No pude procesarlo. Repite por favor.',
              auth_required:        'Inicia sesión para hablar con Hilante.',
              quota_exceeded:       'Llegaste al límite diario de mensajes. Vuelve mañana.',
            }[code] || data?.message || `Error ${res.status}`)
        const err = new Error(statusMsg)
        err.code = code
        err.completedRetryable = completedRetryableFailure(res.status, data, requestId)
        throw err
      }

      const data = await res.json()
      if (!mountedRef.current || liveRef.current.epoch !== sentContext.epoch) return
      const prepared = prepareAssistantResponse(data, sentContext, { requestId, forceReview: proposeMode })
      let outcome = prepared
      if (prepared.ok && prepared.kind === 'review') outcome = enqueueAssistantReview(prepared.actions, onProposeActions)
      if (prepared.ok && prepared.kind === 'execute') outcome = applyAssistantActions(prepared.actions, liveRef.current)
      if (outcome.ok && prepared.kind === 'review') {
        setChips(prepared.actions.map(action => ({ id: action.actionId, icon: 'auto_awesome', label: actionLabel(action), done: true, proposed: true })))
      } else {
        setChips((outcome.receipts || []).map(receipt => ({ id: receipt.action.actionId, icon: 'check_circle', label: receipt.message, done: true })))
      }
      const message = outcome.message || 'No pude aplicar la respuesta.'
      historyRef.current = [...historyRef.current, { role: 'assistant', content: message }]
      setChatHistory([...historyRef.current])
      setReply('')
      try { sessionStorage.setItem(assistantSessionKey('history', sentContext.userId), JSON.stringify(historyRef.current.slice(-40))) } catch {}
      if (outcome.ok || !prepared.ok) { requestRef.current = null; clearLogicalRequest(localStorage, sentContext.userId, 'widget') }
    } catch (err) {
      if (!mountedRef.current || liveRef.current.epoch !== sentContext.epoch) return
      if (err.code === 'assistant_updating') setInput(msg)
      if (err.completedRetryable) { requestRef.current = null; clearLogicalRequest(localStorage, sentContext.userId, 'widget') }
      const errMsg = err?.message && typeof err.message === 'string' && err.message.length < 200
        ? err.message
        : novaSay('error_connection', readPreferenceSync('novaPersonality'))
      historyRef.current = [...historyRef.current, { role: 'assistant', content: errMsg }]
      setChatHistory([...historyRef.current])
      setReply('')
    } finally {
      busyRef.current = false
      if (mountedRef.current) setIsLoading(false)
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
          <span className="text-[13px] font-semibold text-slate-700">Hilante</span>
        </div>
        <div className="flex items-center gap-1">
          {isDesktop && (
            <span className="text-[10px] text-slate-300 font-mono">⌘K</span>
          )}
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Cerrar Hilante"
            className={`flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors ${isDesktop ? 'w-6 h-6' : 'w-10 h-10'}`}
          >
            <span className={`material-symbols-outlined ${isDesktop ? 'text-[13px]' : 'text-[18px]'}`}>close</span>
          </button>
        </div>
      </div>

      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2 min-h-0 scroll-contain">
        {chatHistory.length === 0 && !isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
            <span
              className="material-symbols-outlined text-[36px] text-blue-200 mb-3"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              auto_awesome
            </span>
            <p className="text-[13px] font-semibold text-slate-500 text-center mb-1">
              ¿Qué necesitas?
            </p>
            <p className="text-[11.5px] text-slate-400 text-center max-w-[240px] leading-snug mb-4">
              Te ayudo a agendar y ordenar tu día. Revisa las propuestas antes de aplicarlas.
            </p>
            <div className="w-full max-w-[280px] space-y-1.5">
              {[
                { icon: 'event', text: 'Agenda gym mañana a las 7' },
                { icon: 'psychology', text: 'Reserva 2 horas enfocadas esta tarde' },
                { icon: 'swap_horiz', text: 'Libérame el viernes' },
              ].map((ex) => (
                <button
                  key={ex.text}
                  onClick={() => sendMessage(ex.text)}
                  className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-xl bg-slate-50 hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-colors active:scale-[0.98]"
                >
                  <span className="material-symbols-outlined text-[14px] text-blue-400 flex-shrink-0">
                    {ex.icon}
                  </span>
                  <span className="text-[12px] font-medium truncate">{ex.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {chatHistory.map((msg, i) => {
          // Pre-existing messages (loaded before this open) and user messages skip
          // the opacity-0 initial so there's no blank-flash on open or after sending.
          const skipFade = i < openHistoryLengthRef.current || msg.role === 'user'
          return (
            <motion.div
              key={i}
              initial={skipFade ? false : { opacity: 0, y: 6 }}
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
          )
        })}

        {/* Consentimiento IA de primer uso — retiene el mensaje hasta aceptar */}
        <AnimatePresence>
          {(consentPendingMsg != null || consentPendingPhoto != null) && (
            <AIConsentCard onAccept={() => {
              grantAIConsent()
              const file = consentPendingPhoto
              const message = consentPendingMsg
              setConsentPendingMsg(null); setConsentPendingPhoto(null)
              if (file) handlePhoto(null, file, true)
              else sendMessage(message, true)
            }} onCancel={() => {
              if (consentPendingMsg) setInput(consentPendingMsg)
              setConsentPendingMsg(null); setConsentPendingPhoto(null)
            }} />
          )}
        </AnimatePresence>

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
                  onClick={onOpenInbox}
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

      {/* Input
          Layout mobile:  [cam]  [ input................ ]  [ MIC ]  [send]
          - Cámara aislada a la izquierda (acción secundaria, media).
          - Mic separado de la cámara: va al otro lado, pegado al input antes
            del send, como una acción primaria de entrada.
          - En mobile el mic pasa a w-12 h-12 (48px) y estilo filled para
            ganar jerarquía clara sobre cámara y send.
          Layout desktop: orden similar, pero los tamaños compactos originales.
      */}
      <div className={`border-t border-slate-100 px-3 flex items-center flex-shrink-0 ${isDesktop ? 'gap-2 py-2' : 'gap-2 py-2.5'}`}>
        {/* Cámara */}
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          disabled={isLoading || isListening || isAnalyzingPhoto}
          className={`flex-shrink-0 flex items-center justify-center rounded-full text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:scale-90 transition-all disabled:opacity-30 ${isDesktop ? 'w-8 h-8' : 'w-11 h-11'}`}
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
          aria-label="Enviar foto a Hilante"
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

        {/* Input de texto — ahora entre cámara y mic para que el mic quede
            separado de la cámara (acción primaria en la zona del pulgar). */}
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
          }}
          placeholder={isAnalyzingPhoto ? 'Analizando foto…' : isListening ? 'Escuchando…' : 'Escribe o habla…'}
          disabled={isLoading || isListening || isAnalyzingPhoto}
          enterKeyHint="send"
          autoComplete="off"
          className={`flex-1 min-w-0 bg-transparent outline-none text-slate-700 placeholder:text-slate-300 disabled:opacity-50 ${isDesktop ? 'text-[13px]' : 'text-[15px]'}`}
        />

        {/* Mic — una sola versión, discreta y consistente en toda la app.
            Ghost idle + relleno Nova cuando escucha. Tamaño fijo 36×36 sin
            breakpoints para que no cambie entre Safari, Chrome, PWA,
            desktop o mobile.
            · Sin halo pulsante y sin ring: evita que Safari iOS pierda el
              tap cuando un sibling absoluto se anima entre touchstart y
              touchend. La señal de "escuchando" es el relleno + el
              ecualizador animado dentro del botón (layout estable).
            · Usa onPointerUp + onTouchEnd con guard anti-doble-fire en vez
              de onClick. Safari móvil a veces descarta el click sintético
              tras un micro-scroll; los eventos de puntero disparan aunque
              el click se pierda. */}
        {/* Importante: NO condicionamos `disabled` en `!SR`. En Safari iPhone
            webkitSpeechRecognition no existe y antes el botón salía con atributo
            HTML `disabled` → el tap llegaba pero moría en `fire()`. Ahora el
            botón sí responde y startVoice se encarga del fallback con guía al
            dictado nativo del teclado iOS. */}
        <MicButton
          isListening={isListening}
          disabled={isLoading || isAnalyzingPhoto}
          onToggle={isListening ? stopVoice : startVoice}
          commitProgress={commitProgress}
        />

        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || isLoading || isAnalyzingPhoto}
          className={`flex-shrink-0 flex items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-800 active:scale-90 transition-all disabled:opacity-25 disabled:bg-slate-300 ${isDesktop ? 'w-7 h-7' : 'w-10 h-10'}`}
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
        {!isOpen && !hidePillForModal && (
          <motion.div
            key="pill-wrap"
            id="nova-widget"
            className={`${pillPositionClass} z-[60]`}
            style={pillPositionStyle}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{    opacity: 0, scale: 0.7 }}
            transition={{ type: 'spring', damping: 18, stiffness: 300 }}
          >
            <div className="relative">
              {/* Halo ambiental — respiración sutil cuando Nova está en reposo.
                  pointer-events:none para no interferir con el click del botón. */}
              <motion.span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-2xl"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6 0%, #7c3aed 100%)',
                  filter: 'blur(10px)',
                  zIndex: 0,
                }}
                initial={{ opacity: 0.18, scale: 1 }}
                animate={{ opacity: [0.18, 0.42, 0.18], scale: [1, 1.08, 1] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              />
              <button
                onPointerDown={onPillPointerDown}
                onPointerUp={onPillPointerUp}
                onPointerLeave={onPillPointerLeave}
                className="relative flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-2xl text-white text-[13px] font-semibold select-none active:scale-95 transition-transform"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6 0%, #7c3aed 100%)',
                  boxShadow: '0 8px 24px rgba(59,130,246,0.35), 0 2px 8px rgba(0,0,0,0.1)',
                }}
                aria-label="Abrir Hilante"
              >
                <motion.span
                  className="material-symbols-outlined text-[17px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                  animate={{ rotate: [0, 8, -8, 0] }}
                  transition={{ duration: 3, repeat: Infinity, repeatDelay: 4 }}
                >
                  auto_awesome
                </motion.span>
                Hilante
              </button>
            </div>
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
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{
                y: { type: 'spring', damping: 32, stiffness: 340 },
                opacity: { duration: 0.08 },
              }}
              className="absolute left-0 right-0 bottom-0 bg-white rounded-t-[22px] flex flex-col shadow-2xl kb-aware"
              style={{
                height: 'min(85dvh, 640px)',
                // safe-area-inset-bottom: cubre home indicator cuando NO hay
                // teclado. iOS reduce este valor a 0 cuando el teclado está
                // visible (porque el indicator queda tapado), así no
                // duplicamos espacio con el WebView que ya se reacomoda.
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              }}
              role="dialog"
              aria-label="Hilante"
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

// memo: el padre (App.jsx) re-renderiza cuando abre cualquier modal/sheet
// (importExport, palette, notifPanel) o cambia inboxOpen. Sin memo, NovaWidget
// re-renderiza por completo en cada uno — y este árbol con motion + chat
// + speech recognition no es barato. Con onProposeActions y onOpenInbox
// envueltos en useCallback en App.jsx, las props quedan estables y el
// shallow-compare de memo evita el re-render.
export default memo(NovaWidget)

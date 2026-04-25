import { useState, useRef, useEffect } from 'react'
import { createVAD } from '../lib/voiceActivityDetector'

// Hook reusable de dictado por voz con la misma calidad que Nova/FocusBar:
// SpeechRecognition + VAD por audio real con histéresis, hangover prosódico
// y countdown visual.
//
// Diseñado para componentes que necesitan llenar un input con texto
// dictado (QuickAddSheet, búsquedas, etc) sin tener que copiar 200 líneas
// de manejo de sesión, restarts, errores y limpieza.
//
// Uso:
//   const dictation = useVoiceDictation({
//     onTranscript: (text) => setInput(text),
//     onFinalize:   (text) => setInput(text),
//     onError:      (code) => mostrarMensaje(code),
//   })
//   <MicButton
//     isListening={dictation.isListening}
//     commitProgress={dictation.commitProgress}
//     onToggle={dictation.toggle}
//   />

const SR = typeof window !== 'undefined' &&
  (/** @type {any} */ (window).SpeechRecognition ||
   /** @type {any} */ (window).webkitSpeechRecognition)

// Mismos umbrales que NovaWidget/FocusBar — coherencia de sensación entre
// las superficies con voz.
const TIMER_ONLY_SILENCE_MS = 1800
const VAD_FALLBACK_SILENCE_MS = 2200
const MAX_SESSION_MS = 60_000

/**
 * @param {Object} opts
 * @param {(text: string) => void} [opts.onTranscript] — texto en vivo (incluye
 *   interim). Se llama muchas veces por segundo mientras el usuario habla.
 * @param {(text: string) => void} [opts.onFinalize] — texto final consolidado
 *   al cerrar la sesión (silencio confirmado o stop manual).
 * @param {(code: string) => void} [opts.onError] — códigos:
 *   'unsupported' | 'not-allowed' | 'service-not-allowed' | 'audio-capture'.
 * @param {string} [opts.lang]
 */
export function useVoiceDictation({
  onTranscript,
  onFinalize,
  onError,
  lang = 'es-ES',
} = {}) {
  const [isListening, setIsListening] = useState(false)
  const [commitProgress, setCommitProgress] = useState(0)

  const srRef             = useRef(null)
  const isRunningRef      = useRef(false)
  const sessionActiveRef  = useRef(false)
  const sessionStartRef   = useRef(0)
  const silenceTimerRef   = useRef(null)
  const restartTimerRef   = useRef(null)
  const finalTextRef      = useRef('')
  const vadHandleRef      = useRef(null)
  const silenceMsRef      = useRef(TIMER_ONLY_SILENCE_MS)

  // Mantenemos las callbacks en un ref vivo: el effect del SR se monta una
  // sola vez, así que sin esto los handlers usarían closures viejos del
  // primer render.
  const callbacksRef = useRef({ onTranscript, onFinalize, onError })
  useEffect(() => {
    callbacksRef.current = { onTranscript, onFinalize, onError }
  })

  useEffect(() => {
    if (!SR) return
    const r = new SR()
    r.lang = lang
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
        finalTextRef.current =
          (finalTextRef.current + ' ' + finalAdd).replace(/\s+/g, ' ').trim()
      }
      const preview = (finalTextRef.current + ' ' + interim).replace(/\s+/g, ' ').trim()
      if (preview) callbacksRef.current.onTranscript?.(preview)

      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = setTimeout(() => {
        sessionActiveRef.current = false
        try { r.stop() } catch {}
      }, silenceMsRef.current)
    }

    r.onerror = (ev) => {
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
      const code = ev?.error
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
        callbacksRef.current.onError?.(code)
      }
    }

    r.onend = () => {
      isRunningRef.current = false

      // Auto-relanzamos mientras la sesión siga activa: el engine cierra
      // solo cada ~5-15s en Chrome y al final de cada frase en iOS Safari.
      // Sin esto, el dictado largo se cortaría.
      if (sessionActiveRef.current &&
          Date.now() - sessionStartRef.current < MAX_SESSION_MS) {
        clearTimeout(restartTimerRef.current)
        restartTimerRef.current = setTimeout(() => {
          if (!sessionActiveRef.current) return
          try { r.start(); isRunningRef.current = true }
          catch {
            // InvalidStateError — engine aún liberando lock. Reintento.
            setTimeout(() => {
              if (!sessionActiveRef.current) return
              try { r.start(); isRunningRef.current = true }
              catch {
                // Damos por perdida la sesión y flush lo acumulado.
                sessionActiveRef.current = false
                clearTimeout(silenceTimerRef.current)
                try { vadHandleRef.current?.stop() } catch {}
                vadHandleRef.current = null
                silenceMsRef.current = TIMER_ONLY_SILENCE_MS
                setCommitProgress(0)
                setIsListening(false)
                const text = finalTextRef.current.trim()
                finalTextRef.current = ''
                if (text) callbacksRef.current.onFinalize?.(text)
              }
            }, 140)
          }
        }, 70)
        return
      }

      // Fin real de sesión: limpiar y entregar el texto final.
      clearTimeout(silenceTimerRef.current)
      clearTimeout(restartTimerRef.current)
      try { vadHandleRef.current?.stop() } catch {}
      vadHandleRef.current = null
      silenceMsRef.current = TIMER_ONLY_SILENCE_MS
      setCommitProgress(0)
      setIsListening(false)
      const text = finalTextRef.current.trim()
      finalTextRef.current = ''
      if (text) callbacksRef.current.onFinalize?.(text)
    }

    srRef.current = r
    return () => {
      clearTimeout(silenceTimerRef.current)
      clearTimeout(restartTimerRef.current)
      try { vadHandleRef.current?.stop() } catch {}
      vadHandleRef.current = null
      try { r.abort() } catch {}
    }
  }, [lang])

  async function bootVAD() {
    if (vadHandleRef.current) return
    const mySessionStart = sessionStartRef.current
    try {
      const handle = await createVAD({
        onSpeechActivity: () => {
          if (!sessionActiveRef.current) return
          clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = setTimeout(() => {
            sessionActiveRef.current = false
            try { srRef.current?.stop() } catch {}
          }, silenceMsRef.current)
        },
        onCountdown: (remaining, total) => {
          const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0
          setCommitProgress(frac)
        },
        onSpeechEnd: () => {
          if (!sessionActiveRef.current) return
          sessionActiveRef.current = false
          try { srRef.current?.stop() } catch {}
        },
      })
      if (!sessionActiveRef.current || sessionStartRef.current !== mySessionStart) {
        try { handle.stop() } catch {}
        return
      }
      vadHandleRef.current = handle
      silenceMsRef.current = VAD_FALLBACK_SILENCE_MS
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = setTimeout(() => {
          sessionActiveRef.current = false
          try { srRef.current?.stop() } catch {}
        }, silenceMsRef.current)
      }
    } catch {
      vadHandleRef.current = null
      silenceMsRef.current = TIMER_ONLY_SILENCE_MS
    }
  }

  function start() {
    if (!SR) { callbacksRef.current.onError?.('unsupported'); return }
    const r = srRef.current
    if (!r) return
    if (isRunningRef.current) {
      // Sesión anterior no cerró del todo — abort + reintentamos pronto.
      sessionActiveRef.current = false
      try { r.abort() } catch {}
      isRunningRef.current = false
      setTimeout(start, 80)
      return
    }
    finalTextRef.current = ''
    sessionActiveRef.current = true
    sessionStartRef.current = Date.now()
    try {
      r.start()
      isRunningRef.current = true
      setIsListening(true)
      bootVAD()
    } catch {
      sessionActiveRef.current = false
      try { r.abort() } catch {}
      isRunningRef.current = false
      setIsListening(false)
    }
  }

  function stop() {
    sessionActiveRef.current = false
    clearTimeout(silenceTimerRef.current)
    clearTimeout(restartTimerRef.current)
    try { vadHandleRef.current?.stop() } catch {}
    vadHandleRef.current = null
    setCommitProgress(0)
    silenceMsRef.current = TIMER_ONLY_SILENCE_MS
    try { srRef.current?.stop() } catch {}
  }

  return {
    supported: !!SR,
    isListening,
    commitProgress,
    start,
    stop,
    toggle: () => { isListening ? stop() : start() },
  }
}

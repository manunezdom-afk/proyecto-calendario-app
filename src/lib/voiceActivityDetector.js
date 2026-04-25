// Voice Activity Detector basado en RMS de WebAudio.
//
// El sistema de dictado base detectaba "fin de habla" puramente con un timer
// de 1800ms desde el último onresult de SpeechRecognition. Eso tiene dos
// problemas:
//
//   1. Lag: aunque el usuario claramente terminó, hay que esperar 1.8s para
//      que la sesión se cierre y se mande al backend. Sensación de "se
//      quedó pensando" que no aparece en ChatGPT voice.
//   2. Sonidos no-léxicos invisibles: "mmm", "eh", una respiración fuerte
//      mientras el usuario piensa NO disparan onresult, así que el timer
//      corre como si estuviera callado y la sesión se cierra a mitad de
//      pensamiento.
//
// Este VAD corre EN PARALELO al SpeechRecognition con su propio stream del
// micrófono y usa el RMS del audio para:
//
//   - Resetear un timer externo en cuanto detecta cualquier energía sobre
//     el ruido de fondo (incluyendo "mmm", respiración, ruidos de pensar).
//     Eso hace que las pausas pensativas con sonidos paralingüísticos NO
//     corten la sesión.
//   - Confirmar fin de habla por silencio real del audio (no por ausencia
//     de transcript), permitiendo cerrar la sesión ~1s después del último
//     fonema en lugar de los 1.8s del timer puro.
//
// El umbral se calibra al inicio midiendo el ruido ambiente durante los
// primeros ~350ms (asumimos silencio del usuario al apretar el botón). Eso
// adapta el detector a un café ruidoso vs una habitación callada sin un
// umbral hardcodeado universal.
//
// Histéresis con dos umbrales evita "flapping" en zona gris (silencio raso
// mientras el usuario inhala antes de seguir hablando):
//   - speakThreshold   = noiseFloor * speakRatio    → entrada a "hablando"
//   - silenceThreshold = noiseFloor * silenceRatio  → entrada a "silencio"
// Entre ambos, mantiene el estado anterior.
//
// Hangover prosódico: una vez que entra en silencio, espera N ms antes de
// confirmar fin de habla. Si la utterance fue corta (<1.5s, típico de
// "agéndame…") extendemos el hangover para no cortar a alguien que apenas
// está arrancando. Si fue larga (>1.5s, frase completa) usamos un hangover
// más corto — sensación de respuesta rápida.
//
// autoGainControl=false en getUserMedia: el AGC de Chrome/Safari amplifica
// el silencio para que parezca habla. Eso rompe la detección por umbral —
// sin AGC, el silencio se queda en silencio.

const DEFAULTS = Object.freeze({
  // Hangover base — silencio confirmado tras 950ms sin audio sobre umbral.
  // Suficientemente generoso para una pausa media-natural sin sentirse lento.
  baseHangoverMs: 950,
  // Hangover extendido para utterances cortas — el usuario probablemente
  // está empezando a hablar y va a continuar.
  shortUtteranceHangoverMs: 1700,
  // Umbral que define "utterance corta". Bajo este valor, aplicamos hangover
  // extendido.
  shortUtteranceThresholdMs: 1500,
  // Tiempo de calibración del ruido de fondo al arrancar. Asumimos que el
  // usuario aún no empezó a hablar al pulsar el botón.
  noiseFloorCalibrationMs: 350,
  // Multiplicadores sobre el noise floor calibrado.
  speakRatio: 2.6,
  silenceRatio: 1.5,
  // Pisos absolutos del noise floor — protege contra calibración degenerada
  // (mic mute → noiseFloor=0; ambiente extremo → noiseFloor saturado).
  minNoiseFloor: 0.005,
  maxNoiseFloor: 0.05,
  // Mínima duración de habla antes de aceptar un onSpeechEnd. Evita que un
  // chasquido inicial dispare ciclo "speech start → speech end" inmediato.
  minSpeechMs: 180,
})

/**
 * @typedef {Object} VADHandle
 * @property {() => void} stop  — detiene RAF, libera analyser, mic y AudioContext.
 * @property {() => boolean} isReady — true si la calibración terminó.
 */

/**
 * @param {Object} opts
 * @param {() => void} [opts.onSpeechStart]
 * @param {(level: number) => void} [opts.onSpeechActivity] — disparado cada
 *   frame mientras hay audio sobre umbral. level ∈ [0, ~3], normalizado al
 *   speakThreshold (1 = umbral, >1 = más alto).
 * @param {() => void} [opts.onSpeechEnd] — disparado cuando se confirma fin
 *   de habla tras hangover.
 * @param {(remainingMs: number, totalMs: number) => void} [opts.onCountdown]
 *   — feedback durante el hangover. remainingMs=totalMs al inicio del
 *   silencio, baja a 0 al confirmar. También disparado con remainingMs=0
 *   cuando el hangover se cancela por audio nuevo.
 * @param {(err: Error) => void} [opts.onError]
 * @returns {Promise<VADHandle>}
 */
export async function createVAD(opts = {}) {
  if (typeof window === 'undefined') {
    throw new Error('VAD: requiere browser')
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('VAD: getUserMedia no disponible')
  }
  const AudioCtor = window.AudioContext || /** @type {any} */ (window).webkitAudioContext
  if (!AudioCtor) {
    throw new Error('VAD: AudioContext no disponible')
  }

  const cfg = { ...DEFAULTS, ...opts }

  // Pedimos un stream propio. Coexiste con el del SpeechRecognition: el
  // browser comparte el mic entre consumidores tras la primera concesión
  // de permiso. Si falla, el llamador degrada al timer-only.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
  })

  const ctx = new AudioCtor()
  // iOS Safari arranca AudioContext en 'suspended' aunque venga de user
  // gesture. resume() es no-op si ya está running.
  if (ctx.state === 'suspended') {
    try { await ctx.resume() } catch { /* ignore */ }
  }

  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.3
  source.connect(analyser)

  const buffer = new Float32Array(analyser.fftSize)

  // ── Estado interno ────────────────────────────────────────────────────
  let stopped = false
  let calibrating = true
  const calibrationStart = performance.now()
  /** @type {number[]} */
  const calibrationSamples = []
  let noiseFloor = 0.01

  let speechActive = false
  let speechStartTs = 0
  let hangoverStart = 0
  let hangoverDuration = cfg.baseHangoverMs
  let lastCountdownEmit = -1

  let rafId = 0

  function safeCall(fn, ...args) {
    if (!fn) return
    try { fn(...args) } catch (err) {
      // Nunca dejamos que un error del callback rompa el loop del VAD.
      try { cfg.onError?.(/** @type {Error} */ (err)) } catch { /* ignore */ }
    }
  }

  function computeRMS() {
    analyser.getFloatTimeDomainData(buffer)
    let sum = 0
    for (let i = 0; i < buffer.length; i++) {
      const s = buffer[i]
      sum += s * s
    }
    return Math.sqrt(sum / buffer.length)
  }

  function pickHangoverFor(utteranceMs) {
    if (utteranceMs > 0 && utteranceMs < cfg.shortUtteranceThresholdMs) {
      return cfg.shortUtteranceHangoverMs
    }
    return cfg.baseHangoverMs
  }

  function emitCountdown(remaining, total) {
    // Evitamos floods de updates idénticos consecutivos para no causar
    // re-renders innecesarios en consumidores que reflejen el countdown
    // en estado React.
    const rounded = Math.round(remaining / 16) * 16
    if (rounded === lastCountdownEmit) return
    lastCountdownEmit = rounded
    safeCall(cfg.onCountdown, remaining, total)
  }

  function tick() {
    if (stopped) return
    rafId = requestAnimationFrame(tick)

    const now = performance.now()
    const rms = computeRMS()

    if (calibrating) {
      // Tiramos el primer frame: a veces incluye un pop del MediaStream
      // arrancando que distorsiona el percentil 75.
      if (calibrationSamples.length > 0 || now - calibrationStart > 16) {
        calibrationSamples.push(rms)
      }
      if (now - calibrationStart >= cfg.noiseFloorCalibrationMs) {
        calibrationSamples.sort((a, b) => a - b)
        const idx = Math.min(
          calibrationSamples.length - 1,
          Math.max(0, Math.floor(calibrationSamples.length * 0.75)),
        )
        const p75 = calibrationSamples[idx] ?? 0.01
        // Le damos un poco de cabeza al ruido medido para que voces muy
        // graves cerca del piso no queden bajo el speakThreshold.
        noiseFloor = Math.min(
          cfg.maxNoiseFloor,
          Math.max(cfg.minNoiseFloor, p75 * 1.1),
        )
        calibrating = false
      }
      return
    }

    const speakThreshold = noiseFloor * cfg.speakRatio
    const silenceThreshold = noiseFloor * cfg.silenceRatio

    if (rms >= speakThreshold) {
      // Audio claramente sobre umbral.
      if (!speechActive) {
        speechActive = true
        speechStartTs = now
        hangoverStart = 0
        safeCall(cfg.onSpeechStart)
      } else if (hangoverStart > 0) {
        // Cancelamos hangover en curso — el usuario siguió hablando.
        hangoverStart = 0
        emitCountdown(0, hangoverDuration)
      }
      safeCall(cfg.onSpeechActivity, rms / Math.max(speakThreshold, 1e-6))
      return
    }

    if (rms <= silenceThreshold) {
      if (!speechActive) return
      const speechMs = now - speechStartTs
      if (speechMs < cfg.minSpeechMs) {
        // Click inicial / falso positivo. Volvemos a estado idle sin emitir
        // onSpeechEnd para no disparar cierre de sesión por un chasquido.
        speechActive = false
        hangoverStart = 0
        return
      }
      if (hangoverStart === 0) {
        hangoverStart = now
        hangoverDuration = pickHangoverFor(speechMs)
        emitCountdown(hangoverDuration, hangoverDuration)
        return
      }
      const elapsed = now - hangoverStart
      const remaining = hangoverDuration - elapsed
      if (remaining <= 0) {
        speechActive = false
        hangoverStart = 0
        emitCountdown(0, hangoverDuration)
        safeCall(cfg.onSpeechEnd)
      } else {
        emitCountdown(remaining, hangoverDuration)
      }
      return
    }

    // Zona gris (entre silenceThreshold y speakThreshold): mantenemos
    // estado actual. Si estamos en hangover, sigue corriendo.
    if (speechActive && hangoverStart > 0) {
      const elapsed = now - hangoverStart
      const remaining = hangoverDuration - elapsed
      if (remaining <= 0) {
        speechActive = false
        hangoverStart = 0
        emitCountdown(0, hangoverDuration)
        safeCall(cfg.onSpeechEnd)
      } else {
        emitCountdown(remaining, hangoverDuration)
      }
    }
  }

  rafId = requestAnimationFrame(tick)

  return {
    stop() {
      if (stopped) return
      stopped = true
      if (rafId) cancelAnimationFrame(rafId)
      try { source.disconnect() } catch { /* ignore */ }
      try { analyser.disconnect() } catch { /* ignore */ }
      try { stream.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
      // ctx.close() devuelve una promesa; no esperamos para no bloquear.
      try { ctx.close() } catch { /* ignore */ }
    },
    isReady() { return !calibrating && !stopped },
  }
}

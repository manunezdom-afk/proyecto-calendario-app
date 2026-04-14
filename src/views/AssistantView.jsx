import { useState, useEffect, useRef } from 'react'
import { parseEvent } from '../utils/parseEvent'

// ── Web Speech API setup ────────────────────────────────────────────────────
const SpeechRecognition =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition)

// ── Examples shown as placeholder cycling text ─────────────────────────────
const EXAMPLES = [
  'Ej: "futbol a las 5"',
  'Ej: "reunión mañana a las 10"',
  'Ej: "gym a las 6 de la tarde"',
  'Ej: "almuerzo al mediodía"',
  'Ej: "cena con mamá a las 8"',
]

export default function AssistantView({ onClose, onAddEvent }) {
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState(null)      // result from parseEvent()
  const [listening, setListening] = useState(false)
  const [interimText, setInterimText] = useState('') // real-time voice transcript
  const [toast, setToast] = useState('')
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [added, setAdded] = useState(false)

  const recognitionRef = useRef(null)
  const inputRef = useRef(null)

  // Cycle placeholder examples every 3 seconds
  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % EXAMPLES.length), 3000)
    return () => clearInterval(id)
  }, [])

  // Init speech recognition once
  useEffect(() => {
    if (!SpeechRecognition) return
    const r = new SpeechRecognition()
    r.lang = 'es-ES'
    r.continuous = false
    r.interimResults = true

    r.onstart = () => {
      console.log('[Sanctuary] 🎙️ Voice recognition started')
      setListening(true)
      setInterimText('')
    }

    r.onresult = (e) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          final += e.results[i][0].transcript
        } else {
          interim += e.results[i][0].transcript
        }
      }
      setInterimText(interim || final)
      if (final) {
        console.log(`[Sanctuary] 🎙️ Final transcript: "${final}"`)
        handleProcess(final.trim())
      }
    }

    r.onerror = (e) => {
      console.warn('[Sanctuary] ⚠️ Speech error:', e.error)
      setListening(false)
      setInterimText('')
      if (e.error === 'not-allowed') {
        showToast('Permiso de micrófono denegado. Usa el texto.')
      }
    }

    r.onend = () => {
      setListening(false)
      setInterimText('')
    }

    recognitionRef.current = r
    return () => { try { r.abort() } catch (_) {} }
  }, [])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  // ── Process text (voice or typed) → NLP → show parsed card ────────────────
  function handleProcess(text) {
    if (!text.trim()) return
    setListening(false)
    setInterimText('')
    const result = parseEvent(text)
    setInput(text)
    setParsed(result)
    setAdded(false)
  }

  // ── Submit from text input ─────────────────────────────────────────────────
  function handleSubmit(e) {
    e.preventDefault()
    handleProcess(input)
  }

  // ── Start / stop voice ─────────────────────────────────────────────────────
  function toggleVoice() {
    if (!SpeechRecognition) {
      showToast('Tu navegador no soporta voz. Escribe el evento.')
      inputRef.current?.focus()
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
    } else {
      setParsed(null)
      setAdded(false)
      setInput('')
      try {
        recognitionRef.current?.start()
      } catch (err) {
        console.warn('[Sanctuary] Could not start recognition:', err)
      }
    }
  }

  // ── Add the parsed event to the calendar ──────────────────────────────────
  function handleAdd() {
    if (!parsed) return
    console.log('[Sanctuary] ➕ Adding parsed event:', parsed)
    onAddEvent?.({
      title: parsed.title,
      time: parsed.time,
      description: parsed.date !== 'Hoy' ? parsed.date : '',
      section: parsed.section,
      icon: parsed.icon,
      dotColor: parsed.dotColor,
    })
    setAdded(true)
    showToast(`"${parsed.title}" añadido al calendario`)
    setTimeout(() => {
      setParsed(null)
      setInput('')
      setAdded(false)
      inputRef.current?.focus()
    }, 1400)
  }

  // ── Edit the parsed event inline ──────────────────────────────────────────
  function handleEdit() {
    setParsed(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const voiceSupported = !!SpeechRecognition

  return (
    <div className="fixed inset-0 z-[60] flex flex-col backdrop-darken text-white">

      {/* Toast */}
      {toast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[90] bg-white/20 backdrop-blur-xl px-5 py-3 rounded-2xl border border-white/20 text-sm font-semibold shadow-xl">
          {toast}
        </div>
      )}

      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 flex-shrink-0">
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-all"
        >
          <span className="material-symbols-outlined text-white">arrow_back</span>
        </button>
        <span className="font-headline font-extrabold text-lg tracking-tight">Asistente</span>
        <div className="w-10 h-10" /> {/* spacer */}
      </header>

      {/* ── Center area ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8 overflow-hidden">

        {/* Orb / mic button */}
        <div className="relative flex items-center justify-center">
          {listening && (
            <div className="absolute w-48 h-48 ai-pulse-glow animate-ping opacity-30 rounded-full" />
          )}
          <button
            onClick={toggleVoice}
            title={voiceSupported ? (listening ? 'Detener' : 'Hablar') : 'Micrófono no disponible'}
            className={`relative z-10 w-28 h-28 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 active:scale-95 ${
              listening
                ? 'bg-error scale-110 shadow-error/30'
                : 'bg-gradient-to-br from-primary to-secondary-container shadow-primary/30 hover:scale-105'
            } ${!voiceSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {listening ? (
              <div className="flex items-end gap-1 h-8">
                <div className="w-1 h-4 bg-white rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-1 h-8 bg-white rounded-full animate-bounce" />
                <div className="w-1 h-5 bg-white rounded-full animate-bounce [animation-delay:-0.5s]" />
                <div className="w-1 h-7 bg-white rounded-full animate-bounce [animation-delay:-0.2s]" />
                <div className="w-1 h-3 bg-white rounded-full animate-bounce [animation-delay:-0.7s]" />
              </div>
            ) : (
              <span className="material-symbols-outlined text-4xl text-white">mic</span>
            )}
          </button>
        </div>

        {/* Voice interim transcript */}
        {listening && (
          <p className="text-white/80 text-lg font-medium text-center max-w-xs leading-snug min-h-[2rem]">
            {interimText || <span className="text-white/40">Escuchando...</span>}
          </p>
        )}

        {/* Idle instruction */}
        {!listening && !parsed && (
          <div className="text-center space-y-2">
            <p className="text-white/70 text-base font-medium">
              {voiceSupported ? 'Toca el micrófono o escribe abajo' : 'Escribe el evento abajo'}
            </p>
            <p className="text-white/30 text-sm">{EXAMPLES[placeholderIdx]}</p>
          </div>
        )}

        {/* ── Parsed event card ────────────────────────────────────────────── */}
        {parsed && !listening && (
          <div className={`w-full max-w-sm rounded-3xl border p-6 space-y-4 transition-all ${
            added
              ? 'bg-primary/20 border-primary/50'
              : 'bg-white/10 border-white/20 backdrop-blur-xl'
          }`}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/30 flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-primary-fixed-dim text-2xl">
                  {parsed.icon}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-headline font-bold text-xl leading-tight truncate">
                  {parsed.title}
                </p>
                <p className="text-white/60 text-sm mt-0.5">
                  {[parsed.date, parsed.time].filter(Boolean).join(' · ') || 'Sin horario'}
                </p>
              </div>
            </div>

            {added ? (
              <div className="flex items-center justify-center gap-2 text-primary-fixed font-bold py-1">
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
                Añadido al calendario
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={handleEdit}
                  className="flex-1 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white/80 font-semibold text-sm transition-all"
                >
                  Editar
                </button>
                <button
                  onClick={handleAdd}
                  className="flex-1 py-3 rounded-2xl bg-primary hover:bg-primary/80 text-white font-bold text-sm shadow-lg shadow-primary/30 active:scale-95 transition-all"
                >
                  Añadir al calendario
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Text input bar (always visible at bottom) ─────────────────────── */}
      <div className="flex-shrink-0 px-4 pb-8 pt-3">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-3 bg-white/10 border border-white/20 backdrop-blur-xl rounded-[28px] px-4 py-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              if (parsed) setParsed(null) // clear card when user edits
            }}
            placeholder={EXAMPLES[placeholderIdx]}
            className="flex-1 bg-transparent text-white placeholder:text-white/30 text-sm font-medium focus:outline-none min-w-0 py-2"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full bg-primary disabled:opacity-30 hover:bg-primary/80 active:scale-90 transition-all"
          >
            <span className="material-symbols-outlined text-white text-[20px]">arrow_upward</span>
          </button>
        </form>
        {!voiceSupported && (
          <p className="text-center text-white/25 text-xs mt-2">
            Voz no disponible en este navegador
          </p>
        )}
      </div>
    </div>
  )
}

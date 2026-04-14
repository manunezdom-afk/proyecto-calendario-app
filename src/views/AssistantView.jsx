import { useState, useEffect, useRef } from 'react'

const AVATAR_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDc_HJr_2CTn2bH2wxJwN-84kHi9OHpnszK1Bsp89yK0Q9Yrw1wyUPskebHdZGSP_yIcd72iyGGt_n5982DlxLk6paq5dujnm_ExfkboSKpVYrlXG6Jfodq-YyTzs78HKo0F_eNeevX9hyoluaPJtqdgPnbzm8AxT5Hc99QRUXZVirEaCtku9NSaaqLv-oN1sHKBoE5wihpUXo9Aij5CQyf5CtVv8i_asslJ7yI9b9BJ46H4rtaUDIv38tWvCSk8jGbgjjQpR3OdJ5q'

// Demo phrases that appear as "transcription"
const DEMO_PHRASES = [
  'Organiza mi tarde para estudiar y hacer ejercicio...',
  'Añade una reunión mañana a las 10 de la mañana...',
  'Recuérdame revisar los correos antes de las 5...',
  'Bloquea dos horas de trabajo profundo esta semana...',
]

// Suggested events the AI "proposes"
const SUGGESTION_SETS = [
  [
    {
      id: 'sug-1a',
      icon: 'menu_book',
      iconColor: 'text-primary-fixed-dim',
      bgColor: 'bg-primary/20',
      title: 'Sesión de Estudio',
      time: '16:00 — 18:00 · Modo Enfoque',
      tags: ['Biología', 'Tranquilo'],
      eventData: { title: 'Sesión de Estudio', time: '4:00 PM - 6:00 PM', section: 'evening', icon: 'menu_book', dotColor: 'bg-primary' },
    },
    {
      id: 'sug-1b',
      icon: 'fitness_center',
      iconColor: 'text-secondary-fixed-dim',
      bgColor: 'bg-secondary/20',
      title: 'Entrenamiento Gym',
      time: '18:30 — 19:45 · Core y Cardio',
      tags: ['Intenso', 'Quema de Calorías'],
      eventData: { title: 'Entrenamiento Gym', time: '6:30 PM - 7:45 PM', section: 'evening', icon: 'fitness_center', dotColor: 'bg-secondary-container' },
    },
  ],
  [
    {
      id: 'sug-2a',
      icon: 'groups',
      iconColor: 'text-primary-fixed-dim',
      bgColor: 'bg-primary/20',
      title: 'Reunión de Equipo',
      time: '10:00 — 11:00 · Sala Principal',
      tags: ['Trabajo', 'Prioritario'],
      eventData: { title: 'Reunión de Equipo', time: '10:00 AM - 11:00 AM', section: 'focus', icon: 'groups', dotColor: '' },
    },
    {
      id: 'sug-2b',
      icon: 'inbox',
      iconColor: 'text-secondary-fixed-dim',
      bgColor: 'bg-secondary/20',
      title: 'Revisión de Correos',
      time: '16:30 — 17:00 · Inbox Zero',
      tags: ['Email', 'Rápido'],
      eventData: { title: 'Revisión de Correos', time: '4:30 PM - 5:00 PM', section: 'evening', icon: 'inbox', dotColor: 'bg-secondary-container' },
    },
  ],
]

// ── States: idle | listening | processing | results ────────────────────────
export default function AssistantView({ onClose, onAddEvent }) {
  const [phase, setPhase] = useState('idle')          // 'idle' | 'listening' | 'processing' | 'results'
  const [transcript, setTranscript] = useState('')
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [suggestions, setSuggestions] = useState([])
  const [accepted, setAccepted] = useState({})        // { [id]: true }
  const [textMode, setTextMode] = useState(false)
  const [textInput, setTextInput] = useState('')
  const [toast, setToast] = useState('')
  const timerRef = useRef(null)

  // Clean up timers on unmount
  useEffect(() => () => clearTimeout(timerRef.current), [])

  // ── Show toast briefly ─────────────────────────────────────────────────────
  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  // ── Start listening → processing → results ────────────────────────────────
  function startListening(inputText = '') {
    const phrase = inputText || DEMO_PHRASES[phraseIdx % DEMO_PHRASES.length]
    setPhraseIdx((i) => i + 1)
    const suggSet = SUGGESTION_SETS[phraseIdx % SUGGESTION_SETS.length]

    console.log(`[Sanctuary] 🎙️ Assistant listening. Phrase: "${phrase}"`)
    setPhase('listening')
    setTranscript('')
    setAccepted({})
    setTextMode(false)
    setTextInput('')

    // Simulate typing the phrase character by character
    let i = 0
    function typeNext() {
      i++
      setTranscript(phrase.slice(0, i))
      if (i < phrase.length) {
        timerRef.current = setTimeout(typeNext, 38)
      } else {
        // Done typing → processing
        timerRef.current = setTimeout(() => {
          console.log('[Sanctuary] ⚙️ Assistant processing...')
          setPhase('processing')
          timerRef.current = setTimeout(() => {
            console.log('[Sanctuary] ✅ Assistant showing results.')
            setSuggestions(suggSet)
            setPhase('results')
          }, 1400)
        }, 600)
      }
    }
    typeNext()
  }

  function handleTextSubmit(e) {
    e.preventDefault()
    if (!textInput.trim()) return
    startListening(textInput.trim())
  }

  function handleAccept(sug) {
    if (accepted[sug.id]) return
    console.log(`[Sanctuary] ✅ Accepting suggestion: "${sug.title}"`)
    setAccepted((prev) => ({ ...prev, [sug.id]: true }))
    if (onAddEvent) {
      onAddEvent(sug.eventData)
      showToast(`"${sug.title}" añadido al calendario`)
    }
  }

  function handleStop() {
    clearTimeout(timerRef.current)
    console.log('[Sanctuary] ⏹️ Assistant stopped.')
    setPhase('idle')
    setTranscript('')
  }

  const isActive = phase === 'listening' || phase === 'processing'

  return (
    <div className="fixed inset-0 z-[60] flex flex-col backdrop-darken text-white overflow-hidden">

      {/* Toast notification */}
      {toast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[90] bg-white/20 backdrop-blur-xl px-5 py-3 rounded-2xl border border-white/20 text-sm font-semibold shadow-xl transition-all">
          ✓ {toast}
        </div>
      )}

      {/* Header */}
      <header className="flex justify-between items-center w-full px-6 py-4 bg-transparent z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20 transition-all"
          >
            <span className="material-symbols-outlined text-white">close</span>
          </button>
          <span className="font-headline font-extrabold text-lg tracking-tight">Sanctuary</span>
        </div>
        <div className="h-10 w-10 rounded-full overflow-hidden ring-2 ring-primary/20">
          <img alt="User profile avatar" className="w-full h-full object-cover" src={AVATAR_URL} />
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 relative">

        {/* Orb */}
        <div
          className="relative flex items-center justify-center mb-10 cursor-pointer"
          onClick={() => phase === 'idle' && startListening()}
        >
          <div className={`absolute w-[320px] h-[320px] ai-pulse-glow ${isActive ? 'animate-pulse' : 'opacity-30'} transition-opacity duration-500`} />
          <div className={`relative z-10 w-32 h-32 rounded-full bg-gradient-to-br from-primary to-secondary-container flex items-center justify-center shadow-[0_0_60px_rgba(0,88,188,0.5)] transition-transform duration-300 ${isActive ? 'scale-110' : 'hover:scale-105'}`}>
            {phase === 'idle' ? (
              <span className="material-symbols-outlined text-4xl text-white">mic</span>
            ) : (
              <div className="flex items-end gap-1.5 h-12">
                <div className="w-1.5 h-6 bg-white/90 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-1.5 h-12 bg-white rounded-full animate-bounce" />
                <div className="w-1.5 h-8 bg-white/90 rounded-full animate-bounce [animation-delay:-0.5s]" />
                <div className="w-1.5 h-10 bg-white rounded-full animate-bounce [animation-delay:-0.2s]" />
                <div className="w-1.5 h-5 bg-white/80 rounded-full animate-bounce [animation-delay:-0.7s]" />
              </div>
            )}
          </div>
        </div>

        {/* Transcription / status text */}
        <div className="max-w-2xl text-center px-4">
          {phase === 'idle' && !textMode && (
            <>
              <p className="font-headline text-2xl font-bold text-white/80 mb-3">
                Toca para hablar
              </p>
              <p className="text-white/40 text-base">
                Di qué quieres organizar y la IA lo añadirá al calendario.
              </p>
            </>
          )}

          {(phase === 'listening' || phase === 'processing') && (
            <>
              <h1 className="font-headline text-3xl font-bold tracking-tight mb-4 leading-tight">
                <span className="text-white">{transcript}</span>
                <span className="animate-pulse text-primary">|</span>
              </h1>
              <p className="text-white/60 text-lg font-medium tracking-wide">
                {phase === 'listening' ? 'Escuchando...' : 'Procesando con IA...'}
              </p>
            </>
          )}

          {phase === 'results' && (
            <p className="text-white/60 text-base font-medium mb-2">
              Aquí tienes mis sugerencias — acepta las que quieras añadir al calendario.
            </p>
          )}

          {textMode && phase === 'idle' && (
            <form onSubmit={handleTextSubmit} className="mt-4 flex gap-3 w-full max-w-md mx-auto">
              <input
                autoFocus
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Escribe tu instrucción..."
                className="flex-1 bg-white/10 border border-white/20 rounded-2xl px-5 py-3 text-white placeholder:text-white/40 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="submit"
                className="px-5 py-3 bg-primary rounded-2xl text-white font-bold text-sm active:scale-95 transition-all"
              >
                Enviar
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Suggestions (shown when results) */}
      {phase === 'results' && (
        <div className="w-full px-6 pb-36">
          <div className="max-w-xl mx-auto space-y-3">
            {suggestions.map((sug) => (
              <div
                key={sug.id}
                className={`group bg-white/5 backdrop-blur-xl p-5 rounded-[24px] border flex items-start gap-4 transition-all ${
                  accepted[sug.id]
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-white/10 hover:bg-white/10 active:scale-[0.98]'
                }`}
              >
                <div className={`w-12 h-12 rounded-xl ${sug.bgColor} flex items-center justify-center flex-shrink-0`}>
                  <span className={`material-symbols-outlined ${sug.iconColor}`}>{sug.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-headline text-base font-bold">{sug.title}</h3>
                  <p className="text-sm text-white/60 mb-2">{sug.time}</p>
                  <div className="flex gap-2 flex-wrap">
                    {sug.tags.map((tag) => (
                      <span key={tag} className="px-3 py-0.5 bg-white/10 rounded-full text-xs font-semibold">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => handleAccept(sug)}
                  className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    accepted[sug.id]
                      ? 'bg-primary text-white'
                      : 'bg-white/10 text-white/30 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]"
                    style={accepted[sug.id] ? { fontVariationSettings: "'FILL' 1" } : {}}>
                    check_circle
                  </span>
                </button>
              </div>
            ))}
            <button
              onClick={() => startListening()}
              className="w-full py-3 mt-2 rounded-2xl border border-white/20 text-white/60 hover:text-white hover:border-white/40 text-sm font-semibold transition-all"
            >
              Intentar con otra instrucción
            </button>
          </div>
        </div>
      )}

      {/* Bottom control bar */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-[92%] max-w-lg z-[70]">
        <div className="bg-white/10 backdrop-blur-3xl p-2 rounded-[32px] border border-white/10 flex items-center justify-between">

          {/* Keyboard toggle */}
          <button
            onClick={() => {
              if (phase !== 'idle') return
              setTextMode((v) => !v)
            }}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
              textMode ? 'bg-primary/30 text-white' : 'bg-white/5 hover:bg-white/10 text-white'
            }`}
          >
            <span className="material-symbols-outlined">{textMode ? 'mic' : 'keyboard'}</span>
          </button>

          {/* Status */}
          <div className="flex items-center gap-4 px-4 overflow-hidden">
            {isActive && (
              <div className="h-1 w-16 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-primary animate-pulse" style={{ width: phase === 'processing' ? '80%' : '40%' }} />
              </div>
            )}
            <span className="text-sm font-semibold tracking-wider text-white/80 uppercase">
              {phase === 'idle' ? 'LISTO' : phase === 'listening' ? 'ESCUCHANDO' : phase === 'processing' ? 'PROCESANDO' : 'SUGERENCIAS'}
            </span>
          </div>

          {/* Stop / Reset */}
          <button
            onClick={isActive ? handleStop : () => { setPhase('idle'); setTranscript('') }}
            className="w-14 h-14 rounded-full bg-error/20 hover:bg-error/30 flex items-center justify-center transition-colors group"
          >
            <span className="material-symbols-outlined text-error group-hover:scale-110 transition-transform">
              {isActive ? 'stop' : 'restart_alt'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

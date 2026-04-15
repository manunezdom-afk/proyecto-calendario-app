import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { parseEvent } from '../utils/parseEvent'

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
const EXAMPLES = ['Ej: "futbol a las 5"', 'Ej: "reunión mañana a las 10"', 'Ej: "gym a las 6"', 'Ej: "cena a las 8"']

function TypingIndicator() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="flex items-center gap-2 bg-white/10 backdrop-blur-2xl border border-white/20 rounded-2xl px-5 py-3.5"
    >
      {[0, 1, 2].map((i) => (
        <motion.div key={i} className="w-2 h-2 rounded-full bg-blue-400"
          animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
        />
      ))}
    </motion.div>
  )
}

export default function AssistantView({ onClose, onAddEvent }) {
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState(null)
  const [listening, setListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [toast, setToast] = useState('')
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [added, setAdded] = useState(false)
  const [isThinking, setIsThinking] = useState(false)

  const recognitionRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % EXAMPLES.length), 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!SpeechRecognition) return
    const r = new SpeechRecognition()
    r.lang = 'es-ES'; r.continuous = false; r.interimResults = true
    r.onstart = () => { setListening(true); setInterimText('') }
    r.onresult = (e) => {
      let interim = ''; let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript
        else interim += e.results[i][0].transcript
      }
      setInterimText(interim || final)
      if (final) handleProcess(final.trim())
    }
    r.onend = () => { setListening(false); setInterimText('') }
    recognitionRef.current = r
  }, [])

  function handleProcess(text) {
    if (!text.trim()) return
    setIsThinking(true); setParsed(null)
    setTimeout(() => {
      setParsed(parseEvent(text)); setIsThinking(false); setInput(text)
    }, 600)
  }

  return (
    <motion.div 
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950/80 backdrop-blur-xl"
    >
      {/* Header con Blur */}
      <header className="flex justify-between items-center px-6 py-4">
        <motion.button onClick={onClose} whileTap={{ scale: 0.9 }} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10">
          <span className="material-symbols-outlined">close</span>
        </motion.button>
        <span className="font-bold text-lg tracking-tight">Asistente Focus</span>
        <div className="w-10" />
      </header>

      {/* Área Central */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        <motion.button
          onClick={() => !listening && recognitionRef.current?.start()}
          animate={listening ? { scale: 1.2 } : { scale: 1 }}
          className={`w-24 h-24 rounded-full flex items-center justify-center shadow-2xl transition-colors ${listening ? 'bg-red-500' : 'bg-blue-600'}`}
        >
          <span className="material-symbols-outlined text-4xl">{listening ? 'graphic_eq' : 'mic'}</span>
        </motion.button>

        <AnimatePresence mode="wait">
          {isThinking ? <TypingIndicator key="thinking" /> : 
           parsed ? (
            <motion.div key="card" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white/10 p-6 rounded-3xl border border-white/20 w-full max-w-xs text-center">
              <p className="text-2xl font-bold mb-2">{parsed.title}</p>
              <p className="text-white/60 mb-4">{parsed.time}</p>
              <button onClick={() => { onAddEvent(parsed); onClose(); }} className="bg-blue-500 w-full py-3 rounded-xl font-bold">Confirmar</button>
            </motion.div>
           ) : (
            <p className="text-white/40">{listening ? interimText : "Dime qué quieres agendar..."}</p>
           )}
        </AnimatePresence>
      </div>

      {/* Input Inferior */}
      <div className="p-6">
        <div className="bg-white/10 p-2 rounded-2xl flex border border-white/10">
          <input 
            value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe aquí..." 
            className="bg-transparent flex-1 px-4 outline-none"
            onKeyDown={(e) => e.key === 'Enter' && handleProcess(input)}
          />
          <button onClick={() => handleProcess(input)} className="bg-blue-500 p-2 rounded-xl">
            <span className="material-symbols-outlined">arrow_upward</span>
          </button>
        </div>
      </div>
    </motion.div>
  )
}
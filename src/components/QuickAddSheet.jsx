import { useState, useEffect, useRef } from 'react'
import { parseEvent } from '../utils/parseEvent'

const EXAMPLES = [
  '"futbol a las 5"',
  '"reunión mañana a las 10"',
  '"gym a las 6 de la tarde"',
  '"almuerzo al mediodía"',
  '"cena con mamá a las 8"',
]

export default function QuickAddSheet({ onSave, onCancel, targetDateLabel }) {
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState(null)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const inputRef = useRef(null)

  // Cycle placeholder examples
  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % EXAMPLES.length), 3000)
    return () => clearInterval(id)
  }, [])

  // Auto-focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [])

  // Live NLP parse as the user types
  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed.length < 3) {
      setParsed(null)
      return
    }
    const result = parseEvent(trimmed)
    setParsed(result)
  }, [input])

  function handleConfirm() {
    if (!parsed) return
    onSave({
      title: parsed.title,
      time: parsed.time,
      date: parsed.date,         // YYYY-MM-DD — va al campo date, no a description
      description: '',           // notas del usuario: vacío al crear
      section: parsed.section,
      icon: parsed.icon,
      dotColor: parsed.dotColor,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-surface rounded-t-[32px] px-6 pt-5 pb-10 shadow-2xl z-10">

        {/* Handle bar */}
        <div className="w-10 h-1 bg-outline-variant rounded-full mx-auto mb-6" />

        <div className="mb-5">
          <h2 className="font-headline font-extrabold text-xl text-on-surface">
            Añadir evento
          </h2>
          {targetDateLabel ? (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="material-symbols-outlined text-primary text-[14px]">calendar_today</span>
              <p className="text-sm font-semibold text-primary capitalize">{targetDateLabel}</p>
            </div>
          ) : (
            <p className="text-sm text-outline mt-1">
              Escribe de forma natural, como le dirías a un amigo
            </p>
          )}
        </div>

        {/* Text input */}
        <div className="flex items-center gap-3 bg-surface-container-low rounded-2xl px-4 py-3 mb-5 border border-outline-variant/30 focus-within:border-primary transition-colors">
          <span className="material-symbols-outlined text-outline text-xl flex-shrink-0">edit</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && parsed) handleConfirm() }}
            placeholder={`Ej: ${EXAMPLES[placeholderIdx]}`}
            className="flex-1 bg-transparent text-on-surface placeholder:text-outline/50 text-base font-medium focus:outline-none"
          />
          {input && (
            <button
              onClick={() => setInput('')}
              className="flex-shrink-0 text-outline hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        {/* Live preview card */}
        {parsed ? (
          <div className="bg-surface-container-lowest rounded-2xl p-4 mb-5 border border-outline-variant/20 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span
                className="material-symbols-outlined text-primary text-2xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {parsed.icon}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-on-surface truncate">{parsed.title}</p>
              <p className="text-sm text-outline mt-0.5">
                {targetDateLabel
                  ? [targetDateLabel, parsed.time].filter(Boolean).join(' · ')
                  : [parsed.date !== 'Hoy' ? parsed.date : '', parsed.time].filter(Boolean).join(' · ') || 'Sin horario definido'}
              </p>
            </div>
            <span className="material-symbols-outlined text-primary/60 text-xl flex-shrink-0">
              auto_awesome
            </span>
          </div>
        ) : input.trim().length >= 3 ? null : (
          <div className="text-center text-outline text-sm py-3 mb-5 font-medium">
            Sigue escribiendo para ver la vista previa...
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 rounded-2xl bg-surface-container-low text-on-surface-variant font-semibold text-sm hover:bg-surface-container transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!parsed}
            className="flex-1 py-3.5 rounded-2xl bg-primary text-white font-bold text-sm shadow-lg shadow-primary/20 disabled:opacity-30 disabled:shadow-none active:scale-95 transition-all"
          >
            Añadir
          </button>
        </div>
      </div>
    </div>
  )
}

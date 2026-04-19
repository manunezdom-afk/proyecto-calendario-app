import { useState } from 'react'
import { parseEvent } from '../../utils/parseEvent'
import PreviewCard from './PreviewCard'

// Tab "Por texto": textarea multi-linea → parseEvent() por línea → preview.
export default function TextTab({ onImport }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState([])
  const [imported, setImported] = useState(false)

  function handleParse() {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    const parsed = lines.map((line) => {
      const result = parseEvent(line)
      return {
        id: `evt-txt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        title: result.title,
        time: result.time,
        description: result.date !== 'Hoy' ? result.date : '',
        section: result.section,
        featured: false,
        icon: result.icon,
        dotColor: result.dotColor,
        date: null,
      }
    })
    setPreview(parsed)
    setImported(false)
  }

  function removeFromPreview(id) {
    setPreview((prev) => prev.filter((e) => e.id !== id))
  }

  function handleConfirm() {
    preview.forEach((ev) => onImport(ev))
    setImported(true)
    setPreview([])
    setText('')
    console.log(`[Focus] 📥 Imported ${preview.length} events from text`)
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-on-surface-variant font-medium leading-relaxed">
        Escribe o pega varios eventos, <span className="font-bold text-on-surface">uno por línea</span>.
        El asistente los reconoce automáticamente.
      </p>

      <div className="bg-surface-container-low rounded-xl p-3 space-y-1 text-xs text-outline font-mono">
        <p>gym lunes a las 7 de la mañana</p>
        <p>reunión de equipo martes a las 10</p>
        <p>cena con familia el viernes a las 8</p>
        <p>dentista mañana a las 3 de la tarde</p>
      </div>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setPreview([]); setImported(false) }}
        placeholder={'gym lunes a las 7\nreunión martes a las 10\ncena viernes a las 8'}
        rows={5}
        aria-label="Lista de eventos, uno por línea"
        className="w-full bg-surface-container-low rounded-xl p-4 text-sm font-medium text-on-surface placeholder:text-outline/40 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
      />

      <button
        onClick={handleParse}
        disabled={!text.trim()}
        className="w-full py-3.5 rounded-2xl bg-surface-container-high text-on-surface font-bold flex items-center justify-center gap-2 disabled:opacity-30 active:scale-[0.98] transition-all"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[20px]">auto_awesome</span>
        Analizar con IA
      </button>

      {imported && (
        <div role="status" className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex items-center gap-3">
          <span aria-hidden="true" className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-sm font-bold text-primary">Eventos añadidos al calendario</p>
        </div>
      )}

      {preview.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-bold text-on-surface">
            Vista previa — {preview.length} evento{preview.length !== 1 ? 's' : ''}
          </p>
          <div className="space-y-2 max-h-56 overflow-y-auto hide-scrollbar">
            {preview.map((ev) => (
              <PreviewCard key={ev.id} ev={ev} onRemove={removeFromPreview} />
            ))}
          </div>
          <button
            onClick={handleConfirm}
            className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">add_circle</span>
            Añadir {preview.length} evento{preview.length !== 1 ? 's' : ''} al calendario
          </button>
        </div>
      )}
    </div>
  )
}

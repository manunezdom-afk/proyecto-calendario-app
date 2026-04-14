import { useState, useRef, useEffect } from 'react'
import { downloadICS }        from '../utils/icsExport'
import { parseICS }           from '../utils/icsImport'
import { parseEvent }         from '../utils/parseEvent'
import { parseScheduleText }  from '../utils/parseScheduleText'

const TABS = [
  { id: 'export', label: 'Exportar', icon: 'ios_share' },
  { id: 'import', label: 'Importar', icon: 'download' },
  { id: 'text',   label: 'Por texto', icon: 'edit_note' },
  { id: 'photo',  label: 'Foto',      icon: 'photo_camera' },
]

// ── Small preview card for an event to be imported ──────────────────────────
function PreviewCard({ ev, onRemove }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-surface-container-lowest rounded-xl border border-outline-variant/20">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <span
          className="material-symbols-outlined text-primary text-[18px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {ev.icon || 'event'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-on-surface text-sm truncate">{ev.title}</p>
        <p className="text-xs text-outline mt-0.5">
          {[ev.date, ev.time].filter(Boolean).join(' · ') || 'Sin horario'}
        </p>
      </div>
      {onRemove && (
        <button
          onClick={() => onRemove(ev.id)}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-outline hover:text-error transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      )}
    </div>
  )
}

// ── Export tab ────────────────────────────────────────────────────────────────
function ExportTab({ events }) {
  const [copied, setCopied] = useState(false)

  function handleDownload() {
    downloadICS(events)
    console.log(`[Focus] 📤 Exported ${events.length} events to ICS`)
  }

  async function handleCopy() {
    const { eventsToICS } = await import('../utils/icsExport')
    try {
      await navigator.clipboard.writeText(eventsToICS(events))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {}
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-on-surface-variant font-medium leading-relaxed">
        Descarga tus eventos como archivo <span className="font-bold text-on-surface">.ics</span> para
        importarlos en Apple Calendar, Google Calendar, Outlook o cualquier otra app de calendario.
      </p>

      {/* Stats */}
      <div className="bg-surface-container-lowest rounded-2xl p-4 flex items-center gap-4 border border-outline-variant/20">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-primary text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
            calendar_month
          </span>
        </div>
        <div>
          <p className="font-bold text-on-surface">{events.length} eventos</p>
          <p className="text-xs text-outline font-medium">listos para exportar</p>
        </div>
      </div>

      {/* Download button */}
      <button
        onClick={handleDownload}
        disabled={events.length === 0}
        className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-30 active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-[20px]">ios_share</span>
        Descargar archivo .ics
      </button>

      <button
        onClick={handleCopy}
        disabled={events.length === 0}
        className="w-full py-4 rounded-2xl bg-surface-container-low text-on-surface font-semibold flex items-center justify-center gap-2 disabled:opacity-30 active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-[20px]">
          {copied ? 'check_circle' : 'content_copy'}
        </span>
        {copied ? '¡Copiado!' : 'Copiar al portapapeles'}
      </button>

      {/* Instructions */}
      <div className="space-y-3">
        <p className="text-xs font-bold text-outline uppercase tracking-wider">Cómo importar</p>
        {[
          { icon: 'apple',     label: 'Apple Calendar', desc: 'Abre el archivo .ics desde Archivos o Mail → se importa automáticamente' },
          { icon: 'language',  label: 'Google Calendar', desc: 'calendar.google.com → Configuración → Importar → sube el .ics' },
          { icon: 'mail',      label: 'Outlook',         desc: 'Doble clic en el archivo .ics → "Abrir con Outlook"' },
        ].map(({ icon, label, desc }) => (
          <div key={label} className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
            <span className="material-symbols-outlined text-outline text-[18px] mt-0.5">{icon}</span>
            <div>
              <p className="text-sm font-bold text-on-surface">{label}</p>
              <p className="text-xs text-outline font-medium mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Import ICS tab ────────────────────────────────────────────────────────────
function ImportICSTab({ onImport }) {
  const fileRef = useRef(null)
  const [preview, setPreview]   = useState([])
  const [error, setError]       = useState('')
  const [imported, setImported] = useState(false)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setImported(false)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = parseICS(ev.target.result)
        if (parsed.length === 0) {
          setError('No se encontraron eventos en el archivo. ¿Es un archivo .ics válido?')
        } else {
          setPreview(parsed)
        }
      } catch (_) {
        setError('No se pudo leer el archivo. Asegúrate de que sea un .ics válido.')
      }
    }
    reader.readAsText(file)
  }

  function removeFromPreview(id) {
    setPreview((prev) => prev.filter((e) => e.id !== id))
  }

  function handleConfirm() {
    preview.forEach((ev) => onImport(ev))
    setImported(true)
    setPreview([])
    if (fileRef.current) fileRef.current.value = ''
    console.log(`[Focus] 📥 Imported ${preview.length} events from ICS`)
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-on-surface-variant font-medium leading-relaxed">
        Importa un archivo <span className="font-bold text-on-surface">.ics</span> de Apple Calendar,
        Google Calendar, Outlook u otra app. Podrás revisar los eventos antes de confirmar.
      </p>

      {/* File picker */}
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full py-5 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 flex flex-col items-center gap-2 hover:bg-primary/8 active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-primary text-4xl">upload_file</span>
        <span className="font-bold text-primary text-sm">Seleccionar archivo .ics</span>
        <span className="text-xs text-outline font-medium">o arrastra aquí</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".ics,text/calendar"
        onChange={handleFile}
        className="hidden"
      />

      {/* Cómo exportar instrucciones */}
      {preview.length === 0 && !error && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-outline uppercase tracking-wider">Cómo obtener el .ics</p>
          {[
            { icon: 'phone_iphone', label: 'iPhone / Mac', desc: 'Apple Calendar → selecciona un calendario → Archivo → Exportar → .ics' },
            { icon: 'language',     label: 'Google Calendar', desc: 'calendar.google.com → Configuración → Exportar calendarios' },
          ].map(({ icon, label, desc }) => (
            <div key={label} className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
              <span className="material-symbols-outlined text-outline text-[18px] mt-0.5">{icon}</span>
              <div>
                <p className="text-xs font-bold text-on-surface">{label}</p>
                <p className="text-xs text-outline font-medium mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-error/10 rounded-xl border border-error/20">
          <p className="text-sm text-error font-semibold">{error}</p>
        </div>
      )}

      {/* Success */}
      {imported && (
        <div className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex items-center gap-3">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-sm font-bold text-primary">Eventos importados correctamente</p>
        </div>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-on-surface">
              {preview.length} evento{preview.length !== 1 ? 's' : ''} encontrado{preview.length !== 1 ? 's' : ''}
            </p>
            <span className="text-xs text-outline font-medium">Toca × para descartar</span>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto hide-scrollbar">
            {preview.map((ev) => (
              <PreviewCard key={ev.id} ev={ev} onRemove={removeFromPreview} />
            ))}
          </div>
          <button
            onClick={handleConfirm}
            className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">download</span>
            Importar {preview.length} evento{preview.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Batch text tab ────────────────────────────────────────────────────────────
function TextTab({ onImport }) {
  const [text, setText]       = useState('')
  const [preview, setPreview] = useState([])
  const [imported, setImported] = useState(false)

  function handleParse() {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    const parsed = lines.map((line) => {
      const result = parseEvent(line)
      return {
        id:          `evt-txt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        title:       result.title,
        time:        result.time,
        description: result.date !== 'Hoy' ? result.date : '',
        section:     result.section,
        featured:    false,
        icon:        result.icon,
        dotColor:    result.dotColor,
        date:        null,
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

      {/* Example */}
      <div className="bg-surface-container-low rounded-xl p-3 space-y-1 text-xs text-outline font-mono">
        <p>gym lunes a las 7 de la mañana</p>
        <p>reunión de equipo martes a las 10</p>
        <p>cena con familia el viernes a las 8</p>
        <p>dentista mañana a las 3 de la tarde</p>
      </div>

      {/* Textarea */}
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setPreview([]); setImported(false) }}
        placeholder={'gym lunes a las 7\nreunión martes a las 10\ncena viernes a las 8'}
        rows={5}
        className="w-full bg-surface-container-low rounded-xl p-4 text-sm font-medium text-on-surface placeholder:text-outline/40 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
      />

      <button
        onClick={handleParse}
        disabled={!text.trim()}
        className="w-full py-3.5 rounded-2xl bg-surface-container-high text-on-surface font-bold flex items-center justify-center gap-2 disabled:opacity-30 active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
        Analizar con IA
      </button>

      {/* Success */}
      {imported && (
        <div className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex items-center gap-3">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-sm font-bold text-primary">Eventos añadidos al calendario</p>
        </div>
      )}

      {/* Preview */}
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
            <span className="material-symbols-outlined text-[20px]">add_circle</span>
            Añadir {preview.length} evento{preview.length !== 1 ? 's' : ''} al calendario
          </button>
        </div>
      )}
    </div>
  )
}

// ── Photo tab ─────────────────────────────────────────────────────────────────
function PhotoTab({ onImport }) {
  const [extracted, setExtracted] = useState('')
  const [preview, setPreview]     = useState([])
  const [imported, setImported]   = useState(false)
  const [parseError, setParseError] = useState('')
  const fileRef = useRef(null)
  // Multiple photos: array of { url, name }
  const [photos, setPhotos] = useState([])

  function handlePhotos(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const newPhotos = files.map((f) => ({ url: URL.createObjectURL(f), name: f.name }))
    setPhotos((prev) => [...prev, ...newPhotos])
    setPreview([])
    setImported(false)
    // Reset input so re-selecting same file works
    e.target.value = ''
  }

  function removePhoto(idx) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[idx].url)
      return prev.filter((_, i) => i !== idx)
    })
  }

  function handleParse() {
    setParseError('')
    const text = extracted.trim()
    if (!text) return

    try {
      // Use the dedicated schedule parser — handles 24h times, date headers,
      // ranges, h-format, coloquial, etc.
      const parsed = parseScheduleText(text)

      if (parsed.length === 0) {
        setParseError('No se reconocieron eventos. Asegúrate de que el texto incluya horas y nombres de actividad.')
        setPreview([])
        return
      }

      setPreview(parsed)
      setImported(false)
    } catch (err) {
      setParseError('Error al analizar el texto. Intenta limpiar el formato.')
    }
  }

  function removeFromPreview(id) {
    setPreview((prev) => prev.filter((e) => e.id !== id))
  }

  function handleConfirm() {
    preview.forEach((ev) => onImport(ev))
    setImported(true)
    setPreview([])
    setExtracted('')
    setPhotos([])
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-on-surface-variant font-medium leading-relaxed">
        Sube fotos de tu agenda, pizarra o calendario. Usa
        <span className="font-bold text-on-surface"> Live Text (iPhone)</span> o
        <span className="font-bold text-on-surface"> Google Lens (Android)</span> para
        copiar el texto y pégalo abajo — la IA detecta horarios automáticamente.
      </p>

      {/* Steps */}
      <div className="space-y-2">
        {[
          { n: '1', icon: 'add_photo_alternate', text: 'Adjunta una o más fotos de tu horario (referencia visual)' },
          { n: '2', icon: 'text_fields',          text: 'En la foto, usa Live Text o Google Lens para seleccionar el texto' },
          { n: '3', icon: 'content_paste',        text: 'Cópialo y pégalo en el campo de abajo' },
          { n: '4', icon: 'auto_awesome',         text: 'Toca "Analizar" — la IA extrae todos los eventos con sus horarios' },
        ].map(({ n, icon, text }) => (
          <div key={n} className="flex items-center gap-3 p-3 bg-surface-container-low rounded-xl">
            <span className="w-6 h-6 rounded-full bg-primary text-white text-[11px] font-black flex items-center justify-center flex-shrink-0">{n}</span>
            <span className="material-symbols-outlined text-primary text-[18px] flex-shrink-0">{icon}</span>
            <p className="text-xs font-medium text-on-surface-variant">{text}</p>
          </div>
        ))}
      </div>

      {/* Add photos button */}
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full py-3.5 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 flex items-center justify-center gap-2 hover:bg-primary/8 active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-primary text-[22px]">add_photo_alternate</span>
        <span className="font-bold text-primary text-sm">
          {photos.length === 0 ? 'Adjuntar fotos' : `Añadir más fotos (${photos.length} adjunta${photos.length !== 1 ? 's' : ''})`}
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handlePhotos}
        className="hidden"
      />

      {/* Photo thumbnails grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map(({ url, name }, idx) => (
            <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-surface-container-low">
              <img
                src={url}
                alt={name}
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => removePhoto(idx)}
                className="absolute top-1 right-1 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tips for what kinds of text the parser handles */}
      {!extracted && (
        <div className="bg-surface-container-low rounded-xl p-3 space-y-1">
          <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-2">Formatos que reconoce</p>
          {[
            '9:00 Gym  /  14:30 Dentista',
            '09:00 - 10:00 Trabajo profundo',
            'Lunes 14 de abril',
            '9h30 Yoga  /  9 AM Meeting',
            'Dentista a las 3 de la tarde',
          ].map((ex) => (
            <p key={ex} className="text-xs font-mono text-outline/70">{ex}</p>
          ))}
        </div>
      )}

      {/* Textarea */}
      <textarea
        value={extracted}
        onChange={(e) => { setExtracted(e.target.value); setPreview([]); setImported(false); setParseError('') }}
        placeholder={'Pega aquí el texto de tu horario...\n\nEj:\nLunes 14 de abril\n9:00 Gym\n11:00 - 12:00 Reunión de trabajo\n14:30 Dentista\n\nMartes 15 de abril\n7:30 Yoga\n10:00 Clase de inglés'}
        rows={6}
        className="w-full bg-surface-container-low rounded-xl p-4 text-sm font-medium text-on-surface placeholder:text-outline/40 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
      />

      {/* Parse error */}
      {parseError && (
        <div className="p-3 bg-error/10 rounded-xl border border-error/20">
          <p className="text-sm text-error font-semibold">{parseError}</p>
        </div>
      )}

      <button
        onClick={handleParse}
        disabled={!extracted.trim()}
        className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-30 active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
        Analizar y detectar eventos
      </button>

      {/* Success */}
      {imported && (
        <div className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex items-center gap-3">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-sm font-bold text-primary">Eventos añadidos al calendario</p>
        </div>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-on-surface">
              {preview.length} evento{preview.length !== 1 ? 's' : ''} detectado{preview.length !== 1 ? 's' : ''}
            </p>
            <span className="text-xs text-outline font-medium">Toca × para descartar</span>
          </div>
          <div className="space-y-2 max-h-52 overflow-y-auto hide-scrollbar">
            {preview.map((ev) => (
              <PreviewCard key={ev.id} ev={ev} onRemove={removeFromPreview} />
            ))}
          </div>
          <button
            onClick={handleConfirm}
            className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">add_circle</span>
            Añadir {preview.length} evento{preview.length !== 1 ? 's' : ''} al calendario
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main sheet ────────────────────────────────────────────────────────────────
export default function ImportExportSheet({ isOpen, onClose, events, onImportEvent, initialTab = 'export' }) {
  const [activeTab, setActiveTab] = useState(initialTab)

  // Reset to initialTab each time the sheet opens
  useEffect(() => { if (isOpen) setActiveTab(initialTab) }, [isOpen, initialTab])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet slides up from bottom */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[56] max-h-[90dvh] flex flex-col bg-surface dark:bg-slate-900 rounded-t-[28px] shadow-2xl"
        style={{ animation: 'slideUp 0.3s cubic-bezier(0.34,1.2,0.64,1) both' }}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-outline-variant rounded-full mx-auto mt-4 mb-2 flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 flex-shrink-0">
          <h2 className="font-headline font-extrabold text-xl text-on-surface dark:text-slate-100">
            Importar / Exportar
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-outline hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1.5 px-6 pb-3 flex-shrink-0 overflow-x-auto hide-scrollbar">
          {TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                activeTab === id
                  ? 'bg-primary text-white shadow-md shadow-primary/20'
                  : 'bg-surface-container-low text-outline hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto hide-scrollbar px-6 pb-10">
          {activeTab === 'export' && <ExportTab events={events} />}
          {activeTab === 'import' && <ImportICSTab onImport={onImportEvent} />}
          {activeTab === 'text'   && <TextTab onImport={onImportEvent} />}
          {activeTab === 'photo'  && <PhotoTab onImport={onImportEvent} />}
        </div>
      </div>
    </>
  )
}

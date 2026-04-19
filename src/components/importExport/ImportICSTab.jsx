import { useRef, useState } from 'react'
import { parseICS } from '../../utils/icsImport'
import PreviewCard from './PreviewCard'

// Tab "Importar ICS": file picker → parseICS → preview editable → confirmar.
export default function ImportICSTab({ onImport }) {
  const fileRef = useRef(null)
  const [preview, setPreview] = useState([])
  const [error, setError] = useState('')
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
      } catch {
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

      <button
        onClick={() => fileRef.current?.click()}
        className="w-full py-5 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 flex flex-col items-center gap-2 hover:bg-primary/8 active:scale-[0.98] transition-all"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-primary text-4xl">upload_file</span>
        <span className="font-bold text-primary text-sm">Seleccionar archivo .ics</span>
        <span className="text-xs text-outline font-medium">o arrastra aquí</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".ics,text/calendar"
        onChange={handleFile}
        aria-label="Archivo ICS para importar"
        className="hidden"
      />

      {preview.length === 0 && !error && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-outline uppercase tracking-wider">Cómo obtener el .ics</p>
          {[
            { icon: 'phone_iphone', label: 'iPhone / Mac', desc: 'Apple Calendar → selecciona un calendario → Archivo → Exportar → .ics' },
            { icon: 'language', label: 'Google Calendar', desc: 'calendar.google.com → Configuración → Exportar calendarios' },
          ].map(({ icon, label, desc }) => (
            <div key={label} className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
              <span aria-hidden="true" className="material-symbols-outlined text-outline text-[18px] mt-0.5">{icon}</span>
              <div>
                <p className="text-xs font-bold text-on-surface">{label}</p>
                <p className="text-xs text-outline font-medium mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="p-4 bg-error/10 rounded-xl border border-error/20">
          <p className="text-sm text-error font-semibold">{error}</p>
        </div>
      )}

      {imported && (
        <div role="status" className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex items-center gap-3">
          <span aria-hidden="true" className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-sm font-bold text-primary">Eventos importados correctamente</p>
        </div>
      )}

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
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">download</span>
            Importar {preview.length} evento{preview.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  )
}

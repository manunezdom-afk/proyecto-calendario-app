import { useRef, useState } from 'react'
import PreviewCard from './PreviewCard'
import { resizeToBase64, aiToAppEvent } from '../../utils/photoToEvents'

// Tab "Foto": sube imágenes → resize client-side → /api/analyze-photo → preview.
// resizeToBase64 y aiToAppEvent viven en utils/photoToEvents.js porque
// también los usan NovaWidget y FocusBar (adjuntar foto al chat).

export default function PhotoTab({ onImport }) {
  const [photos, setPhotos] = useState([])
  const [preview, setPreview] = useState([])
  const [analyzing, setAnalyzing] = useState(false)
  const [imported, setImported] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  function handlePhotos(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setPhotos((prev) => [...prev, ...files.map((f) => ({ url: URL.createObjectURL(f), file: f }))])
    setPreview([])
    setImported(false)
    setError('')
    e.target.value = ''
  }

  function removePhoto(idx) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[idx].url)
      return prev.filter((_, i) => i !== idx)
    })
    setPreview([])
    setError('')
  }

  async function handleAnalyze() {
    if (!photos.length) return
    setAnalyzing(true)
    setError('')
    setPreview([])

    try {
      const images = await Promise.all(photos.map((p) => resizeToBase64(p.file)))

      let res
      try {
        res = await fetch('/api/analyze-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images }),
        })
      } catch {
        setError('No se pudo conectar con el servidor. Verifica tu conexión a internet.')
        return
      }

      let data
      try {
        data = await res.json()
      } catch {
        setError(`Error del servidor (${res.status}). El deploy puede estar en curso — espera un minuto y reintenta.`)
        return
      }

      if (res.status === 429) {
        setError('Demasiadas solicitudes. Espera un momento e intenta de nuevo.')
        return
      }

      if (!res.ok || data.error) {
        const detail = data.detail ? ` (${data.detail})` : ''
        setError(`Error al analizar: ${data.error ?? res.status}${detail}. Intenta de nuevo.`)
        return
      }

      if (!data.events || data.events.length === 0) {
        setError('No se detectaron eventos. Asegúrate de que las fotos muestren horarios o fechas visibles.')
        return
      }

      setPreview(data.events.map(aiToAppEvent))
    } catch (err) {
      setError(`Error inesperado: ${err?.message ?? 'desconocido'}`)
    } finally {
      setAnalyzing(false)
    }
  }

  function removeFromPreview(id) {
    setPreview((prev) => prev.filter((e) => e.id !== id))
  }

  function handleConfirm() {
    preview.forEach((ev) => onImport(ev))
    setImported(true)
    setPreview([])
    setPhotos([])
  }

  return (
    <div className="space-y-5">
      <div className="px-1">
        <p className="text-sm text-on-surface-variant font-medium">
          Sube fotos — la IA las lee y extrae todos los eventos.
        </p>
      </div>

      <button
        onClick={() => fileRef.current?.click()}
        disabled={analyzing}
        className="w-full py-6 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 flex flex-col items-center gap-2 hover:bg-primary/8 active:scale-[0.98] transition-all disabled:opacity-40"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-primary text-5xl" style={{ fontVariationSettings: "'FILL' 1" }}>
          add_photo_alternate
        </span>
        <span className="font-bold text-primary">
          {photos.length === 0 ? 'Seleccionar fotos' : `Añadir más (${photos.length} seleccionada${photos.length !== 1 ? 's' : ''})`}
        </span>
        <span className="text-xs text-outline font-medium">JPG, PNG · Varias a la vez</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handlePhotos}
        aria-label="Fotos a analizar"
        className="hidden"
      />

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map(({ url }, idx) => (
            <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-surface-container-low">
              <img src={url} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
              <button
                onClick={() => removePhoto(idx)}
                disabled={analyzing}
                aria-label={`Quitar foto ${idx + 1}`}
                className="absolute top-1 right-1 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center disabled:opacity-0"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[13px]">close</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="p-4 bg-error/10 rounded-xl border border-error/20">
          <p className="text-sm text-error font-semibold">{error}</p>
        </div>
      )}

      {photos.length > 0 && !analyzing && preview.length === 0 && !imported && (
        <button
          onClick={handleAnalyze}
          className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[22px]">auto_awesome</span>
          Analizar {photos.length} foto{photos.length !== 1 ? 's' : ''} con IA
        </button>
      )}

      {analyzing && (
        <div role="status" className="py-10 flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          <div className="text-center">
            <p className="text-sm font-bold text-on-surface">Analizando fotos...</p>
            <p className="text-xs text-outline font-medium mt-1">La IA está leyendo tu horario</p>
          </div>
        </div>
      )}

      {imported && (
        <div role="status" className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex items-center gap-3">
          <span aria-hidden="true" className="material-symbols-outlined text-primary text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-sm font-bold text-primary">Eventos añadidos al calendario</p>
        </div>
      )}

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
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">add_circle</span>
            Añadir {preview.length} evento{preview.length !== 1 ? 's' : ''} al calendario
          </button>
        </div>
      )}
    </div>
  )
}

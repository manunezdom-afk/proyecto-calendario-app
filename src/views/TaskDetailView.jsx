import { useState } from 'react'
import TimePickerSheet from '../components/TimePickerSheet'

const REMINDER_PRESETS = [
  { min: 5,    label: '5 min' },
  { min: 10,   label: '10 min' },
  { min: 30,   label: '30 min' },
  { min: 60,   label: '1 h' },
  { min: 120,  label: '2 h' },
  { min: 1440, label: '1 día' },
]

// Vista de detalle/edición de un evento real. Antes estaba llena de placeholders
// hardcoded ("Loft Modernista", "Proyecto Alpha", "Resumen de IA" ficticio, avatares
// random). Ahora solo muestra lo que realmente tiene el evento.
export default function TaskDetailView({ event, onBack, onSave, onDelete }) {
  const [title,       setTitle]       = useState(event?.title       ?? '')
  const [time,        setTime]        = useState(event?.time        ?? '')
  const [date,        setDate]        = useState(event?.date        ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [section,     setSection]     = useState(event?.section     ?? 'focus')
  // null = usar defaults del cliente ([10,30,60]); [] = silenciado; array = custom
  const [reminderOffsets, setReminderOffsets] = useState(
    Array.isArray(event?.reminderOffsets) ? [...event.reminderOffsets] : null,
  )
  const [saved, setSaved] = useState(false)
  const [showTimePicker, setShowTimePicker] = useState(false)

  const usingDefaults = reminderOffsets === null
  const silenced = Array.isArray(reminderOffsets) && reminderOffsets.length === 0

  function toggleOffset(min) {
    const current = Array.isArray(reminderOffsets) ? reminderOffsets : [10, 30, 60]
    const next = current.includes(min)
      ? current.filter((o) => o !== min)
      : [...current, min].sort((a, b) => a - b)
    setReminderOffsets(next)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const updates = {
      title: title.trim() || 'Sin título',
      time: time.trim(),
      date: date.trim() || null,
      description: description.trim(),
      section,
      reminderOffsets,
    }
    onSave?.(updates)
    setSaved(true)
    setTimeout(() => { setSaved(false); onBack?.() }, 900)
  }

  function handleDelete() {
    if (!event?.id) { onBack?.(); return }
    if (!confirm(`¿Eliminar "${event.title}"?`)) return
    onDelete?.(event.id)
    onBack?.()
  }

  return (
    <div className="bg-surface min-h-screen pb-40">
      <main className="max-w-xl mx-auto px-6 pt-6">

        {/* Header con volver */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={onBack}
            className="w-10 h-10 flex items-center justify-center rounded-full text-outline hover:bg-surface-container-low transition-colors"
            aria-label="Volver"
          >
            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
          </button>
          <h1 className="text-2xl font-extrabold text-on-surface">Detalle del evento</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Title */}
          <div className="space-y-2">
            <label className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-outline">Título</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Clase de Contenidos Digitales"
              className="w-full bg-surface-container-low rounded-xl p-4 text-on-surface font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
          </div>

          {/* Time + Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-outline">Hora</label>
              <button
                type="button"
                onClick={() => setShowTimePicker(true)}
                className="w-full bg-surface-container-low rounded-xl p-4 text-on-surface font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all flex items-center justify-between gap-2"
              >
                <span className={time ? '' : 'text-outline/60'}>
                  {time || '8:30 AM'}
                </span>
                <span className="material-symbols-outlined text-outline text-[18px]">schedule</span>
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-outline">Fecha</label>
              <input
                type="date"
                value={date || ''}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-surface-container-low rounded-xl p-4 text-on-surface font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
          </div>

          {/* Section toggle */}
          <div className="space-y-2">
            <label className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-outline">Sección</label>
            <div className="flex p-1 bg-surface-container-low rounded-xl">
              {[
                { id: 'focus',   label: 'Mañana / Foco' },
                { id: 'evening', label: 'Tarde / Noche' },
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSection(opt.id)}
                  className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors ${
                    section === opt.id
                      ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                      : 'text-outline'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reminders */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-outline">Recordatorios</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setReminderOffsets(null)}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors ${
                    usingDefaults ? 'bg-primary/10 text-primary' : 'text-outline hover:bg-surface-container-low'
                  }`}
                >
                  Por defecto
                </button>
                <button
                  type="button"
                  onClick={() => setReminderOffsets([])}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors ${
                    silenced ? 'bg-error/10 text-error' : 'text-outline hover:bg-surface-container-low'
                  }`}
                >
                  Silenciar
                </button>
              </div>
            </div>
            <p className="text-[11px] text-outline/80">
              {usingDefaults
                ? 'Usa los recordatorios por defecto (10 min, 30 min y 1 h antes).'
                : silenced
                ? 'Este evento no te enviará recordatorios.'
                : 'Focus avisará con el tono adecuado para este evento y los tiempos elegidos.'}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {REMINDER_PRESETS.map((p) => {
                const active = Array.isArray(reminderOffsets) && reminderOffsets.includes(p.min)
                return (
                  <button
                    key={p.min}
                    type="button"
                    onClick={() => toggleOffset(p.min)}
                    className={`min-h-[36px] px-3 rounded-full text-xs font-bold border transition-colors ${
                      active
                        ? 'bg-primary text-white border-primary'
                        : 'bg-surface-container-low border-transparent text-outline hover:text-on-surface'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-outline">Notas</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Detalles del evento (opcional)"
              className="w-full bg-surface-container-low rounded-xl p-4 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all resize-none"
            />
          </div>

          {/* Timezone info (readonly) */}
          {event?.timezone && (
            <div className="flex items-center gap-2 text-[11px] text-outline/70">
              <span className="material-symbols-outlined text-[14px]">schedule</span>
              <span>Creado en zona horaria: <b>{event.timezone}</b></span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-4">
            <button
              type="submit"
              className={`w-full py-4 rounded-xl font-bold text-white transition-colors ${
                saved ? 'bg-emerald-500' : 'bg-primary hover:bg-primary/90'
              }`}
            >
              {saved ? '✓ Guardado' : 'Guardar cambios'}
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onBack}
                className="flex-1 py-3 rounded-xl font-semibold text-outline hover:bg-surface-container-low transition-colors"
              >
                Cancelar
              </button>
              {event?.id && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex-1 py-3 rounded-xl font-semibold text-error hover:bg-error/10 transition-colors flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                  Eliminar
                </button>
              )}
            </div>
          </div>
        </form>
      </main>

      {showTimePicker && (
        <TimePickerSheet
          initialValue={time}
          outputFormat="12h"
          onClose={() => setShowTimePicker(false)}
          onSave={(v) => { setTime(v); setShowTimePicker(false) }}
          onClear={() => setTime('')}
        />
      )}
    </div>
  )
}

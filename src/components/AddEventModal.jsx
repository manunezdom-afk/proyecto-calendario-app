import { useState, useEffect, useId } from 'react'

const ICONS = [
  { value: 'event', label: 'General' },
  { value: 'work', label: 'Trabajo' },
  { value: 'fitness_center', label: 'Ejercicio' },
  { value: 'restaurant', label: 'Comida' },
  { value: 'menu_book', label: 'Estudio' },
  { value: 'favorite', label: 'Personal' },
]

const DOT_COLORS = [
  { value: 'bg-primary', label: 'Azul' },
  { value: 'bg-secondary-container', label: 'Violeta' },
  { value: 'bg-tertiary', label: 'Naranja' },
  { value: 'bg-secondary', label: 'Índigo' },
]

export default function AddEventModal({ onSave, onCancel }) {
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [description, setDescription] = useState('')
  const [section, setSection] = useState('focus')
  const [icon, setIcon] = useState('event')
  const [dotColor, setDotColor] = useState('bg-secondary-container')
  const [error, setError] = useState('')

  const titleId = useId()
  const timeId = useId()
  const descId = useId()
  const dialogTitleId = useId()

  // Cerrar con Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) {
      setError('El nombre del evento es obligatorio.')
      console.warn('[Focus] ⚠️ AddEventModal — tried to save without a title.')
      return
    }
    setError('')
    onSave({ title: title.trim(), time, description, section, icon, dotColor })
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-on-surface/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        className="w-full max-w-md bg-surface rounded-t-[28px] p-6 space-y-5 shadow-2xl animate-[slideUp_0.25s_ease-out]"
      >
        <div className="flex justify-between items-center">
          <h2 id={dialogTitleId} className="text-xl font-extrabold font-headline text-on-surface">Nuevo Evento</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-container-low text-outline hover:text-on-surface transition-colors"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-1">
            <label htmlFor={titleId} className="text-xs font-bold text-outline uppercase tracking-wider">
              Nombre del evento *
            </label>
            <input
              id={titleId}
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Reunión con el equipo"
              aria-required="true"
              aria-invalid={!!error}
              className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm font-semibold text-on-surface placeholder:text-outline/60 border-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
            {error && (
              <p role="alert" className="text-xs font-semibold text-error">{error}</p>
            )}
          </div>

          {/* Time */}
          <div className="space-y-1">
            <label htmlFor={timeId} className="text-xs font-bold text-outline uppercase tracking-wider">
              Horario
            </label>
            <input
              id={timeId}
              type="text"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="Ej: 3:00 PM - 4:00 PM"
              className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm font-semibold text-on-surface placeholder:text-outline/60 border-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label htmlFor={descId} className="text-xs font-bold text-outline uppercase tracking-wider">
              Descripción
            </label>
            <input
              id={descId}
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notas adicionales..."
              className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm font-semibold text-on-surface placeholder:text-outline/60 border-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
          </div>

          {/* Section */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-outline uppercase tracking-wider">
              Sección
            </label>
            <div className="flex gap-2">
              {[
                { value: 'focus', label: 'Enfoque del Día' },
                { value: 'evening', label: 'Tarde/Noche' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSection(value)}
                  className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                    section === value
                      ? 'bg-primary text-white shadow-md'
                      : 'bg-surface-container-low text-outline'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Icon (only for focus section) */}
          {section === 'focus' && (
            <div className="space-y-1">
              <label className="text-xs font-bold text-outline uppercase tracking-wider">
                Icono
              </label>
              <div className="flex gap-2 flex-wrap">
                {ICONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setIcon(value)}
                    title={label}
                    className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
                      icon === value
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-surface-container-low text-outline'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">{value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Dot color (only for evening section) */}
          {section === 'evening' && (
            <div className="space-y-1">
              <label className="text-xs font-bold text-outline uppercase tracking-wider">
                Color del indicador
              </label>
              <div className="flex gap-2">
                {DOT_COLORS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDotColor(value)}
                    title={label}
                    className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${value} ${
                      dotColor === value ? 'ring-2 ring-offset-2 ring-on-surface scale-110' : 'opacity-60'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-3 rounded-xl font-bold text-sm text-outline bg-surface-container-low hover:bg-surface-container transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-br from-primary to-primary-container shadow-lg shadow-primary/20 active:scale-95 transition-all"
            >
              Guardar Evento
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

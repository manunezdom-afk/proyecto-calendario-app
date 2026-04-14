import { useState } from 'react'

const MAP_IMG =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDnMdZmXSTb0jbZIHNsec7M3li4X741nok3cjPlKbRbvQeqGwnxHjftvEjjyQy0kiCK4whoj71CKPPsJGTSKA62lB7axNvi7bDYU7iWfC4kkTJZxO9jYlQza6HS9EsJHg41-RTD_ASwcqx7m5wsBZyh-AC7H-PQsyG9ycCJVKQOIm0AMHBOOIGwVcRI-5SYWUZXd5ASam3QEchfV4i2GNS59exO003RAac4Cui_64uQFproH6MIkVhZTo9Yo5GuLV57DaD2ca6aIaeH'
const AVATAR_1 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuB_eBQne1aLkOHf2-xZ1394mUnZJqAfijOj-0ED2jP7jaU7acMrowHX40n4JlKijA61kh_7sW5nr0xGb7zNVM11ZOU81OKSfRgV_ayG1UXOrSuarNif_qfIo3m359mSZB-81xlgcL5jcInCNw4ExifQvJEKcg-aS2FF_qmtJdy1YfuYzldA-XgGG61fhtmg8riyQBM6X7qjaxniZUOsfNkY2UkbOOSM7MYhVy5MC5EFQhEnSF-a33a3UWlTYxEQgw-LhkpiGRId0ew7'
const AVATAR_2 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA9syuW62HSuJNwX5c6fMMiJ5P-wwrw-PpjZB9msgbqT0iPE7-BMv6LkbCClFtJUHdOaIUBZmjIMHmq1HVvBJQBHD7jMWp3Tg8y6DUDIPAsGwfC73IuCBh0NB9qUA3YsPX1mZ6yg0vf5Lq9Cb6xHXGU_RcMVJMzlehKfhzD_y5oqGGpmqgnoxSKygCRo128IP-uBeI2j-0P9FvG74JDvyTieTafbUG0bY6koZ1zR-FxrTbChR4oUk9ZXJbCp4tdqoVPumrMYZogYcbw'

const PRIORITIES = ['Baja', 'Media', 'Alta']

// event: the calendar event being edited (optional — falls back to demo data)
export default function TaskDetailView({ event, onBack, onSave }) {
  // ── Controlled form state ──────────────────────────────────────────────────
  const [title, setTitle] = useState(event?.title ?? 'Sincronización y Revisión de Estrategia de Producto')
  const [time, setTime] = useState(event?.time ?? 'Oct 24, 14:00 - 15:00')
  const [notes, setNotes] = useState('Asegurarse de cubrir la asignación de recursos de ingeniería para las primeras 4 semanas. Interesados clave: Mike (CTO), Sarah (Responsable de Producto).')
  const [priority, setPriority] = useState('Alta')
  const [tags, setTags] = useState(['Estrategia', 'Planificación Q4'])
  const [newTag, setNewTag] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [saved, setSaved] = useState(false)

  // ── Tag handlers ───────────────────────────────────────────────────────────
  function removeTag(tag) {
    console.log(`[Sanctuary] 🏷️ Removing tag: "${tag}"`)
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  function confirmNewTag() {
    const trimmed = newTag.trim()
    if (!trimmed || tags.includes(trimmed)) {
      setNewTag('')
      setAddingTag(false)
      return
    }
    console.log(`[Sanctuary] 🏷️ Adding tag: "${trimmed}"`)
    setTags((prev) => [...prev, trimmed])
    setNewTag('')
    setAddingTag(false)
  }

  // ── Priority handler ───────────────────────────────────────────────────────
  function selectPriority(p) {
    console.log(`[Sanctuary] ⚡ Priority changed to: "${p}"`)
    setPriority(p)
  }

  // ── Save handler ───────────────────────────────────────────────────────────
  function handleSave(e) {
    e.preventDefault()
    const updated = { title, time, notes, priority, tags }
    console.log('[Sanctuary] 💾 Saving task details:', updated)
    if (onSave) onSave(updated)
    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      onBack()
    }, 1000)
  }

  return (
    <div className="bg-surface selection:bg-primary-fixed min-h-screen pb-32">

      <main className="max-w-4xl mx-auto px-6 pt-12">
        {/* Header */}
        <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-3 py-1 rounded-full bg-primary-fixed-dim/20 text-primary font-semibold text-xs tracking-wider uppercase">
                Proyecto Alpha
              </span>
              <span
                className={`px-3 py-1 rounded-full font-semibold text-xs tracking-wider uppercase ${
                  priority === 'Alta'
                    ? 'bg-error/10 text-error'
                    : priority === 'Media'
                    ? 'bg-secondary-fixed/30 text-secondary'
                    : 'bg-surface-container text-outline'
                }`}
              >
                Prioridad {priority}
              </span>
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold text-on-surface tracking-tight leading-tight">
              {title || 'Sin título'}
            </h2>
            <p className="mt-4 text-on-surface-variant text-lg leading-relaxed font-medium">
              Refinando el roadmap trimestral con los líderes de diseño e ingeniería.
            </p>
          </div>
          <div className="flex flex-col items-start md:items-end">
            <span className="text-on-surface-variant text-sm font-semibold mb-1">Estado</span>
            <div className="flex items-center gap-2 text-primary font-bold text-xl">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                auto_awesome
              </span>
              <span>Programado por IA</span>
            </div>
          </div>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* AI Summary */}
          <div className="md:col-span-2 bg-surface-container-lowest p-8 rounded-xl shadow-[0_12px_32px_rgba(27,27,29,0.06)] relative overflow-hidden">
            <div className="absolute top-0 right-0 p-6 opacity-10">
              <span className="material-symbols-outlined text-8xl">psychology</span>
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-6">
                <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                  smart_toy
                </span>
                <h3 className="font-headline font-bold text-xl">Resumen de Inteligencia IA</h3>
              </div>
              <p className="text-on-surface-variant leading-loose mb-6 text-lg">
                Sanctuary programó esta tarea para las{' '}
                <span className="text-primary font-bold">14:00 hoy</span> basándose en tu ventana
                de máximo rendimiento cognitivo. Detectamos dependencias con el "Project Alpha" que
                finalizó hace 2 horas. Este espacio evita tu caída de energía de las 16:30 y
                asegura la finalización antes de la fecha límite del viernes.
              </p>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-lg">
                  <span className="material-symbols-outlined text-secondary text-sm">bolt</span>
                  <span className="text-sm font-semibold">Ventana de Trabajo Profundo</span>
                </div>
                <div className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-lg">
                  <span className="material-symbols-outlined text-secondary text-sm">link</span>
                  <span className="text-sm font-semibold">2 Dependencias Cumplidas</span>
                </div>
              </div>
            </div>
          </div>

          {/* Meta column */}
          <div className="space-y-6">
            <div className="bg-surface-container-low p-6 rounded-xl">
              <span className="text-xs font-bold text-outline uppercase tracking-widest block mb-4">
                Ubicación y Logística
              </span>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-white rounded-lg">
                    <span className="material-symbols-outlined text-primary">location_on</span>
                  </div>
                  <div>
                    <p className="font-bold text-on-surface">Loft Modernista</p>
                    <p className="text-sm text-on-surface-variant">Calle 4, Distrito Creativo</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-white rounded-lg">
                    <span className="material-symbols-outlined text-primary">schedule</span>
                  </div>
                  <div>
                    <p className="font-bold text-on-surface">60 Minutos</p>
                    <p className="text-sm text-on-surface-variant">Duración Estimada</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="h-32 w-full rounded-xl overflow-hidden grayscale contrast-125 opacity-80 hover:grayscale-0 transition-all duration-700">
              <img className="w-full h-full object-cover" src={MAP_IMG} alt="Mapa" />
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="bg-surface-container-low p-1 rounded-xl">
          <div className="bg-surface-container-lowest p-8 md:p-12 rounded-[22px]">
            <h3 className="font-headline font-bold text-2xl mb-8">Refinar Detalles</h3>
            <form onSubmit={handleSave} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                {/* Title */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-on-surface-variant ml-1">
                    Nombre del Evento
                  </label>
                  <input
                    className="bg-surface-container-low border-none rounded-lg p-4 font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                {/* Time */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-on-surface-variant ml-1">Horario</label>
                  <div className="relative">
                    <input
                      className="w-full bg-surface-container-low border-none rounded-lg p-4 font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      type="text"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                    <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-outline">
                      calendar_today
                    </span>
                  </div>
                </div>

                {/* Tags */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-on-surface-variant ml-1">
                    Etiquetas de Contexto
                  </label>
                  <div className="flex flex-wrap gap-2 p-2 bg-surface-container-low rounded-lg min-h-[56px] items-center">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="bg-white px-3 py-1 rounded-md text-xs font-bold text-on-surface flex items-center gap-1"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="hover:text-error transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      </span>
                    ))}
                    {addingTag ? (
                      <input
                        autoFocus
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onBlur={confirmNewTag}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); confirmNewTag() }
                          if (e.key === 'Escape') { setAddingTag(false); setNewTag('') }
                        }}
                        placeholder="Nueva etiqueta..."
                        className="bg-transparent border-none outline-none text-xs font-bold text-on-surface w-28"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingTag(true)}
                        className="p-1 text-primary hover:bg-primary/5 rounded transition-colors"
                      >
                        <span className="material-symbols-outlined">add</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Priority */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-on-surface-variant ml-1">
                    Anular Prioridad
                  </label>
                  <div className="flex p-1 bg-surface-container-low rounded-lg h-[56px]">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => selectPriority(p)}
                        className={`flex-1 rounded-md flex items-center justify-center text-sm font-bold transition-all ${
                          priority === p
                            ? 'bg-primary text-white shadow-lg'
                            : 'text-outline hover:text-on-surface'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-on-surface-variant ml-1">Notas</label>
                <textarea
                  className="bg-surface-container-low border-none rounded-lg p-4 font-medium text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all leading-relaxed"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {/* Footer */}
              <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-6 border-t border-outline-variant/15">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-3">
                    <img className="h-10 w-10 rounded-full border-4 border-surface-container-lowest object-cover" src={AVATAR_1} alt="Stakeholder" />
                    <img className="h-10 w-10 rounded-full border-4 border-surface-container-lowest object-cover" src={AVATAR_2} alt="Stakeholder" />
                    <div className="h-10 w-10 rounded-full border-4 border-surface-container-lowest bg-surface-container-high flex items-center justify-center text-xs font-bold text-on-surface-variant">
                      +3
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-on-surface-variant">
                    Interesados Invitados
                  </span>
                </div>
                <div className="flex items-center gap-4 w-full md:w-auto">
                  <button
                    type="button"
                    onClick={onBack}
                    className="flex-1 md:flex-none px-8 py-4 rounded-xl font-bold text-on-surface-variant hover:bg-surface-container-low transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className={`flex-1 md:flex-none px-10 py-4 rounded-xl font-bold text-white shadow-xl active:scale-95 transition-all ${
                      saved
                        ? 'bg-green-500 shadow-green-500/20'
                        : 'bg-gradient-to-br from-primary to-primary-container shadow-primary/20'
                    }`}
                  >
                    {saved ? '✓ Guardado' : 'Guardar Inteligencia'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}

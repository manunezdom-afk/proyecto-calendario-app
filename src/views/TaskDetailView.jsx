import TopAppBar from '../components/TopAppBar'

const MAP_IMG =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDnMdZmXSTb0jbZIHNsec7M3li4X741nok3cjPlKbRbvQeqGwnxHjftvEjjyQy0kiCK4whoj71CKPPsJGTSKA62lB7axNvi7bDYU7iWfC4kkTJZxO9jYlQza6HS9EsJHg41-RTD_ASwcqx7m5wsBZyh-AC7H-PQsyG9ycCJVKQOIm0AMHBOOIGwVcRI-5SYWUZXd5ASam3QEchfV4i2GNS59exO003RAac4Cui_64uQFproH6MIkVhZTo9Yo5GuLV57DaD2ca6aIaeH'
const AVATAR_1 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuB_eBQne1aLkOHf2-xZ1394mUnZJqAfijOj-0ED2jP7jaU7acMrowHX40n4JlKijA61kh_7sW5nr0xGb7zNVM11ZOU81OKSfRgV_ayG1UXOrSuarNif_qfIo3m359mSZB-81xlgcL5jcInCNw4ExifQvJEKcg-aS2FF_qmtJdy1YfuYzldA-XgGG61fhtmg8riyQBM6X7qjaxniZUOsfNkY2UkbOOSM7MYhVy5MC5EFQhEnSF-a33a3UWlTYxEQgw-LhkpiGRId0ew7'
const AVATAR_2 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA9syuW62HSuJNwX5c6fMMiJ5P-wwrw-PpjZB9msgbqT0iPE7-BMv6LkbCClFtJUHdOaIUBZmjIMHmq1HVvBJQBHD7jMWp3Tg8y6DUDIPAsGwfC73IuCBh0NB9qUA3YsPX1mZ6yg0vf5Lq9Cb6xHXGU_RcMVJMzlehKfhzD_y5oqGGpmqgnoxSKygCRo128IP-uBeI2j-0P9FvG74JDvyTieTafbUG0bY6koZ1zR-FxrTbChR4oUk9ZXJbCp4tdqoVPumrMYZogYcbw'

export default function TaskDetailView({ onBack }) {
  return (
    <div className="bg-surface selection:bg-primary-fixed min-h-screen pb-32">
      <TopAppBar showBack onBack={onBack} />

      <main className="max-w-4xl mx-auto px-6 pt-12">
        {/* Header Section */}
        <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-3 py-1 rounded-full bg-primary-fixed-dim/20 text-primary font-semibold text-xs tracking-wider uppercase">
                Proyecto Alpha
              </span>
              <span className="px-3 py-1 rounded-full bg-secondary-fixed/30 text-secondary font-semibold text-xs tracking-wider uppercase">
                Prioridad Alta
              </span>
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold text-on-surface tracking-tight leading-tight">
              Sincronización y Revisión de Estrategia de Producto
            </h2>
            <p className="mt-4 text-on-surface-variant text-lg leading-relaxed font-medium">
              Refinando el roadmap trimestral con los líderes de diseño e ingeniería.
            </p>
          </div>
          <div className="flex flex-col items-start md:items-end">
            <span className="text-on-surface-variant text-sm font-semibold mb-1">Estado</span>
            <div className="flex items-center gap-2 text-primary font-bold text-xl">
              <span
                className="material-symbols-outlined"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                auto_awesome
              </span>
              <span>Programado por IA</span>
            </div>
          </div>
        </div>

        {/* Bento Grid Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* AI Summary Card */}
          <div className="md:col-span-2 bg-surface-container-lowest p-8 rounded-xl shadow-[0_12px_32px_rgba(27,27,29,0.06)] relative overflow-hidden">
            <div className="absolute top-0 right-0 p-6 opacity-10">
              <span className="material-symbols-outlined text-8xl">psychology</span>
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-6">
                <span
                  className="material-symbols-outlined text-primary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
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

          {/* Meta Data Column */}
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
              <img className="w-full h-full object-cover" src={MAP_IMG} alt="Mapa de ubicación" />
            </div>
          </div>
        </div>

        {/* Form / Editor Section */}
        <div className="bg-surface-container-low p-1 rounded-xl">
          <div className="bg-surface-container-lowest p-8 md:p-12 rounded-[22px]">
            <h3 className="font-headline font-bold text-2xl mb-8">Refinar Detalles</h3>
            <form className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Task Name */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-on-surface-variant ml-1">
                    Nombre del Evento
                  </label>
                  <input
                    className="bg-surface-container-low border-none rounded-lg p-4 font-semibold text-on-surface focus:ring-2 focus:ring-primary/20 transition-all"
                    type="text"
                    defaultValue="Sincronización y Revisión de Estrategia de Producto"
                  />
                </div>

                {/* Date/Time */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-on-surface-variant ml-1">
                    Horario
                  </label>
                  <div className="relative">
                    <input
                      className="w-full bg-surface-container-low border-none rounded-lg p-4 font-semibold text-on-surface focus:ring-2 focus:ring-primary/20 transition-all"
                      type="text"
                      defaultValue="Oct 24, 14:00 - 15:00"
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
                    {['Estrategia', 'Planificación Q4'].map((tag) => (
                      <span
                        key={tag}
                        className="bg-white px-3 py-1 rounded-md text-xs font-bold text-on-surface flex items-center gap-1"
                      >
                        {tag}
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </span>
                    ))}
                    <button className="p-1 text-primary hover:bg-primary/5 rounded">
                      <span className="material-symbols-outlined">add</span>
                    </button>
                  </div>
                </div>

                {/* Priority */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-on-surface-variant ml-1">
                    Anular Prioridad
                  </label>
                  <div className="flex p-1 bg-surface-container-low rounded-lg h-[56px]">
                    {['Baja', 'Media', 'Alta'].map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`flex-1 rounded-md flex items-center justify-center text-sm font-bold transition-all ${
                          p === 'Alta'
                            ? 'bg-primary text-white shadow-lg'
                            : 'text-outline'
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
                  className="bg-surface-container-low border-none rounded-lg p-4 font-medium text-on-surface-variant focus:ring-2 focus:ring-primary/20 transition-all leading-relaxed"
                  rows={4}
                  defaultValue="Asegurarse de cubrir la asignación de recursos de ingeniería para las primeras 4 semanas. Interesados clave: Mike (CTO), Sarah (Responsable de Producto)."
                />
              </div>

              {/* Footer Actions */}
              <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-6 border-t border-outline-variant/15">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-3">
                    <img
                      className="h-10 w-10 rounded-full border-4 border-surface-container-lowest object-cover"
                      src={AVATAR_1}
                      alt="Stakeholder"
                    />
                    <img
                      className="h-10 w-10 rounded-full border-4 border-surface-container-lowest object-cover"
                      src={AVATAR_2}
                      alt="Stakeholder"
                    />
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
                    className="flex-1 md:flex-none px-10 py-4 rounded-xl font-bold text-white bg-gradient-to-br from-primary to-primary-container shadow-xl shadow-primary/20 active:scale-95 transition-all"
                  >
                    Guardar Inteligencia
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

import TopAppBar from '../components/TopAppBar'

const AVATAR_1 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDfqPz-Xtp1DOlxyZ6qdBoqCnCTvLoTN7uCnDpKv7pQispXp8jMGm8VmAnGlq6fGljfeaM_FGgWpLdB3Ig6ImleJTb6h-TmrJg7wLQJBUNd1LSQiUrTmFaLHcku_b2IBR1b9-gtC7bCqoZTvugBoGNiE9EjBbxP2zP0nkLkJF5KXZxYSvNqigG3jSpyBQawu9fkiHNp1vQfAtrXoJyYILEZm_q5bSNPNATYmsirJUZFcSzFA1bGsAuK0G16fJNQgGEjyI-ErT5OZNRs'
const AVATAR_2 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuAGg2kzu3h6K4U-DHUHwAcgSd0y0SQIx6Duljc3apyQXiGDGaDJCJvmLXpH77eOXyP37Jc5UNLSd9hKH2_0BJqXhvtFuctuO1RWkTcExCM32YxUKV29rG8VZAro5LQQwBA75PSIOuScBv5k-ndaqFgJQNTRZRbvVa2ZXHve9TGmRIQetPC53lRJACf2mkMMFoX7yAwVHQpsMXQh-0XpdV1WYDlQF6dKony_nEBC2Jfhnzj8ftnPxl5-e5v_Kgn6dm-qDn9tw02nNGYd'

const calendarDays = [
  { day: 'LUN', num: 16, active: false },
  { day: 'MAR', num: 17, active: false },
  { day: 'MIÉ', num: 18, active: true },
  { day: 'JUE', num: 19, active: false },
  { day: 'VIE', num: 20, active: false },
  { day: 'SÁB', num: 21, active: false },
  { day: 'DOM', num: 22, active: false },
]

export default function CalendarView({ onOpenTask }) {
  return (
    <div className="bg-surface text-on-surface min-h-screen pb-32">
      <TopAppBar />

      <main className="max-w-md mx-auto px-6 pt-4 space-y-8">
        {/* Header & View Switcher */}
        <header className="flex flex-col gap-6">
          <div className="flex justify-between items-end">
            <div>
              <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-1">
                Septiembre 2024
              </p>
              <h1 className="text-4xl font-extrabold text-on-surface tracking-tight">
                Calendario
              </h1>
            </div>
            <div className="bg-surface-container-low p-1 rounded-xl flex">
              <button className="px-4 py-1.5 text-xs font-bold rounded-lg bg-surface-container-lowest shadow-sm text-on-surface">
                Mes
              </button>
              <button className="px-4 py-1.5 text-xs font-bold rounded-lg text-outline">
                Semana
              </button>
            </div>
          </div>

          {/* Calendar Strip */}
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map(({ day, num, active }) => (
              <div key={day} className="flex flex-col items-center gap-2">
                <span
                  className={`text-[10px] font-bold uppercase ${
                    active ? 'text-primary' : 'text-outline'
                  }`}
                >
                  {day}
                </span>
                {active ? (
                  <div className="w-10 h-14 flex flex-col items-center justify-center rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/20">
                    <span>{num}</span>
                    <div className="w-1 h-1 bg-white rounded-full mt-1"></div>
                  </div>
                ) : (
                  <div className="w-10 h-14 flex items-center justify-center rounded-2xl bg-surface-container-low text-on-surface font-semibold">
                    {num}
                  </div>
                )}
              </div>
            ))}
          </div>
        </header>

        {/* Asymmetric Intelligence Feed */}
        <section className="space-y-6">
          <h2 className="text-xl font-bold tracking-tight text-on-surface">Enfoque de Hoy</h2>
          <div className="grid grid-cols-2 gap-4">
            {/* Large Highlight Card */}
            <div
              className="col-span-2 bg-surface-container-lowest p-6 rounded-xl shadow-[0_12px_32px_rgba(27,27,29,0.04)] space-y-4 cursor-pointer hover:shadow-md transition-shadow"
              onClick={onOpenTask}
            >
              <div className="flex justify-between items-start">
                <div className="p-2 bg-primary-fixed-dim/30 rounded-lg text-primary">
                  <span className="material-symbols-outlined">auto_awesome</span>
                </div>
                <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1 rounded-full">
                  A Continuación
                </span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-on-surface">
                  Sincro de Estrategia de Producto
                </h3>
                <p className="text-sm text-outline mt-1 leading-relaxed">
                  Preparar la visualización del roadmap trimestral para la revisión de la junta
                  ejecutiva.
                </p>
              </div>
              <div className="flex items-center gap-4 pt-2">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px] text-outline">
                    schedule
                  </span>
                  <span className="text-xs font-semibold text-on-surface">2:00 PM - 3:30 PM</span>
                </div>
                <div className="flex -space-x-2">
                  <img
                    alt="Avatar"
                    className="w-6 h-6 rounded-full border-2 border-surface-container-lowest object-cover"
                    src={AVATAR_1}
                  />
                  <img
                    alt="Avatar"
                    className="w-6 h-6 rounded-full border-2 border-surface-container-lowest object-cover"
                    src={AVATAR_2}
                  />
                </div>
              </div>
            </div>

            {/* Small Detail Cards */}
            <div className="bg-surface-container-low p-5 rounded-xl space-y-3">
              <span className="material-symbols-outlined text-secondary">checklist</span>
              <h3 className="text-sm font-bold text-on-surface">Revisar Borradores</h3>
              <p className="text-[11px] text-outline font-medium">
                3 tareas pendientes en 'Trabajo'
              </p>
            </div>
            <div className="bg-surface-container-low p-5 rounded-xl space-y-3">
              <span className="material-symbols-outlined text-tertiary">park</span>
              <h3 className="text-sm font-bold text-on-surface">Almuerzo</h3>
              <p className="text-[11px] text-outline font-medium">12:30 PM - Parque Cercano</p>
            </div>
          </div>
        </section>

        {/* Vertical Timeline List */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold tracking-tight text-on-surface">Tarde/Noche</h2>
          <div className="space-y-2">
            {[
              { label: 'Práctica de Yoga', dot: 'bg-secondary-container' },
              { label: 'Cena con Sarah', dot: 'bg-tertiary' },
            ].map(({ label, dot }) => (
              <div key={label} className="flex gap-4 items-center group">
                <div className="w-12 text-right">
                  <span className="text-xs font-bold text-outline">{label}</span>
                </div>
                <div className="flex-1 bg-surface-container-lowest hover:bg-surface-container-high transition-colors p-4 rounded-xl flex justify-between items-center cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className={`w-1.5 h-1.5 rounded-full ${dot}`}></div>
                    <span className="font-bold text-sm text-on-surface">{label}</span>
                  </div>
                  <span className="material-symbols-outlined text-outline group-hover:text-on-surface transition-colors">
                    chevron_right
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Floating Action Button */}
      <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[60]">
        <button className="w-16 h-16 rounded-full bg-gradient-to-tr from-primary to-primary-container text-white shadow-[0_16px_32px_rgba(0,88,188,0.3)] flex items-center justify-center active:scale-90 transition-transform duration-300">
          <span className="material-symbols-outlined text-3xl">mic</span>
        </button>
      </div>
    </div>
  )
}

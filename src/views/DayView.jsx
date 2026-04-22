import { useState, useMemo } from 'react'
import DayTimeGrid from '../components/DayTimeGrid'
import QuickAddSheet from '../components/QuickAddSheet'
import { resolveEventDate, todayISO } from '../utils/resolveEventDate'

const DAY_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function shiftDate(iso, delta) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function initialDate() {
  try {
    const q = new URLSearchParams(window.location.search).get('date')
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q
  } catch {}
  return todayISO()
}

function formatHeader(iso) {
  const d = new Date(iso + 'T00:00:00')
  const isToday = iso === todayISO()
  const label = `${DAY_FULL[d.getDay()]} ${d.getDate()} de ${MONTHS_ES[d.getMonth()]}`
  return { label, isToday }
}

export default function DayView({ events = [], onAddEvent, onOpenTask, isDesktop = false }) {
  const [activeDate, setActiveDate] = useState(initialDate)
  const [showAdd, setShowAdd] = useState(false)

  const { label, isToday } = formatHeader(activeDate)
  const year = new Date(activeDate + 'T00:00:00').getFullYear()

  const dayEvents = useMemo(
    () => (events || []).filter((e) => resolveEventDate(e) === activeDate),
    [events, activeDate],
  )

  function goPrev() { setActiveDate((d) => shiftDate(d, -1)) }
  function goNext() { setActiveDate((d) => shiftDate(d, +1)) }
  function goToday() { setActiveDate(todayISO()) }

  function handleSave(formData) {
    onAddEvent?.({ ...formData, date: activeDate })
    setShowAdd(false)
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen pb-44">
      <main className={isDesktop ? 'max-w-4xl mx-auto px-6 pt-4 space-y-5' : 'max-w-md mx-auto px-4 pt-4 space-y-5'}>

        <header className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-primary mb-1">
                {isToday ? 'Hoy' : year}
              </p>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-on-surface capitalize">
                {label}
              </h1>
            </div>
            {!isToday && (
              <button
                onClick={goToday}
                className="text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
              >
                Hoy
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              aria-label="Día anterior"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-surface-container-low text-outline hover:text-primary hover:bg-primary/10 transition-colors active:scale-90"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_left</span>
            </button>
            <button
              onClick={goNext}
              aria-label="Día siguiente"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-surface-container-low text-outline hover:text-primary hover:bg-primary/10 transition-colors active:scale-90"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_right</span>
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 text-xs font-bold text-white bg-primary hover:bg-primary/90 px-4 py-2 rounded-full transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Añadir
            </button>
          </div>
        </header>

        {dayEvents.length === 0 && (
          <div className="bg-surface-container-low rounded-xl p-8 flex flex-col items-center gap-3 text-center">
            <span className="material-symbols-outlined text-3xl text-outline">event_available</span>
            <p className="text-sm font-semibold text-outline">
              {isToday ? 'Día libre. Todo tuyo.' : 'Sin eventos en este día.'}
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
            >
              Añadir primer evento
            </button>
          </div>
        )}

        {dayEvents.length > 0 && (
          <DayTimeGrid
            events={dayEvents}
            onAdd={() => setShowAdd(true)}
            onOpenTask={onOpenTask}
          />
        )}

        {showAdd && (
          <QuickAddSheet
            onSave={handleSave}
            onCancel={() => setShowAdd(false)}
          />
        )}
      </main>
    </div>
  )
}

import { useState, useEffect, useMemo } from 'react'
import DayTimeGrid from '../components/DayTimeGrid'
import QuickAddSheet from '../components/QuickAddSheet'
import { resolveEventDate, todayISO } from '../utils/resolveEventDate'
import { eventStatusAtNow } from '../utils/eventDuration'

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

export default function DayView({ events = [], tasks = [], onAddEvent, onOpenTask, isDesktop = false }) {
  const [activeDate, setActiveDate] = useState(initialDate)
  const [showAdd, setShowAdd] = useState(false)

  // Tick para reclasificar pasado/futuro cada minuto. Sin esto, un evento que
  // acaba a las 10:00 seguiría viéndose como "activo" hasta el próximo render
  // motivado por otra razón. No leemos el tick — el setter alcanza para
  // forzar un re-render que recalcula `now`.
  const [, setNowTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const { label, isToday } = formatHeader(activeDate)
  const year = new Date(activeDate + 'T00:00:00').getFullYear()

  const dayEvents = useMemo(
    () => (events || []).filter((e) => resolveEventDate(e) === activeDate),
    [events, activeDate],
  )

  // Tareas "agendadas" en la fecha seleccionada. El modelo de tareas no tiene
  // fecha por tarea; las de categoría "hoy" se consideran parte del día en
  // curso, por lo que las sumamos sólo cuando activeDate === hoy.
  const dayTasks = useMemo(
    () => {
      if (activeDate !== todayISO()) return []
      return (tasks || []).filter((t) => t && t.category === 'hoy')
    },
    [tasks, activeDate],
  )

  // Clasificación temporal — se recalcula en cada render. El tick del
  // minuto (arriba) es lo que fuerza re-renders.
  const now = new Date()
  const classifiedEvents = dayEvents.map((ev) => ({
    ev, status: eventStatusAtNow(ev, now),
  }))

  const hasAnyItem = dayEvents.length > 0 || dayTasks.length > 0
  const pendingTaskCount = dayTasks.filter((t) => !t.done).length
  // "Todo pasó": la fecha tiene items pero ninguno está activo/futuro ni hay
  // tareas pendientes. Incluye el caso de mirar un día anterior al de hoy.
  const allPast = hasAnyItem && pendingTaskCount === 0 && classifiedEvents.every(
    ({ status }) => status === 'past',
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

        {/* Estado del día:
              · Vacío real      → "Día libre"
              · Con items, pero ya todos pasaron → "No quedan eventos por hoy"
                  + seguimos mostrando el grid para que los eventos queden
                  visibles como finalizados (no los borramos).
              · Con items activos/futuros → grid normal. */}
        {!hasAnyItem && (
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

        {hasAnyItem && allPast && (
          <div className="bg-surface-container-low rounded-xl px-4 py-3 flex items-center gap-3">
            <span
              className="material-symbols-outlined text-outline text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              check_circle
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-on-surface leading-tight">
                {isToday ? 'No quedan eventos por hoy' : 'Todo lo de este día ya terminó'}
              </p>
              <p className="text-[11px] text-outline mt-0.5">
                Los eventos finalizados siguen abajo para referencia.
              </p>
            </div>
          </div>
        )}

        {dayEvents.length > 0 && (
          <DayTimeGrid
            events={dayEvents}
            referenceDate={now}
            onAdd={() => setShowAdd(true)}
            onOpenTask={onOpenTask}
          />
        )}

        {/* Lista compacta de tareas "hoy" — sólo aparece cuando activeDate es
            hoy y hay tareas. No pretendemos reemplazar la vista de Tareas,
            sólo dar contexto de lo que quedó por hacer en este día para que
            el empty-state se calcule correctamente. */}
        {dayTasks.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-outline uppercase tracking-wide">
              Tareas de hoy
            </h2>
            <ul className="space-y-1.5">
              {dayTasks.map((t) => (
                <li
                  key={t.id}
                  className={`flex items-start gap-2 bg-surface-container-lowest rounded-lg px-3 py-2 border-l-2 ${
                    t.done ? 'border-outline-variant opacity-60' : 'border-secondary'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[16px] mt-0.5 ${
                      t.done ? 'text-outline/60' : 'text-secondary'
                    }`}
                    style={{ fontVariationSettings: t.done ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {t.done ? 'task_alt' : 'check_box_outline_blank'}
                  </span>
                  <span className={`text-[13px] ${t.done ? 'line-through text-outline' : 'text-on-surface'}`}>
                    {t.label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
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

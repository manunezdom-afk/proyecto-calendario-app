import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import DayTimeGrid from '../components/DayTimeGrid'
const QuickAddSheet = lazy(() => import('../components/QuickAddSheet'))
import { resolveEventDate, todayISO } from '../utils/resolveEventDate'
import { eventStatusAtNow } from '../utils/eventDuration'
import { parseEventHour } from '../utils/time'

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

export default function DayView({ events = [], tasks = [], onAddEvent, onOpenTask, onOpenImport, onOpenPhotoImport, isDesktop = false }) {
  const [activeDate, setActiveDate] = useState(initialDate)
  const [showAdd, setShowAdd] = useState(false)
  // initialText permite prellenar el sheet con una plantilla (ej: bloque de
  // foco). Se limpia al cerrar para no arrastrar texto entre aperturas.
  const [quickAddInitial, setQuickAddInitial] = useState('')

  function scrollToNova() {
    try {
      const el = document.getElementById('nova-widget')
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'end' })
    } catch {}
  }

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

  // Separamos los eventos del día en "con hora" y "sin hora". El grid sólo
  // sabe ubicar eventos con una hora parseable; los que no la tienen (un
  // recordatorio "pagar la luz", un pendiente "llamar al dentista", o
  // cualquier evento que Nova creó sin horario) se filtraban silenciosamente
  // en DayTimeGrid y desaparecían de la vista. Aquí los rescatamos para
  // mostrarlos en una sección visible junto a las tareas.
  const timedEvents = useMemo(
    () => dayEvents.filter((e) => parseEventHour(e.time) != null),
    [dayEvents],
  )
  const untimedEvents = useMemo(
    () => dayEvents.filter((e) => parseEventHour(e.time) == null),
    [dayEvents],
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
    <div className="bg-surface text-on-surface pb-36">
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
        <AnimatePresence>
        {!hasAnyItem && (
          <motion.div
            key="empty-state"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-3"
          >
            {/* Prompt de Nova */}
            <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3.5 flex items-start gap-3">
              <span
                className="material-symbols-outlined text-primary text-[20px] mt-0.5 flex-shrink-0"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                auto_awesome
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-on-surface leading-snug">
                  {isToday
                    ? 'Tu agenda de hoy está vacía.'
                    : 'Sin eventos en este día.'}
                </p>
                <p className="text-[12px] text-outline mt-0.5 leading-snug">
                  {isToday
                    ? 'Dile a Nova qué tienes hoy, o añade algo tú mismo.'
                    : 'Planifica con anticipación para este día.'}
                </p>
              </div>
            </div>

            {/* Acciones rápidas */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setQuickAddInitial(''); setShowAdd(true) }}
                className="flex items-center gap-2 rounded-2xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 px-3.5 py-3 text-left transition-colors active:scale-[0.97]"
              >
                <span className="material-symbols-outlined text-primary text-[20px]">add_circle</span>
                <span className="text-[13px] font-semibold text-on-surface">Añadir</span>
              </button>

              <button
                onClick={scrollToNova}
                className="flex items-center gap-2 rounded-2xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 px-3.5 py-3 text-left transition-colors active:scale-[0.97]"
              >
                <span className="material-symbols-outlined text-primary text-[20px]">mic</span>
                <span className="text-[13px] font-semibold text-on-surface">Dictar</span>
              </button>

              {onOpenPhotoImport && (
                <button
                  onClick={onOpenPhotoImport}
                  className="flex items-center gap-2 rounded-2xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 px-3.5 py-3 text-left transition-colors active:scale-[0.97]"
                >
                  <span className="material-symbols-outlined text-primary text-[20px]">photo_camera</span>
                  <span className="text-[13px] font-semibold text-on-surface">Foto de agenda</span>
                </button>
              )}

              {onOpenImport && (
                <button
                  onClick={onOpenImport}
                  className="flex items-center gap-2 rounded-2xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 px-3.5 py-3 text-left transition-colors active:scale-[0.97]"
                >
                  <span className="material-symbols-outlined text-primary text-[20px]">download</span>
                  <span className="text-[13px] font-semibold text-on-surface">Importar</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
        </AnimatePresence>

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

        {/* Sección "Sin hora" — pendientes del día que no van en la línea de
            tiempo: eventos sin horario (recordatorios, "llamar al dentista")
            y las tareas de hoy. Va ARRIBA del grid para que quede a la vista:
            son justo las cosas que antes se perdían porque el grid sólo sabe
            ubicar eventos con hora. */}
        {(untimedEvents.length > 0 || dayTasks.length > 0) && (
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-outline uppercase tracking-wide flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">checklist</span>
              Sin hora
            </h2>
            <ul className="space-y-1.5">
              {untimedEvents.map((ev) => {
                const isPast = eventStatusAtNow(ev, now) === 'past'
                return (
                  <li key={ev.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask?.(ev)}
                      className={`w-full flex items-start gap-2 text-left bg-surface-container-lowest hover:bg-surface-container rounded-lg px-3 py-2 border-l-2 transition-colors active:scale-[0.99] ${
                        isPast ? 'border-outline-variant opacity-60' : 'border-primary'
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[16px] mt-0.5 flex-shrink-0 ${
                          isPast ? 'text-outline/60' : 'text-primary'
                        }`}
                      >
                        schedule
                      </span>
                      <span className={`text-[13px] min-w-0 flex-1 ${isPast ? 'line-through text-outline' : 'text-on-surface'}`}>
                        {ev.title}
                      </span>
                    </button>
                  </li>
                )
              })}
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

        <AnimatePresence>
        {timedEvents.length > 0 && (
          <motion.div
            key="day-grid"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <DayTimeGrid
              events={timedEvents}
              referenceDate={now}
              onAdd={() => setShowAdd(true)}
              onOpenTask={onOpenTask}
            />
          </motion.div>
        )}
        </AnimatePresence>

        {showAdd && (
          <Suspense fallback={null}>
            <QuickAddSheet
              onSave={(d) => { handleSave(d); setQuickAddInitial('') }}
              onCancel={() => { setShowAdd(false); setQuickAddInitial('') }}
              targetDate={activeDate}
              targetDateLabel={label}
              initialText={quickAddInitial}
              existingEvents={events}
            />
          </Suspense>
        )}
      </main>
    </div>
  )
}

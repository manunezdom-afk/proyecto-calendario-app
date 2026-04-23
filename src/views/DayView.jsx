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
          <div className="bg-surface-container-low rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span
                className="material-symbols-outlined text-primary text-[26px] flex-shrink-0 mt-0.5"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {isToday ? 'wb_sunny' : 'event_available'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-on-surface leading-tight">
                  {isToday ? 'Día libre. ¿Por dónde arrancamos?' : 'Sin eventos en este día.'}
                </p>
                <p className="text-[12.5px] text-outline mt-1 leading-snug">
                  {isToday
                    ? 'Elige una acción para poner algo en marcha.'
                    : 'Planifica desde ya para no llegar con la agenda en blanco.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setQuickAddInitial(''); setShowAdd(true) }}
                className="group flex flex-col items-start gap-1.5 rounded-2xl bg-surface-container-lowest hover:bg-primary/5 border border-outline-variant/40 hover:border-primary/40 p-3 text-left transition-colors active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-primary text-[22px]">add_circle</span>
                <span className="text-[13px] font-semibold text-on-surface leading-tight">Añadir evento</span>
                <span className="text-[11px] text-outline leading-snug">Lo que tengas en mente, escríbelo natural.</span>
              </button>

              <button
                onClick={() => { setQuickAddInitial('Bloque de foco 90 min'); setShowAdd(true) }}
                className="group flex flex-col items-start gap-1.5 rounded-2xl bg-surface-container-lowest hover:bg-primary/5 border border-outline-variant/40 hover:border-primary/40 p-3 text-left transition-colors active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-primary text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>psychology</span>
                <span className="text-[13px] font-semibold text-on-surface leading-tight">Bloque de foco</span>
                <span className="text-[11px] text-outline leading-snug">90 minutos sin interrupciones.</span>
              </button>

              <button
                onClick={scrollToNova}
                className="group flex flex-col items-start gap-1.5 rounded-2xl bg-surface-container-lowest hover:bg-primary/5 border border-outline-variant/40 hover:border-primary/40 p-3 text-left transition-colors active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-primary text-[22px]">mic</span>
                <span className="text-[13px] font-semibold text-on-surface leading-tight">Dictar con voz</span>
                <span className="text-[11px] text-outline leading-snug">Cuéntale tu día a Nova.</span>
              </button>

              <button
                onClick={() => (onOpenPhotoImport || onOpenImport)?.()}
                disabled={!onOpenImport && !onOpenPhotoImport}
                className="group flex flex-col items-start gap-1.5 rounded-2xl bg-surface-container-lowest hover:bg-primary/5 border border-outline-variant/40 hover:border-primary/40 p-3 text-left transition-colors active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-primary text-[22px]">{onOpenPhotoImport ? 'photo_camera' : 'download'}</span>
                <span className="text-[13px] font-semibold text-on-surface leading-tight">
                  {onOpenPhotoImport ? 'Foto de tu agenda' : 'Importar agenda'}
                </span>
                <span className="text-[11px] text-outline leading-snug">
                  {onOpenPhotoImport ? 'Envía una foto, Nova la parsea.' : 'Desde un ICS o suscripción.'}
                </span>
              </button>
            </div>

            {onOpenImport && onOpenPhotoImport && (
              <button
                onClick={onOpenImport}
                className="w-full text-[12px] font-semibold text-primary hover:bg-primary/5 rounded-full py-2 transition-colors"
              >
                O importa desde un archivo .ics →
              </button>
            )}
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
            onSave={(d) => { handleSave(d); setQuickAddInitial('') }}
            onCancel={() => { setShowAdd(false); setQuickAddInitial('') }}
            initialText={quickAddInitial}
            existingEvents={events}
          />
        )}
      </main>
    </div>
  )
}

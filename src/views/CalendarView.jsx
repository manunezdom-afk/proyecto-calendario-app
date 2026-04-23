import { useState, useEffect, useMemo } from 'react'
import DayTimeGrid from '../components/DayTimeGrid'
import QuickAddSheet from '../components/QuickAddSheet'
import MonthCalendar from '../components/MonthCalendar'
import WeekTimeGrid from '../components/WeekTimeGrid'
import { resolveEventDate } from '../utils/resolveEventDate'
import { eventStatusAtNow } from '../utils/eventDuration'
import { isReminderItem } from '../utils/reminders'

// Descripción útil: no mostramos cuando es solo una fecha ISO (YYYY-MM-DD) —
// data vieja generada por QuickAddSheet cuando stuffing date en description.
function hasMeaningfulNote(desc) {
  if (!desc) return false
  return !/^\d{4}-\d{2}-\d{2}$/.test(String(desc).trim())
}

const DAY_ABBR_ES    = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

// Build the current week (Mon → Sun) from today — incluye ISO date para filtrar eventos
function getCurrentWeek() {
  const today = new Date()
  const dow    = today.getDay() // 0=Sun
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return {
      day: DAY_ABBR_ES[d.getDay()].toUpperCase(),
      num: d.getDate(),
      iso,
      isToday: d.toDateString() === today.toDateString(),
    }
  })
}

// ─── Categoría de evento → color de dot ──────────────────────────────────────
const CATEGORY_DOT_COLOR = {
  foco:     'bg-emerald-500',
  reunion:  'bg-blue-500',
  personal: 'bg-purple-500',
}
function categorizeEvent(ev) {
  const title = (ev?.title ?? '').toLowerCase()
  if (/reuni[oó]n|meeting|llamada|call|junta|sync|1:1|standup|sincro/.test(title)) return 'reunion'
  if (/foco|focus|deep|profund|trabajo/.test(title) || ev?.section === 'focus') return 'foco'
  return 'personal'
}

const CALENDAR_DAYS     = getCurrentWeek()
const todayNum          = new Date().getDate()
const todayEntry        = CALENDAR_DAYS.find((d) => d.isToday)
const todayISOStr       = todayEntry?.iso ?? CALENDAR_DAYS[0].iso
// Mes en mayúscula inicial cuando va como título independiente (ej. "Abril 2026")
const currentMonthNameLc = MONTH_NAMES_ES[new Date().getMonth()]
const currentMonthLabel  = `${currentMonthNameLc.charAt(0).toUpperCase()}${currentMonthNameLc.slice(1)} ${new Date().getFullYear()}`

// ─── Small delete button ──────────────────────────────────────────────────────
function DeleteButton({ onClick }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title="Eliminar evento"
      style={{ touchAction: 'manipulation' }}
      className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full text-outline hover:bg-error/10 hover:text-error transition-all active:scale-90"
    >
      <span className="material-symbols-outlined text-[18px]">delete</span>
    </button>
  )
}

// Pill reutilizable para marcar estado temporal en las cards del día.
function StatusPill({ status }) {
  if (status === 'past') {
    return (
      <span className="text-[10px] font-bold uppercase tracking-wide text-outline bg-outline-variant/40 px-2 py-0.5 rounded-full">
        Finalizado
      </span>
    )
  }
  if (status === 'active') {
    return (
      <span className="text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/15 px-2 py-0.5 rounded-full">
        En curso
      </span>
    )
  }
  return null
}

// ─── Featured card (large, first in "Enfoque de Hoy") ────────────────────────
function FeaturedEventCard({ event, status, onDelete, onOpen }) {
  const isPast = status === 'past'
  return (
    <div
      className={`col-span-2 p-6 rounded-xl shadow-[0_12px_32px_rgba(27,27,29,0.04)] space-y-4 cursor-pointer hover:shadow-md transition-shadow ${
        isPast ? 'bg-surface-container-low opacity-70' : 'bg-surface-container-lowest'
      }`}
      onClick={() => onOpen?.(event)}
    >
      <div className="flex justify-between items-start">
        <div className={`p-2 rounded-lg ${isPast ? 'bg-outline-variant/30 text-outline' : 'bg-primary-fixed-dim/30 text-primary'}`}>
          <span className="material-symbols-outlined">{event.icon || 'event'}</span>
        </div>
        <div className="flex items-center gap-2">
          {isPast ? (
            <StatusPill status="past" />
          ) : status === 'active' ? (
            <StatusPill status="active" />
          ) : (
            <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1 rounded-full">
              A Continuación
            </span>
          )}
          <DeleteButton onClick={() => onDelete(event.id)} />
        </div>
      </div>
      <div>
        <h3 className={`text-lg font-bold ${isPast ? 'text-outline line-through decoration-outline/40' : 'text-on-surface'}`}>
          {event.title}
        </h3>
        {hasMeaningfulNote(event.description) && (
          <div style={{ marginTop: '6px', padding: '5px 10px', background: '#f1f5f9', borderRadius: '6px', borderLeft: '2px solid #cbd5e1' }}>
            <p style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>{event.description}</p>
          </div>
        )}
      </div>
      {event.time && (
        <div className="flex items-center gap-4 pt-2">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px] text-outline">schedule</span>
            <span className={`text-xs font-semibold ${isPast ? 'text-outline' : 'text-on-surface'}`}>{event.time}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Small card (secondary items in "Enfoque de Hoy") ────────────────────────
function SmallEventCard({ event, status, onDelete, onOpen }) {
  const isPast = status === 'past'
  return (
    <div
      className={`p-5 rounded-xl space-y-2 relative group cursor-pointer transition-colors ${
        isPast
          ? 'bg-surface-container-low/60 hover:bg-surface-container-low opacity-70'
          : 'bg-surface-container-low hover:bg-surface-container'
      }`}
      onClick={() => onOpen?.(event)}
    >
      <div className="flex justify-between items-start gap-2">
        <span className={`material-symbols-outlined ${isPast ? 'text-outline' : 'text-secondary'}`}>
          {event.icon || 'event'}
        </span>
        <div className="flex items-center gap-1">
          <StatusPill status={status} />
          <DeleteButton onClick={() => onDelete(event.id)} />
        </div>
      </div>
      <h3 className={`text-sm font-bold ${isPast ? 'text-outline line-through decoration-outline/40' : 'text-on-surface'}`}>
        {event.title}
      </h3>
      {event.time && (
        <p className="text-[11px] text-outline font-medium">{event.time}</p>
      )}
      {event.description && (
        <div style={{ marginTop: '4px', padding: '4px 8px', background: '#f1f5f9', borderRadius: '5px', borderLeft: '2px solid #cbd5e1' }}>
          <p style={{ fontSize: '10px', color: '#64748b', lineHeight: '1.4' }}>{event.description}</p>
        </div>
      )}
    </div>
  )
}

// ─── Evening row card ─────────────────────────────────────────────────────────
function EveningEventCard({ event, status, onDelete, onOpen }) {
  const isPast = status === 'past'
  return (
    <div className="flex gap-4 items-center group cursor-pointer" onClick={() => onOpen?.(event)}>
      {event.time && (
        <div className="w-16 text-right flex-shrink-0">
          <span className={`text-xs font-bold ${isPast ? 'text-outline/60' : 'text-outline'}`}>
            {event.time}
          </span>
        </div>
      )}
      <div className={`flex-1 transition-colors p-4 rounded-xl flex justify-between items-start gap-2 ${
        isPast
          ? 'bg-surface-container-low/60 hover:bg-surface-container-low opacity-70'
          : 'bg-surface-container-lowest hover:bg-surface-container-high'
      }`}>
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${isPast ? 'bg-outline-variant' : (event.dotColor || 'bg-outline')}`} />
          <div className="flex-1 min-w-0">
            <span className={`font-bold text-sm ${isPast ? 'text-outline line-through decoration-outline/40' : 'text-on-surface'}`}>
              {event.title}
            </span>
            {hasMeaningfulNote(event.description) && (
              <div style={{ marginTop: '4px', padding: '4px 8px', background: '#f1f5f9', borderRadius: '5px', borderLeft: '2px solid #cbd5e1' }}>
                <p style={{ fontSize: '10px', color: '#64748b', lineHeight: '1.4' }}>{event.description}</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <StatusPill status={status} />
          <DeleteButton onClick={() => onDelete(event.id)} />
        </div>
      </div>
    </div>
  )
}

// Devuelve el lunes (00:00) de la semana que contiene `date`.
function getMondayOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + diff)
  return d
}

function formatWeekRange(weekStart) {
  const end = new Date(weekStart)
  end.setDate(weekStart.getDate() + 6)
  const sameMonth = weekStart.getMonth() === end.getMonth()
  const sameYear  = weekStart.getFullYear() === end.getFullYear()
  const sMonth = MONTH_NAMES_ES[weekStart.getMonth()]
  const eMonth = MONTH_NAMES_ES[end.getMonth()]
  const sYear  = weekStart.getFullYear()
  const eYear  = end.getFullYear()
  if (sameMonth && sameYear) {
    return `${weekStart.getDate()} – ${end.getDate()} ${sMonth} ${sYear}`
  }
  if (sameYear) {
    return `${weekStart.getDate()} ${sMonth} – ${end.getDate()} ${eMonth} ${sYear}`
  }
  return `${weekStart.getDate()} ${sMonth} ${sYear} – ${end.getDate()} ${eMonth} ${eYear}`
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function CalendarView({ events, tasks = [], onAddEvent, onDeleteEvent, onOpenTask, onExportClick, onOpenDay, isDesktop = false }) {
  const [showModal, setShowModal] = useState(false)
  const [activeDay, setActiveDay] = useState(todayNum)    // selected day number
  const [calView, setCalView] = useState('dia')           // 'dia' | 'semana' | 'mes'
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()))
  // Fecha preseleccionada cuando el usuario abre "Añadir" tocando una celda
  // de la vista semanal — hace que el evento caiga en el día correcto aunque
  // el texto tipeado no incluya fecha explícita.
  const [pendingDate, setPendingDate] = useState(null)

  // Tick para re-renderizar cada minuto y actualizar el estado temporal de
  // los eventos (past/active/future). Los badges "Finalizado" dependen de
  // esto. No leemos el tick — el setter alcanza para forzar el re-render.
  const [, setNowTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const effectiveEvents = events ?? []

  // ISO del día seleccionado en la vista semana
  const activeDayISO = CALENDAR_DAYS.find((d) => d.num === activeDay)?.iso ?? todayISOStr
  const isToday = activeDayISO === todayISOStr

  // Filtramos eventos por día seleccionado (resolviendo cualquier formato de fecha)
  const dayEventsRaw = effectiveEvents.filter((e) => resolveEventDate(e) === activeDayISO)
  // En "hoy", ocultamos recordatorios cuya hora ya pasó — son avisos que
  // cumplieron su función y sólo ensucian la vista. Los eventos normales
  // pasados se mantienen (sirven para repasar el día). En otros días no
  // filtramos: se muestra exactamente lo guardado.
  const nowForFilter = new Date()
  const dayEvents = isToday
    ? dayEventsRaw.filter((e) => !(isReminderItem(e) && eventStatusAtNow(e, nowForFilter) === 'past'))
    : dayEventsRaw
  const focusEvents   = dayEvents.filter((e) => e.section === 'focus')
  const eveningEvents = dayEvents.filter((e) => e.section === 'evening')

  // Tareas "agendadas" en el día — sólo aplican cuando activeDay es hoy, ya
  // que el modelo de tareas no tiene fecha propia (usa categoría "hoy").
  const dayTasks = useMemo(() => {
    if (activeDayISO !== todayISOStr) return []
    return (tasks || []).filter((t) => t && t.category === 'hoy')
  }, [tasks, activeDayISO])

  // Clasificación temporal combinada — un evento es past/active/future según
  // su fecha + hora relativa a "ahora". Un item sin fecha es 'undated'.
  // Se recalcula en cada render; el tick por minuto fuerza re-renders.
  const now = new Date()
  const statusOf = (ev) => eventStatusAtNow(ev, now)

  // Estado global del día seleccionado. Basa toda la UI en ESTO — antes cada
  // sección (Focus/Evening) decidía por su cuenta y terminaba mostrando
  // "Día libre" en Focus aunque Evening tuviese eventos, que fue el bug.
  const hasAnyItem = dayEvents.length > 0 || dayTasks.length > 0
  const pendingTaskCount = dayTasks.filter((t) => !t.done).length
  const allEventsPast = dayEvents.length > 0 && dayEvents.every((ev) => statusOf(ev) === 'past')
  const isDayEmpty = !hasAnyItem
  const isDayAllPast = hasAnyItem && pendingTaskCount === 0 && allEventsPast

  const handleDeleteEvent = (id) => {
    onDeleteEvent?.(id)
  }

  // First focus event becomes the featured card (if any)
  const [featuredEvent, ...smallEvents] = focusEvents

  function handleSave(formData) {
    // Guardar el evento con la fecha del día seleccionado
    onAddEvent({ ...formData, date: activeDayISO })
    setShowModal(false)
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen pb-44">

      <main className={isDesktop ? "max-w-6xl xl:max-w-7xl mx-auto px-6 pt-4 space-y-6" : "max-w-md mx-auto px-4 pt-4 space-y-8"}>

        {/* ── Header & View Switcher (always visible) ─────────────────── */}
        {/* En mobile el título va arriba y los controles van en una segunda
            fila — así el toggle "Mes/Semana" y el botón de exportar nunca
            quedan al límite en 360–391 px. En desktop, layout horizontal. */}
        <header>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end sm:gap-2">
            <div>
              <p className="text-sm font-semibold text-primary mb-1">
                {currentMonthLabel}
              </p>
              <h1 className="text-4xl font-extrabold text-on-surface">
                Calendario
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {/* Export button */}
              {onExportClick && (
                <button
                  onClick={onExportClick}
                  aria-label="Exportar calendario"
                  title="Exportar calendario"
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-surface-container-low text-outline hover:text-primary hover:bg-primary/10 transition-colors active:scale-90"
                >
                  <span className="material-symbols-outlined text-[20px]">ios_share</span>
                </button>
              )}
              {/* View switcher */}
              <div className="bg-surface-container-low p-1 rounded-xl flex">
                {['dia', 'semana', 'mes'].map((v) => (
                  <button
                    key={v}
                    onClick={() => setCalView(v)}
                    className={`px-3 sm:px-4 py-2 text-xs font-bold rounded-lg transition-all min-h-[36px] ${
                      calView === v
                        ? 'bg-surface-container-lowest shadow-sm text-on-surface'
                        : 'text-outline'
                    }`}
                  >
                    {v === 'dia' ? 'Día' : v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* ── VISTA MES ────────────────────────────────────────────────── */}
        {calView === 'mes' && (
          <MonthCalendar
            events={effectiveEvents}
            onAddEvent={onAddEvent}
            onDeleteEvent={handleDeleteEvent}
          />
        )}

        {/* ── VISTA SEMANA (grid real: columnas = días, filas = horas) ── */}
        {calView === 'semana' && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d)
                  }}
                  aria-label="Semana anterior"
                  className="w-10 h-10 flex items-center justify-center rounded-full text-outline hover:bg-surface-container-low active:scale-90 transition-all"
                >
                  <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                </button>
                <button
                  onClick={() => setWeekStart(getMondayOf(new Date()))}
                  className="px-3 h-10 text-xs font-bold text-primary hover:bg-primary/10 rounded-full transition-colors"
                >
                  Hoy
                </button>
                <button
                  onClick={() => {
                    const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d)
                  }}
                  aria-label="Semana siguiente"
                  className="w-10 h-10 flex items-center justify-center rounded-full text-outline hover:bg-surface-container-low active:scale-90 transition-all"
                >
                  <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                </button>
              </div>
              <p className="text-xs sm:text-sm font-semibold text-outline truncate">
                {formatWeekRange(weekStart)}
              </p>
            </div>

            <WeekTimeGrid
              weekStart={weekStart}
              events={effectiveEvents}
              onOpenTask={onOpenTask}
              onAddAt={(iso) => {
                setPendingDate(iso)
                setShowModal(true)
              }}
            />

            {showModal && (
              <QuickAddSheet
                onSave={(formData) => {
                  // Si el usuario tocó una celda concreta, esa fecha manda.
                  onAddEvent({ ...formData, date: pendingDate ?? formData.date })
                  setShowModal(false)
                  setPendingDate(null)
                }}
                onCancel={() => { setShowModal(false); setPendingDate(null) }}
                existingEvents={events}
              />
            )}
          </section>
        )}

        {/* ── VISTA DÍA ────────────────────────────────────────────────── */}
        {calView === 'dia' && (
          <>
            {/* Week strip */}
            <div className="grid grid-cols-7 gap-2">
              {CALENDAR_DAYS.map(({ day, num, iso, isToday }) => {
                const isActive  = num === activeDay
                const dayEvts   = effectiveEvents.filter((e) => resolveEventDate(e) === iso)
                const hasEvts   = dayEvts.length > 0
                const highLoad  = dayEvts.length >= 3
                const categorized = dayEvts.map(categorizeEvent)
                const counts = { foco: 0, reunion: 0, personal: 0 }
                categorized.forEach((c) => { counts[c] = (counts[c] || 0) + 1 })
                const tooltip = hasEvts
                  ? `${dayEvts.length} evento${dayEvts.length !== 1 ? 's' : ''}${counts.foco ? ` · foco ${counts.foco}` : ''}${counts.reunion ? ` · reunión ${counts.reunion}` : ''}${counts.personal ? ` · personal ${counts.personal}` : ''}`
                  : undefined
                return (
                  <button
                    key={day}
                    onClick={() => { setActiveDay(num); console.log(`[Focus] 📅 Day selected: ${day} ${num}`) }}
                    title={tooltip}
                    className="flex flex-col items-center gap-2 focus:outline-none"
                  >
                    <span className={`text-[10px] font-bold ${isActive ? 'text-primary' : isToday && !isActive ? 'text-primary/80' : 'text-outline'}`}>
                      {day}
                    </span>
                    {isActive ? (
                      <div className="relative w-10 h-14 flex flex-col items-center justify-center rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/25 ring-2 ring-primary/30 ring-offset-2 ring-offset-surface">
                        <span>{num}</span>
                        {hasEvts && (
                          <div className="flex gap-[3px] mt-1">
                            {dayEvts.slice(0, 3).map((_, i) => (
                              <div key={i} className="w-1 h-1 bg-white/80 rounded-full" />
                            ))}
                            {dayEvts.length > 3 && (
                              <span className="text-[8px] font-bold text-white/80 leading-none ml-0.5">+{dayEvts.length - 3}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={`w-10 h-14 flex flex-col items-center justify-center rounded-2xl font-semibold transition-colors ${
                        isToday
                          ? 'bg-primary/10 text-primary border border-primary/40 hover:bg-primary/15'
                          : highLoad
                            ? 'bg-primary/15 text-primary hover:bg-primary/20'
                            : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
                      }`}>
                        <span>{num}</span>
                        {hasEvts && (
                          <div className="flex items-center gap-[3px] mt-1">
                            {categorized.slice(0, 3).map((cat, i) => (
                              <div key={i} className={`w-1.5 h-1.5 rounded-full ${CATEGORY_DOT_COLOR[cat]}`} />
                            ))}
                            {dayEvts.length > 3 && (
                              <span className="text-[8px] font-bold text-outline leading-none">+{dayEvts.length - 3}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {isDesktop ? (
              <DayTimeGrid
                events={dayEvents}
                referenceDate={now}
                onAdd={() => setShowModal(true)}
                onOpenTask={onOpenTask}
              />
            ) : (<>
            {/* Empty / all-past state del día — calculado sobre TODO el día,
                no sólo sobre Focus. Antes mostrábamos "Día libre" aunque
                hubiese eventos en Evening o tareas pendientes: bug. */}
            {isDayEmpty && (
              /* Empty state útil: título con personalidad + 3 CTAs. Antes era
                 un solo botón "Añadir primer evento" con icono genérico — se
                 sentía como un formulario vacío. Ahora el usuario ve opciones
                 reales para activar el día sin pensar. */
              <div className="bg-surface-container-lowest rounded-2xl p-6 flex flex-col items-center gap-4 text-center border border-outline-variant/30">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                  <span
                    className="material-symbols-outlined text-primary text-[26px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    {activeDayISO === todayISOStr ? 'wb_sunny' : 'event_available'}
                  </span>
                </div>
                <div>
                  <p className="text-base font-bold text-on-surface">
                    {activeDayISO === todayISOStr ? 'Día libre. Todo tuyo.' : 'Sin eventos en este día.'}
                  </p>
                  <p className="text-[12.5px] text-outline mt-1 max-w-[280px] mx-auto">
                    {activeDayISO === todayISOStr
                      ? 'Bloquea tu atención, agenda algo o trae tu agenda externa.'
                      : 'Agrega un evento o pide a Nova que planifique este día.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center">
                  <button
                    onClick={() => setShowModal(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-white text-xs font-bold active:scale-95 transition-all shadow-sm shadow-primary/20"
                  >
                    <span className="material-symbols-outlined text-[15px]">add</span>
                    Añadir evento
                  </button>
                  <button
                    onClick={() => setShowModal(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary/10 text-primary text-xs font-bold active:scale-95 transition-colors hover:bg-primary/15"
                  >
                    <span className="material-symbols-outlined text-[15px]">psychology</span>
                    Bloquear foco
                  </button>
                  {onExportClick && (
                    <button
                      onClick={onExportClick}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-surface-container text-on-surface-variant text-xs font-semibold active:scale-95 transition-colors hover:bg-surface-container-high"
                    >
                      <span className="material-symbols-outlined text-[15px]">upload_file</span>
                      Importar agenda
                    </button>
                  )}
                </div>
              </div>
            )}

            {isDayAllPast && (
              <div className="bg-surface-container-low rounded-xl px-4 py-3 flex items-center gap-3">
                <span
                  className="material-symbols-outlined text-outline text-[20px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-on-surface leading-tight">
                    {activeDayISO === todayISOStr ? 'No quedan eventos por hoy' : 'Todo lo de este día ya terminó'}
                  </p>
                  <p className="text-[11px] text-outline mt-0.5">
                    Los eventos finalizados siguen abajo.
                  </p>
                </div>
              </div>
            )}

            {/* Enfoque del día seleccionado — sólo renderiza si el día tiene
                eventos totales. Si Focus está vacío pero Evening tiene,
                escondemos esta sección para no reintroducir el "Día libre"
                engañoso. */}
            {!isDayEmpty && focusEvents.length > 0 && (
            <section className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-on-surface">
                  {(() => {
                    const DAY_FULL = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
                    const activeDate = new Date(activeDayISO + 'T00:00:00')
                    const dayName = DAY_FULL[activeDate.getDay()]
                    const monthName = MONTH_NAMES_ES[activeDate.getMonth()]
                    const isToday = activeDayISO === todayISOStr
                    return isToday
                      ? `Hoy · ${dayName} ${activeDay}`
                      : `${dayName} ${activeDay} de ${monthName.toLowerCase()}`
                  })()}
                </h2>
                <div className="flex items-center gap-1">
                  {onOpenDay && (
                    <button
                      onClick={() => onOpenDay(activeDayISO)}
                      aria-label="Ver día completo"
                      title="Ver día completo"
                      className="flex items-center gap-1 text-xs font-bold text-outline hover:bg-surface-container-low px-3 py-1.5 rounded-full transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">open_in_full</span>
                      Ver día
                    </button>
                  )}
                  <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-1 text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Añadir
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {featuredEvent && (
                  <FeaturedEventCard
                    event={featuredEvent}
                    status={statusOf(featuredEvent)}
                    onDelete={handleDeleteEvent}
                    onOpen={onOpenTask}
                  />
                )}
                {smallEvents.map((ev) => (
                  <SmallEventCard
                    key={ev.id}
                    event={ev}
                    status={statusOf(ev)}
                    onDelete={handleDeleteEvent}
                    onOpen={onOpenTask}
                  />
                ))}
              </div>
            </section>
            )}

            {/* Tarde/Noche — se mantiene visible siempre que el día tenga
                algún item; así los eventos finalizados no desaparecen. */}
            {!isDayEmpty && (
            <section className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-on-surface">Tarde/Noche</h2>
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-1 text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Añadir
                </button>
              </div>

              {eveningEvents.length === 0 ? (
                <p className="text-sm text-outline/70 italic px-1">Nada en la tarde/noche.</p>
              ) : (
                <div className="space-y-2">
                  {eveningEvents.map((ev) => (
                    <EveningEventCard
                      key={ev.id}
                      event={ev}
                      status={statusOf(ev)}
                      onDelete={handleDeleteEvent}
                      onOpen={onOpenTask}
                    />
                  ))}
                </div>
              )}
            </section>
            )}

            {/* Tareas "hoy" — sólo cuando se mira el día actual y hay tareas. */}
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
            </>)}

            {/* FAB — oculto en desktop y en empty state mobile.
                En mobile vive APILADO ENCIMA de la pastilla de Nova (que está
                en safe-bottom + 116px y ~44px de alto). Así nunca se tapan
                entre sí: pill abajo, FAB justo arriba, mismo borde derecho. */}
            {!isDesktop && !isDayEmpty && (
            <div
              className="fixed right-4 z-[60]"
              style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 172px)' }}
            >
              <button
                onClick={() => setShowModal(true)}
                aria-label="Añadir evento"
                className="w-14 h-14 rounded-2xl bg-primary text-white shadow-2xl flex items-center justify-center active:scale-90 transition-transform duration-300"
                title="Añadir evento"
              >
                <span className="material-symbols-outlined text-3xl">add</span>
              </button>
            </div>
            )}

            {/* Quick Add Sheet (semana) */}
            {showModal && (
              <QuickAddSheet
                onSave={handleSave}
                onCancel={() => setShowModal(false)}
                existingEvents={events}
              />
            )}
          </>
        )}

      </main>
    </div>
  )
}

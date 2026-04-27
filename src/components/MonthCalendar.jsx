import { useState, lazy, Suspense } from 'react'
import { resolveEventDate } from '../utils/resolveEventDate'
import EmptyState from './EmptyState'
const QuickAddSheet = lazy(() => import('./QuickAddSheet'))

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const DAY_HEADERS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function toISO(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function buildGrid(year, month) {
  const firstDow = new Date(year, month, 1).getDay() // 0=Sun
  const offset = (firstDow + 6) % 7               // Mon-start: Mon=0 … Sun=6
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function formatLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  const names = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  return `${names[dow]} ${d} de ${MONTH_NAMES[m - 1]}`
}

export default function MonthCalendar({ events, onAddEvent, onDeleteEvent }) {
  const today = new Date()
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate())

  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState(todayISO)
  const [showSheet, setShowSheet] = useState(false)

  const grid = buildGrid(viewYear, viewMonth)

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1) }
    else setViewMonth((m) => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1) }
    else setViewMonth((m) => m + 1)
  }

  // Events for a given ISO date — resuelve "Hoy", "Mañana", null, etc.
  function eventsForDate(iso) {
    return events.filter((e) => resolveEventDate(e) === iso)
  }

  const selectedEvents = selectedDate ? eventsForDate(selectedDate) : []

  function handleDayClick(day) {
    setSelectedDate(toISO(viewYear, viewMonth, day))
  }

  function handleSave(formData) {
    onAddEvent({ ...formData, date: selectedDate })
    setShowSheet(false)
  }

  return (
    <div className="space-y-5">
      {/* ── Month nav ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        <button
          onClick={prevMonth}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-container-low transition-colors"
        >
          <span className="material-symbols-outlined text-outline">chevron_left</span>
        </button>

        <div className="text-center">
          <p className="font-headline font-extrabold text-on-surface text-lg leading-none">
            {MONTH_NAMES[viewMonth]}
          </p>
          <p className="text-xs text-outline font-semibold mt-0.5">{viewYear}</p>
        </div>

        <button
          onClick={nextMonth}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-container-low transition-colors"
        >
          <span className="material-symbols-outlined text-outline">chevron_right</span>
        </button>
      </div>

      {/* ── Day-of-week headers ────────────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-1">
        {DAY_HEADERS.map((h) => (
          <div key={h} className="text-center text-[10px] font-bold text-outline py-1">
            {h}
          </div>
        ))}
      </div>

      {/* ── Day grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {grid.map((day, idx) => {
          if (!day) return <div key={`e-${idx}`} />
          const iso = toISO(viewYear, viewMonth, day)
          const isToday    = iso === todayISO
          const isSelected = iso === selectedDate
          const isPast     = iso < todayISO
          const dayEvts    = eventsForDate(iso)
          const count      = dayEvts.length
          const visibleEvts = dayEvts.slice(0, 4)
          const overflow    = count - visibleEvts.length

          return (
            <button
              key={iso}
              onClick={() => handleDayClick(day)}
              aria-label={`${day}${isToday ? ' (hoy)' : ''}${count > 0 ? `, ${count} evento${count === 1 ? '' : 's'}` : ''}`}
              aria-pressed={isSelected}
              className={`relative flex flex-col items-stretch gap-1 min-h-[96px] sm:min-h-[120px] p-1 sm:p-1.5 rounded-xl sm:rounded-2xl transition-all active:scale-[0.97] text-left ${
                isSelected
                  ? 'ring-2 ring-primary bg-primary/5 shadow-sm'
                  : 'hover:bg-surface-container-low'
              }`}
            >
              <div className="flex justify-center">
                <span
                  className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-xs sm:text-sm font-bold transition-colors ${
                    isToday
                      ? 'bg-primary text-white shadow-sm shadow-primary/30'
                      : isPast
                      ? 'text-outline'
                      : 'text-on-surface'
                  }`}
                >
                  {day}
                </span>
              </div>

              {count > 0 && (
                <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                  {visibleEvts.map((ev, i) => {
                    const evening = ev.section === 'evening'
                    return (
                      <div
                        key={ev.id ?? i}
                        className={`rounded-md px-1 sm:px-1.5 py-0.5 min-w-0 ${
                          evening ? 'bg-secondary/15' : 'bg-primary/12'
                        } ${isPast ? 'opacity-55' : ''}`}
                      >
                        <p
                          className={`text-[10px] sm:text-[11px] font-bold leading-[1.15] line-clamp-2 ${
                            evening ? 'text-secondary' : 'text-primary'
                          }`}
                        >
                          {ev.title}
                        </p>
                        <p
                          className={`text-[9px] sm:text-[10px] font-semibold leading-[1.15] truncate mt-[1px] ${
                            evening ? 'text-secondary/75' : 'text-primary/75'
                          }`}
                        >
                          {ev.time || 'Todo el día'}
                        </p>
                      </div>
                    )
                  })}
                  {overflow > 0 && (
                    <p className="text-[9px] sm:text-[10px] font-bold text-outline px-1 leading-tight">
                      +{overflow} más
                    </p>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Selected day panel ────────────────────────────────────────── */}
      {selectedDate && (
        <div className="bg-surface-container-lowest rounded-[24px] p-5 space-y-4 border border-outline-variant/20">
          <div className="flex justify-between items-center">
            <h3 className="font-headline font-bold text-on-surface text-base first-letter:uppercase">
              {formatLabel(selectedDate)}
            </h3>
            <button
              onClick={() => setShowSheet(true)}
              className="flex items-center gap-1 text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Añadir
            </button>
          </div>

          {selectedEvents.length === 0 ? (
            <EmptyState
              illustration="calendar-empty"
              title="Sin eventos en este día"
              body="Toca Añadir para agendar algo, o déjalo libre."
              tone="muted"
              compact
            />
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((ev) => (
                <div key={ev.id} className="flex items-center gap-3 p-3 bg-surface-container-low rounded-xl">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span
                      className="material-symbols-outlined text-primary text-[18px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      {ev.icon || 'event'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-on-surface text-sm truncate">{ev.title}</p>
                    {ev.time && <p className="text-xs text-outline mt-0.5">{ev.time}</p>}
                    {ev.description && !ev.time && (
                      <p className="text-xs text-outline mt-0.5">{ev.description}</p>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteEvent(ev.id) }}
                    className="w-11 h-11 flex items-center justify-center rounded-full text-outline hover:bg-error/10 hover:text-error transition-all active:scale-90 flex-shrink-0"
                    style={{ touchAction: 'manipulation' }}
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick add sheet with target date label */}
      {showSheet && (
        <Suspense fallback={null}>
          <QuickAddSheet
            targetDate={selectedDate}
            targetDateLabel={formatLabel(selectedDate)}
            onSave={handleSave}
            onCancel={() => setShowSheet(false)}
            existingEvents={events}
          />
        </Suspense>
      )}
    </div>
  )
}

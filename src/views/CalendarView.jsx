import { useState } from 'react'
import DayTimeGrid from '../components/DayTimeGrid'
import QuickAddSheet from '../components/QuickAddSheet'
import MonthCalendar from '../components/MonthCalendar'
import { resolveEventDate } from '../utils/resolveEventDate'
import { useUserProfile } from '../hooks/useUserProfile'
import { peakRangeLabel } from '../utils/peakZone'

const AVATAR_1 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDfqPz-Xtp1DOlxyZ6qdBoqCnCTvLoTN7uCnDpKv7pQispXp8jMGm8VmAnGlq6fGljfeaM_FGgWpLdB3Ig6ImleJTb6h-TmrJg7wLQJBUNd1LSQiUrTmFaLHcku_b2IBR1b9-gtC7bCqoZTvugBoGNiE9EjBbxP2zP0nkLkJF5KXZxYSvNqigG3jSpyBQawu9fkiHNp1vQfAtrXoJyYILEZm_q5bSNPNATYmsirJUZFcSzFA1bGsAuK0G16fJNQgGEjyI-ErT5OZNRs'
const AVATAR_2 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuAGg2kzu3h6K4U-DHUHwAcgSd0y0SQIx6Duljc3apyQXiGDGaDJCJvmLXpH77eOXyP37Jc5UNLSd9hKH2_0BJqXhvtFuctuO1RWkTcExCM32YxUKV29rG8VZAro5LQQwBA75PSIOuScBv5k-ndaqFgJQNTRZRbvVa2ZXHve9TGmRIQetPC53lRJACf2mkMMFoX7yAwVHQpsMXQh-0XpdV1WYDlQF6dKony_nEBC2Jfhnzj8ftnPxl5-e5v_Kgn6dm-qDn9tw02nNGYd'

const DAY_ABBR_ES    = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTH_NAMES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

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
const currentMonthLabel = `${MONTH_NAMES_ES[new Date().getMonth()]} ${new Date().getFullYear()}`

// ─── Small delete button ──────────────────────────────────────────────────────
function DeleteButton({ onClick }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation() // don't bubble to card's onClick
        onClick()
      }}
      title="Eliminar evento"
      className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-outline hover:bg-error/10 hover:text-error transition-all active:scale-90"
    >
      <span className="material-symbols-outlined text-[17px]">delete</span>
    </button>
  )
}

// ─── Featured card (large, first in "Enfoque de Hoy") ────────────────────────
function FeaturedEventCard({ event, onDelete, onOpen }) {
  return (
    <div
      className="col-span-2 bg-surface-container-lowest p-6 rounded-xl shadow-[0_12px_32px_rgba(27,27,29,0.04)] space-y-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={onOpen}
    >
      <div className="flex justify-between items-start">
        <div className="p-2 bg-primary-fixed-dim/30 rounded-lg text-primary">
          <span className="material-symbols-outlined">{event.icon || 'auto_awesome'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1 rounded-full">
            A Continuación
          </span>
          <DeleteButton onClick={() => onDelete(event.id)} />
        </div>
      </div>
      <div>
        <h3 className="text-lg font-bold text-on-surface">{event.title}</h3>
        {event.description && (
          <div style={{ marginTop: '6px', padding: '5px 10px', background: '#f1f5f9', borderRadius: '6px', borderLeft: '2px solid #cbd5e1' }}>
            <p style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>{event.description}</p>
          </div>
        )}
      </div>
      {event.time && (
        <div className="flex items-center gap-4 pt-2">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px] text-outline">schedule</span>
            <span className="text-xs font-semibold text-on-surface">{event.time}</span>
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
      )}
    </div>
  )
}

// ─── Small card (secondary items in "Enfoque de Hoy") ────────────────────────
function SmallEventCard({ event, onDelete }) {
  return (
    <div className="bg-surface-container-low p-5 rounded-xl space-y-2 relative group">
      <div className="flex justify-between items-start">
        <span className="material-symbols-outlined text-secondary">
          {event.icon || 'event'}
        </span>
        <DeleteButton onClick={() => onDelete(event.id)} />
      </div>
      <h3 className="text-sm font-bold text-on-surface">{event.title}</h3>
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
function EveningEventCard({ event, onDelete }) {
  return (
    <div className="flex gap-4 items-center group">
      {event.time && (
        <div className="w-16 text-right flex-shrink-0">
          <span className="text-xs font-bold text-outline">{event.time}</span>
        </div>
      )}
      <div className="flex-1 bg-surface-container-lowest hover:bg-surface-container-high transition-colors p-4 rounded-xl flex justify-between items-start">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${event.dotColor || 'bg-outline'}`} />
          <div className="flex-1 min-w-0">
            <span className="font-bold text-sm text-on-surface">{event.title}</span>
            {event.description && (
              <div style={{ marginTop: '4px', padding: '4px 8px', background: '#f1f5f9', borderRadius: '5px', borderLeft: '2px solid #cbd5e1' }}>
                <p style={{ fontSize: '10px', color: '#64748b', lineHeight: '1.4' }}>{event.description}</p>
              </div>
            )}
          </div>
        </div>
        <DeleteButton onClick={() => onDelete(event.id)} />
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function CalendarView({ events, onAddEvent, onDeleteEvent, onOpenTask, onExportClick, isDesktop = false }) {
  const { profile } = useUserProfile()
  const [showModal, setShowModal] = useState(false)
  const [activeDay, setActiveDay] = useState(todayNum)    // selected day number
  const [calView, setCalView] = useState('semana')         // 'mes' | 'semana'

  // ISO del día seleccionado en la vista semana
  const activeDayISO = CALENDAR_DAYS.find((d) => d.num === activeDay)?.iso ?? todayISOStr

  // Filtramos eventos por día seleccionado (resolviendo cualquier formato de fecha)
  const dayEvents = events.filter((e) => resolveEventDate(e) === activeDayISO)
  const focusEvents   = dayEvents.filter((e) => e.section === 'focus')
  const eveningEvents = dayEvents.filter((e) => e.section === 'evening')

  // First focus event becomes the featured card (if any)
  const [featuredEvent, ...smallEvents] = focusEvents

  function handleSave(formData) {
    // Guardar el evento con la fecha del día seleccionado
    onAddEvent({ ...formData, date: activeDayISO })
    setShowModal(false)
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen pb-32">

      <main className={isDesktop ? "max-w-4xl mx-auto px-6 pt-4 space-y-6" : "max-w-md mx-auto px-6 pt-4 space-y-8"}>

        {/* ── Header & View Switcher (always visible) ─────────────────── */}
        <header>
          <div className="flex justify-between items-end">
            <div>
              <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-1">
                {currentMonthLabel}
              </p>
              <h1 className="text-4xl font-extrabold text-on-surface tracking-tight">
                Calendario
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {/* Export button */}
              {onExportClick && (
                <button
                  onClick={onExportClick}
                  title="Exportar calendario"
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-container-low text-outline hover:text-primary hover:bg-primary/10 transition-colors active:scale-90"
                >
                  <span className="material-symbols-outlined text-[20px]">ios_share</span>
                </button>
              )}
              {/* View switcher */}
              <div className="bg-surface-container-low p-1 rounded-xl flex">
                {['mes', 'semana'].map((v) => (
                  <button
                    key={v}
                    onClick={() => setCalView(v)}
                    className={`px-4 py-1.5 text-xs font-bold rounded-lg capitalize transition-all ${
                      calView === v
                        ? 'bg-surface-container-lowest shadow-sm text-on-surface'
                        : 'text-outline'
                    }`}
                  >
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* ── VISTA MES ────────────────────────────────────────────────── */}
        {calView === 'mes' && (
          <MonthCalendar
            events={events}
            onAddEvent={onAddEvent}
            onDeleteEvent={onDeleteEvent}
            profile={profile}
          />
        )}

        {/* ── VISTA SEMANA ─────────────────────────────────────────────── */}
        {calView === 'semana' && (
          <>
            {/* Week strip */}
            <div className="grid grid-cols-7 gap-2">
              {CALENDAR_DAYS.map(({ day, num, iso }) => {
                const isActive  = num === activeDay
                const dayEvts   = events.filter((e) => resolveEventDate(e) === iso)
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
                    <span className={`text-[10px] font-bold uppercase ${isActive ? 'text-primary' : 'text-outline'}`}>
                      {day}
                    </span>
                    {isActive ? (
                      <div className="w-10 h-14 flex flex-col items-center justify-center rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/20">
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
                        highLoad
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
                peakStart={profile.peakStart}
                peakEnd={profile.peakEnd}
                onAdd={() => setShowModal(true)}
                onOpenTask={onOpenTask}
              />
            ) : (<>
            {/* ── Banda zona de rendimiento ──────────────────────────── */}
            {profile.peakStart != null && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-2xl">
                <span
                  className="material-symbols-outlined text-emerald-600 text-[17px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >bolt</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-emerald-800">
                    Zona de rendimiento · {peakRangeLabel(profile.peakStart, profile.peakEnd)}
                  </p>
                  <p className="text-[10px] text-emerald-600 leading-tight">Reserva este horario para trabajo profundo</p>
                </div>
              </div>
            )}

            {/* Enfoque del día seleccionado */}
            <section className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold tracking-tight text-on-surface">
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
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-1 text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Añadir
                </button>
              </div>

              {focusEvents.length === 0 ? (
                <p className="text-sm text-outline/70 italic px-1">Día libre</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {featuredEvent && (
                    <FeaturedEventCard
                      event={featuredEvent}
                      onDelete={onDeleteEvent}
                      onOpen={onOpenTask}
                    />
                  )}
                  {smallEvents.map((ev) => (
                    <SmallEventCard key={ev.id} event={ev} onDelete={onDeleteEvent} />
                  ))}
                </div>
              )}
            </section>

            {/* Tarde/Noche */}
            <section className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold tracking-tight text-on-surface">Tarde/Noche</h2>
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-1 text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Añadir
                </button>
              </div>

              {eveningEvents.length === 0 ? (
                <div className="bg-surface-container-low rounded-xl p-8 flex flex-col items-center gap-3 text-center">
                  <span className="material-symbols-outlined text-3xl text-outline">nights_stay</span>
                  <p className="text-sm font-semibold text-outline">
                    Nada planeado para esta tarde.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {eveningEvents.map((ev) => (
                    <EveningEventCard key={ev.id} event={ev} onDelete={onDeleteEvent} />
                  ))}
                </div>
              )}
            </section>
            </>)}

            {/* FAB — oculto en desktop y en empty state mobile */}
            {!isDesktop && focusEvents.length > 0 && (
            <div className="fixed bottom-[148px] left-1/2 -translate-x-1/2 z-[60]">
              <button
                onClick={() => setShowModal(true)}
                className="w-16 h-16 rounded-full bg-gradient-to-tr from-primary to-primary-container text-white shadow-[0_16px_32px_rgba(0,88,188,0.3)] flex items-center justify-center active:scale-90 transition-transform duration-300"
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
              />
            )}
          </>
        )}

      </main>
    </div>
  )
}

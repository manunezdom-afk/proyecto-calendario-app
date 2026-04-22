import { useMemo, useRef, useEffect, useState } from 'react'
import { LayoutGroup, motion } from 'framer-motion'
import { parseEventHour } from '../utils/time'
import { resolveEventDate } from '../utils/resolveEventDate'

const START_H = 8
const END_H = 22
const ROW_H = 48 // px per hour

// Layout responsivo — en mobile comprimimos la gutter de horas y dejamos que
// las columnas de día se estiren por igual con minmax(0, 1fr) para que los 7
// días entren en el viewport sin scroll horizontal. En desktop mantenemos un
// ancho mínimo por columna que permite mostrar el título completo del evento.
const MOBILE_TIME_COL = 28   // px — suficiente para "22" / "9:00" recortado
const DESKTOP_TIME_COL = 48
const DESKTOP_DAY_MIN_W = 92

const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DAY_ABBR_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseEndHour(timeStr, startH) {
  if (!timeStr) return startH + 1
  const parts = String(timeStr).split('-')
  if (parts.length < 2) return startH + 1
  const endToken = parts[1].trim()
  const end = parseEventHour(endToken.match(/^\d/) ? endToken : '')
  if (end == null) return startH + 1
  return end > startH ? end : startH + 1
}

export default function WeekTimeGrid({ weekStart, events = [], onOpenTask, onAddAt }) {
  // Detectamos viewport angosto para adaptar layout. Usamos matchMedia para
  // reaccionar a rotaciones y split-view sin forzar renders innecesarios.
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 639px)')
    const handler = (e) => setIsNarrow(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const TIME_COL = isNarrow ? MOBILE_TIME_COL : DESKTOP_TIME_COL

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return {
        date: d,
        iso: toISO(d),
        dow: d.getDay(),
        num: d.getDate(),
        abbr: (isNarrow ? DAY_ABBR_SHORT : DAY_ABBR)[d.getDay()].toUpperCase(),
        isToday: toISO(d) === toISOToday(),
      }
    })
  }, [weekStart, isNarrow])

  const hours = []
  for (let h = START_H; h <= END_H; h++) hours.push(h)
  const gridHeight = (END_H - START_H) * ROW_H

  // Group events by day iso, then compute positions
  const eventsByDay = useMemo(() => {
    const map = {}
    for (const d of days) map[d.iso] = []
    for (const ev of events) {
      const iso = resolveEventDate(ev)
      if (!map[iso]) continue
      const h = parseEventHour(ev.time)
      if (h == null) continue
      const endH = parseEndHour(ev.time, h)
      const top = (Math.max(h, START_H) - START_H) * ROW_H
      const height = Math.max(24, (Math.min(endH, END_H) - Math.max(h, START_H)) * ROW_H - 2)
      map[iso].push({ ev, top, height })
    }
    return map
  }, [days, events])

  // Auto-scroll horizontal hasta hoy — solo aplica en desktop, donde todavía
  // puede haber overflow si el contenedor no es lo suficientemente ancho.
  // En mobile ya no hay scroll horizontal (las 7 columnas entran por diseño).
  const scrollerRef = useRef(null)
  useEffect(() => {
    if (isNarrow) return
    const el = scrollerRef.current
    if (!el) return
    const todayIdx = days.findIndex((d) => d.isToday)
    if (todayIdx < 0) return
    const contentW = TIME_COL + days.length * DESKTOP_DAY_MIN_W
    if (el.clientWidth >= contentW) return
    const targetLeft = TIME_COL + todayIdx * DESKTOP_DAY_MIN_W - 8
    el.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' })
  }, [days, isNarrow, TIME_COL])

  // Columna "ahora" — línea horizontal roja si el día de hoy está en la semana
  const now = new Date()
  const nowDecimal = now.getHours() + now.getMinutes() / 60
  const showNow = nowDecimal >= START_H && nowDecimal <= END_H && days.some((d) => d.isToday)
  const nowTop = (nowDecimal - START_H) * ROW_H

  // Grid template:
  //   · Mobile: minmax(0, 1fr) × 7 — las columnas se reparten el espacio del
  //     viewport por igual, sin piso (pueden bajar a ~45 px en un SE).
  //   · Desktop: minmax(92px, 1fr) — piso cómodo para ver título de evento.
  const dayColTemplate = isNarrow
    ? 'minmax(0, 1fr)'
    : `minmax(${DESKTOP_DAY_MIN_W}px, 1fr)`
  const gridTemplate = `${TIME_COL}px repeat(${days.length}, ${dayColTemplate})`
  // En mobile forzamos 100% de ancho (sin overflow horizontal). En desktop
  // mantenemos el comportamiento original con un ancho mínimo seguro.
  const innerWidth = isNarrow
    ? '100%'
    : `max(100%, ${TIME_COL + days.length * DESKTOP_DAY_MIN_W}px)`

  return (
    <div
      ref={scrollerRef}
      className={`bg-surface-container-lowest border border-slate-200 rounded-2xl overflow-y-auto ${
        isNarrow ? 'overflow-x-hidden' : 'overflow-x-auto'
      }`}
      style={{ maxHeight: 'calc(100vh - 260px)' }}
    >
      <div
        className="relative"
        style={{ width: innerWidth }}
      >
        {/* Header row with day labels */}
        <div
          className="sticky top-0 z-20 grid bg-surface-container-lowest/95 backdrop-blur border-b border-slate-200"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div className="h-14" />
          {days.map((d) => (
            <div key={d.iso} className="h-14 flex flex-col items-center justify-center border-l border-slate-100 min-w-0 px-0.5">
              <span className={`text-[10px] font-bold tracking-wide ${d.isToday ? 'text-primary' : 'text-outline'}`}>
                {d.abbr}
              </span>
              <span
                className={`mt-0.5 text-sm font-bold leading-none w-7 h-7 flex items-center justify-center rounded-full ${
                  d.isToday ? 'bg-primary text-white' : 'text-on-surface'
                }`}
              >
                {d.num}
              </span>
            </div>
          ))}
        </div>

        {/* Body grid */}
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: gridTemplate,
            height: gridHeight,
          }}
        >
          {/* Time column */}
          <div className="relative border-r border-slate-100">
            {hours.map((h, i) => (
              <div
                key={h}
                className="absolute left-0 right-0 text-[10px] text-outline/60 font-semibold pl-2"
                style={{ top: i * ROW_H - 5 }}
              >
                {i === 0 ? '' : `${h}:00`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d) => {
            const positioned = eventsByDay[d.iso] || []
            return (
              <div
                key={d.iso}
                className={`relative border-l border-slate-100 min-w-0 ${d.isToday ? 'bg-primary/5' : ''}`}
              >
                {/* Hour grid lines */}
                {hours.map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-slate-100"
                    style={{ top: i * ROW_H, height: ROW_H }}
                    onClick={() => {
                      if (!onAddAt) return
                      const hour = START_H + i
                      onAddAt(d.iso, hour)
                    }}
                    role={onAddAt ? 'button' : undefined}
                    aria-label={onAddAt ? `Añadir evento ${d.iso} ${START_H + i}:00` : undefined}
                  />
                ))}

                {/* Now indicator */}
                {d.isToday && showNow && (
                  <>
                    <div
                      className="absolute left-0 right-0 h-[2px] bg-error z-10"
                      style={{ top: nowTop }}
                    />
                    <div
                      className="absolute -left-1 w-2 h-2 rounded-full bg-error z-10"
                      style={{ top: nowTop - 3 }}
                    />
                  </>
                )}

                {/* Events — en mobile usamos tipografías más chicas y padding
                    mínimo. El border-l aporta identidad visual aunque el título
                    esté muy truncado. title atributo mantiene accesibilidad. */}
                <LayoutGroup>
                  {positioned.map(({ ev, top, height }) => (
                    <motion.button
                      key={ev.id}
                      layoutId={`week-event-${ev.id}`}
                      layout
                      type="button"
                      onClick={() => onOpenTask?.(ev)}
                      className={`absolute bg-primary/10 hover:bg-primary/20 border-l-[3px] border-primary rounded-r-md text-left transition-colors overflow-hidden z-[5] ${
                        isNarrow ? 'left-0.5 right-0.5 px-1 py-0.5' : 'left-1 right-1 px-1.5 py-1'
                      }`}
                      initial={false}
                      animate={{ top: top + 1, height }}
                      transition={{ type: 'spring', damping: 14, stiffness: 180 }}
                      title={`${ev.title}${ev.time ? ` · ${ev.time}` : ''}`}
                    >
                      <p className={`font-bold text-primary leading-tight truncate ${
                        isNarrow ? 'text-[10px]' : 'text-[11px]'
                      }`}>
                        {ev.title}
                      </p>
                      {ev.time && !isNarrow && (
                        <p className="text-[9px] text-primary/70 leading-tight truncate">{ev.time}</p>
                      )}
                    </motion.button>
                  ))}
                </LayoutGroup>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function toISOToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

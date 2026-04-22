import { useMemo, useRef, useEffect } from 'react'
import { LayoutGroup, motion } from 'framer-motion'
import { parseEventHour } from '../utils/time'
import { resolveEventDate } from '../utils/resolveEventDate'

const START_H = 8
const END_H = 22
const ROW_H = 48 // px per hour
const TIME_COL = 48 // px time gutter
const DAY_MIN_W = 92 // px min column width (mobile scroll)

const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

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
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return {
        date: d,
        iso: toISO(d),
        dow: d.getDay(),
        num: d.getDate(),
        abbr: DAY_ABBR[d.getDay()].toUpperCase(),
        isToday: toISO(d) === toISOToday(),
      }
    })
  }, [weekStart])

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

  // En mobile, auto-scroll horizontal hasta la columna de hoy (si está en la semana)
  const scrollerRef = useRef(null)
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const todayIdx = days.findIndex((d) => d.isToday)
    if (todayIdx < 0) return
    // Solo scrollea si no entra toda la fila en el viewport
    const contentW = TIME_COL + days.length * DAY_MIN_W
    if (el.clientWidth >= contentW) return
    const targetLeft = TIME_COL + todayIdx * DAY_MIN_W - 8
    el.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' })
  }, [days])

  // Columna "ahora" — línea horizontal roja si el día de hoy está en la semana
  const now = new Date()
  const nowDecimal = now.getHours() + now.getMinutes() / 60
  const showNow = nowDecimal >= START_H && nowDecimal <= END_H && days.some((d) => d.isToday)
  const nowTop = (nowDecimal - START_H) * ROW_H

  return (
    <div
      ref={scrollerRef}
      className="bg-surface-container-lowest border border-slate-200 rounded-2xl overflow-auto"
      style={{ maxHeight: 'calc(100vh - 260px)' }}
    >
      <div
        className="relative"
        style={{
          width: `max(100%, ${TIME_COL + days.length * DAY_MIN_W}px)`,
        }}
      >
        {/* Header row with day labels */}
        <div
          className="sticky top-0 z-20 grid bg-surface-container-lowest/95 backdrop-blur border-b border-slate-200"
          style={{ gridTemplateColumns: `${TIME_COL}px repeat(${days.length}, minmax(${DAY_MIN_W}px, 1fr))` }}
        >
          <div className="h-14" />
          {days.map((d) => (
            <div key={d.iso} className="h-14 flex flex-col items-center justify-center border-l border-slate-100">
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
            gridTemplateColumns: `${TIME_COL}px repeat(${days.length}, minmax(${DAY_MIN_W}px, 1fr))`,
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
                className={`relative border-l border-slate-100 ${d.isToday ? 'bg-primary/5' : ''}`}
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

                {/* Events */}
                <LayoutGroup>
                  {positioned.map(({ ev, top, height }) => (
                    <motion.button
                      key={ev.id}
                      layoutId={`week-event-${ev.id}`}
                      layout
                      type="button"
                      onClick={() => onOpenTask?.(ev)}
                      className="absolute left-1 right-1 bg-primary/10 hover:bg-primary/20 border-l-[3px] border-primary rounded-r-md px-1.5 py-1 text-left transition-colors overflow-hidden z-[5]"
                      initial={false}
                      animate={{ top: top + 1, height }}
                      transition={{ type: 'spring', damping: 14, stiffness: 180 }}
                      title={`${ev.title}${ev.time ? ` · ${ev.time}` : ''}`}
                    >
                      <p className="text-[11px] font-bold text-primary leading-tight truncate">{ev.title}</p>
                      {ev.time && (
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

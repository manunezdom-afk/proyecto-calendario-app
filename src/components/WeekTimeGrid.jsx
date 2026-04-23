import { useMemo, useRef, useEffect, useState } from 'react'
import { LayoutGroup, motion } from 'framer-motion'
import { parseEventHour } from '../utils/time'
import { resolveEventDate } from '../utils/resolveEventDate'

// Horas: grilla completa de 24 h. Antes cortaba a 8–22 (cualquier evento
// temprano o nocturno quedaba invisible). Ahora, estilo Google Calendar:
// mostramos 00:00–24:00, y al abrir scrolleamos a una hora razonable.
const START_H = 0
const END_H = 24
const ROW_H = 48 // px por hora
// Hora a la que hacemos el auto-scroll inicial cuando no estamos viendo hoy
// (p. ej. navegamos a una semana futura/pasada). 7 AM deja ver la mañana
// completa sin partir el día.
const DEFAULT_SCROLL_HOUR = 7

// Layout responsivo — en mobile comprimimos la gutter de horas y dejamos que
// las columnas de día se estiren por igual con minmax(0, 1fr) para que los 7
// días entren en el viewport sin scroll horizontal. En desktop mantenemos un
// ancho mínimo por columna que permite mostrar el título completo del evento.
const MOBILE_TIME_COL = 32   // px — suficiente para "24" en 24h o "11p" en 12h
const DESKTOP_TIME_COL = 56  // un poco más ancho para "12 AM" completo
const DESKTOP_DAY_MIN_W = 92

const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DAY_ABBR_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Hora de término del evento — extrae el segundo tramo del string "H:MM AM -
// H:MM AM". Si no hay, asume 1 h por defecto (para poder posicionar alto
// mínimo). No limita por END_H aquí; el clamp ocurre al calcular height.
function parseEndHour(timeStr, startH) {
  if (!timeStr) return startH + 1
  const parts = String(timeStr).split('-')
  if (parts.length < 2) return startH + 1
  const endToken = parts[1].trim()
  const end = parseEventHour(endToken.match(/^\d/) ? endToken : '')
  if (end == null) return startH + 1
  return end > startH ? end : startH + 1
}

// Labels de hora. Desktop: "12 AM" / "8 AM" / "12 PM" / "8 PM" — estilo
// Google Calendar web. Mobile: 24 h compacto ("08", "13", "22") para que
// entre en 32 px sin cortarse.
function hourLabel(h, isNarrow) {
  if (isNarrow) return String(h).padStart(2, '0')
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  if (h < 12) return `${h} AM`
  return `${h - 12} PM`
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

  // Group events by day iso, then compute positions. Los clamps son en
  // [START_H, END_H] para que un evento a las 23:30 se vea en el fondo, y
  // uno a las 00:00 en el tope.
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

  // Auto-scroll inicial (vertical + horizontal).
  //   · Vertical: al abrir, scrolleamos a la hora relevante para que el
  //     usuario no tenga que bajar manualmente para ver su día. Prioridad:
  //       1. Si hoy está en la semana → scroll a (hora actual - 1) para dejar
  //          una hora de contexto arriba.
  //       2. Si no → scroll a DEFAULT_SCROLL_HOUR (7 AM).
  //   · Horizontal: solo en desktop, como antes, para ir al día de hoy.
  const scrollerRef = useRef(null)
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    const todayIdx = days.findIndex((d) => d.isToday)
    const now = new Date()
    const hourForScroll = todayIdx >= 0
      ? Math.max(0, (now.getHours() + now.getMinutes() / 60) - 1)
      : DEFAULT_SCROLL_HOUR
    const targetTop = Math.max(0, (hourForScroll - START_H) * ROW_H)
    // Scroll inmediato (no smooth) al montar — evita que el usuario vea el
    // flash de 00:00 arriba y luego un jump. Un tick de requestAnimationFrame
    // garantiza que el layout ya tenga dimensiones medibles.
    requestAnimationFrame(() => {
      if (!scrollerRef.current) return
      scrollerRef.current.scrollTop = targetTop
    })

    if (!isNarrow && todayIdx >= 0) {
      const contentW = TIME_COL + days.length * DESKTOP_DAY_MIN_W
      if (el.clientWidth < contentW) {
        const targetLeft = TIME_COL + todayIdx * DESKTOP_DAY_MIN_W - 8
        requestAnimationFrame(() => {
          if (!scrollerRef.current) return
          scrollerRef.current.scrollLeft = Math.max(0, targetLeft)
        })
      }
    }
  }, [days, isNarrow, TIME_COL])

  // Indicador "ahora" — línea horizontal roja en la columna de hoy. Siempre
  // visible porque el grid cubre las 24 h.
  const now = new Date()
  const nowDecimal = now.getHours() + now.getMinutes() / 60
  const showNow = days.some((d) => d.isToday)
  const nowTop = (nowDecimal - START_H) * ROW_H

  // Grid template:
  //   · Mobile: minmax(0, 1fr) × 7 — las columnas se reparten el espacio del
  //     viewport por igual, sin piso (pueden bajar a ~45 px en un SE).
  //   · Desktop: minmax(92px, 1fr) — piso cómodo para ver título de evento.
  const dayColTemplate = isNarrow
    ? 'minmax(0, 1fr)'
    : `minmax(${DESKTOP_DAY_MIN_W}px, 1fr)`
  const gridTemplate = `${TIME_COL}px repeat(${days.length}, ${dayColTemplate})`
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
        {/* Header row con labels de día — sticky para que siempre se vea
            cuál día estás mirando aunque el scroll vertical baje. */}
        <div
          className="sticky top-0 z-20 grid bg-surface-container-lowest/95 backdrop-blur border-b border-slate-200"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div className="h-14" />
          {days.map((d) => (
            <div
              key={d.iso}
              className={`relative h-14 flex flex-col items-center justify-center border-l border-slate-100 min-w-0 px-0.5 ${
                d.isToday ? 'bg-primary/[0.04]' : ''
              }`}
            >
              {d.isToday && (
                <span
                  className="absolute left-0 right-0 top-0 h-[2px] bg-primary"
                  aria-hidden="true"
                />
              )}
              <span className={`text-[10px] font-bold tracking-wide ${d.isToday ? 'text-primary' : 'text-outline'}`}>
                {d.abbr}
              </span>
              <span
                className={`mt-0.5 text-sm font-bold leading-none w-7 h-7 flex items-center justify-center rounded-full ${
                  d.isToday ? 'bg-primary text-white shadow-sm shadow-primary/30' : 'text-on-surface'
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
          {/* Time column — labels posicionados al "top" de cada hora, offset
              negativo para que visualmente queden centrados en la línea. */}
          <div className="relative border-r border-slate-100">
            {hours.map((h, i) => (
              <div
                key={h}
                className={`absolute left-0 right-0 font-semibold text-outline/60 ${
                  isNarrow ? 'text-[9px] pl-1 tabular-nums' : 'text-[10px] pl-2'
                }`}
                style={{ top: i * ROW_H - 6 }}
              >
                {/* Nos saltamos el label en las 24 horas (doble medianoche) */}
                {i === 0 || i === hours.length - 1 ? '' : hourLabel(h, isNarrow)}
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
                {/* Hour grid lines — cada fila clickable para crear evento */}
                {hours.slice(0, -1).map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-slate-100 hover:bg-primary/5 transition-colors"
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

                {/* Línea final de la grilla (cierre a 24:00) */}
                <div
                  className="absolute left-0 right-0 border-t border-slate-100"
                  style={{ top: gridHeight }}
                />

                {/* Now indicator — punto + línea estilo Google */}
                {d.isToday && showNow && (
                  <>
                    <div
                      className="absolute -left-1 w-2 h-2 rounded-full bg-error z-10"
                      style={{ top: nowTop - 3 }}
                    />
                    <div
                      className="absolute left-0 right-0 h-[2px] bg-error z-10"
                      style={{ top: nowTop }}
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

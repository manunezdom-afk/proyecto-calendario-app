import { LayoutGroup, motion } from 'framer-motion'
import { parseEventHour, peakRangeLabel } from '../utils/peakZone'

const START_H = 8
const END_H = 22
const ROW_H = 48 // px per hour

function parseEndHour(timeStr, startH) {
  if (!timeStr) return startH + 1
  const parts = String(timeStr).split('-')
  if (parts.length < 2) return startH + 1
  const end = parseEventHour(parts[1].trim().match(/^\d/) ? parts[1] : '')
  if (end == null) return startH + 1
  return end > startH ? end : startH + 1
}

export default function DayTimeGrid({ events = [], peakStart, peakEnd, onAdd, onOpenTask }) {
  const hours = []
  for (let h = START_H; h <= END_H; h++) hours.push(h)
  const gridHeight = (END_H - START_H) * ROW_H

  const positioned = events
    .map((ev) => {
      const h = parseEventHour(ev.time)
      if (h == null) return null
      const endH = parseEndHour(ev.time, h)
      const top = (Math.max(h, START_H) - START_H) * ROW_H
      const height = Math.max(24, (Math.min(endH, END_H) - Math.max(h, START_H)) * ROW_H - 2)
      return { ev, top, height }
    })
    .filter(Boolean)

  const peakTop = peakStart != null ? (Math.max(peakStart, START_H) - START_H) * ROW_H : 0
  const peakHeight = peakStart != null && peakEnd != null
    ? (Math.min(peakEnd, END_H) - Math.max(peakStart, START_H)) * ROW_H
    : 0

  return (
    <section className="space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold tracking-tight text-on-surface">Día</h2>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          Añadir
        </button>
      </div>

      <div className="relative bg-surface-container-lowest border border-slate-200 rounded-2xl overflow-hidden" style={{ height: gridHeight }}>
        {peakStart != null && peakEnd != null && peakHeight > 0 && (
          <div
            className="absolute left-0 right-0 bg-emerald-50 pointer-events-none"
            style={{ top: peakTop, height: peakHeight }}
            title={`Zona de rendimiento · ${peakRangeLabel(peakStart, peakEnd)}`}
          >
            <span className="absolute top-1 right-2 text-[9px] font-bold text-emerald-700">Zona de rendimiento</span>
          </div>
        )}

        {hours.map((h, i) => (
          <div
            key={h}
            className="absolute left-0 right-0 flex items-start"
            style={{ top: i * ROW_H, height: ROW_H }}
          >
            <span className="w-12 flex-shrink-0 text-[10px] text-outline/60 font-semibold pl-2 pt-0.5">
              {h}:00
            </span>
            <div className="flex-1 border-t border-slate-100" />
          </div>
        ))}

        <LayoutGroup>
          {positioned.map(({ ev, top, height }) => (
            <motion.button
              key={ev.id}
              layoutId={`event-${ev.id}`}
              layout
              type="button"
              onClick={() => onOpenTask?.(ev)}
              className="absolute left-14 right-2 bg-primary/10 hover:bg-primary/20 border-l-4 border-primary rounded-r-lg px-2 py-1 text-left transition-colors overflow-hidden"
              initial={false}
              animate={{ top: top + 1, height }}
              transition={{ type: 'spring', damping: 14, stiffness: 180 }}
            >
              <p className="text-xs font-bold text-primary truncate">{ev.title}</p>
              {ev.time && <p className="text-[10px] text-primary/70 truncate">{ev.time}</p>}
            </motion.button>
          ))}
        </LayoutGroup>
      </div>
    </section>
  )
}

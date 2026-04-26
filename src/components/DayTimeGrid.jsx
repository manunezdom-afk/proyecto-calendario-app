import { LayoutGroup, motion } from 'framer-motion'
import { parseEventHour } from '../utils/time'
import { eventStatusAtNow } from '../utils/eventDuration'

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

export default function DayTimeGrid({
  events = [],
  onAdd,
  onOpenTask,
  onImport,
  onFocusBlock,
  referenceDate,
  emptyTitle = 'Día libre. Todo tuyo.',
  emptyBody = 'Bloquea tu atención, agenda algo o trae tu agenda externa.',
}) {
  const hours = []
  for (let h = START_H; h <= END_H; h++) hours.push(h)
  const gridHeight = (END_H - START_H) * ROW_H

  // referenceDate permite al caller (DayView) imponer un instante compartido
  // con el resto de la vista. Sin él, caemos a "ahora" — con menor precisión
  // inter-renders, pero suficiente para marcar eventos finalizados.
  const now = referenceDate instanceof Date ? referenceDate : new Date()

  const positioned = events
    .map((ev) => {
      const h = parseEventHour(ev.time)
      if (h == null) return null
      const endH = parseEndHour(ev.time, h)
      const top = (Math.max(h, START_H) - START_H) * ROW_H
      const height = Math.max(24, (Math.min(endH, END_H) - Math.max(h, START_H)) * ROW_H - 2)
      const status = eventStatusAtNow(ev, now)
      return { ev, top, height, status }
    })
    .filter(Boolean)

  return (
    <section className="space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold tracking-tight text-on-surface">Día</h2>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          Añadir
        </button>
      </div>

      <div className="relative bg-surface-container-lowest border border-outline-variant/30 rounded-2xl overflow-hidden shadow-sm" style={{ height: gridHeight }}>
        {hours.map((h, i) => (
          <div
            key={h}
            className="absolute left-0 right-0 flex items-start"
            style={{ top: i * ROW_H, height: ROW_H }}
          >
            <span className="w-12 flex-shrink-0 text-[10px] text-outline/60 font-semibold pl-2 pt-0.5">
              {h}:00
            </span>
            <div className="flex-1 border-t border-outline-variant/15" />
          </div>
        ))}

        {events.length === 0 && (
          <div className="absolute inset-x-6 inset-y-8 z-10 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto max-w-md rounded-[28px] border border-outline-variant/30 bg-surface-container-lowest px-6 py-6 text-center shadow-xl shadow-slate-900/5">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20">
                <span
                  className="material-symbols-outlined text-[28px] text-primary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  wb_sunny
                </span>
              </div>
              <p className="mt-4 text-base font-extrabold text-on-surface">{emptyTitle}</p>
              <p className="mx-auto mt-1 max-w-[300px] text-[12.5px] leading-snug text-outline">
                {emptyBody}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={onAdd}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm shadow-primary/20 transition-transform active:scale-95"
                >
                  <span className="material-symbols-outlined text-[15px]">add</span>
                  Añadir evento
                </button>
                <button
                  type="button"
                  onClick={onFocusBlock || onAdd}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-4 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/15 active:scale-95"
                >
                  <span className="material-symbols-outlined text-[15px]">psychology</span>
                  Trabajar enfocado
                </button>
                {onImport && (
                  <button
                    type="button"
                    onClick={onImport}
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-4 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[15px]">upload_file</span>
                    Importar agenda
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <LayoutGroup>
          {positioned.map(({ ev, top, height, status }) => {
            // Eventos finalizados: bajamos opacity, quitamos saturación en el
            // fondo y los marcamos con un pill "Finalizado" para distinguirlos
            // de los vigentes sin borrarlos.
            const isPast = status === 'past'
            const isActive = status === 'active'
            const baseClass = isPast
              ? 'absolute left-14 right-2 bg-surface-container-low hover:bg-surface-container border-l-4 border-outline-variant rounded-r-lg px-2 py-1 text-left transition-colors overflow-hidden opacity-60'
              : isActive
                ? 'absolute left-14 right-2 bg-primary/15 hover:bg-primary/25 border-l-4 border-primary rounded-r-lg px-2 py-1 text-left transition-colors overflow-hidden ring-1 ring-primary/25'
                : 'absolute left-14 right-2 bg-primary/10 hover:bg-primary/20 border-l-4 border-primary rounded-r-lg px-2 py-1 text-left transition-colors overflow-hidden'

            return (
              <motion.button
                key={ev.id}
                layoutId={`event-${ev.id}`}
                layout
                type="button"
                onClick={() => onOpenTask?.(ev)}
                className={baseClass}
                initial={false}
                animate={{ top: top + 1, height }}
                transition={{ type: 'spring', damping: 14, stiffness: 180 }}
                aria-label={isPast ? `${ev.title} (finalizado)` : ev.title}
              >
                <div className="flex items-center gap-1 min-w-0">
                  <p className={`text-xs font-bold truncate flex-1 ${
                    isPast ? 'text-outline line-through decoration-outline/40' : 'text-primary'
                  }`}>
                    {ev.title}
                  </p>
                  {isPast && (
                    <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-[1px] rounded-full bg-outline-variant/50 text-outline leading-tight">
                      Finalizado
                    </span>
                  )}
                  {isActive && (
                    <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-[1px] rounded-full bg-primary/20 text-primary leading-tight">
                      En curso
                    </span>
                  )}
                </div>
                {ev.time && (
                  <p className={`text-[10px] truncate ${isPast ? 'text-outline/70' : 'text-primary/70'}`}>
                    {ev.time}
                  </p>
                )}
              </motion.button>
            )
          })}
        </LayoutGroup>
      </div>
    </section>
  )
}

import { isReminderItem } from '../utils/reminders'
import { resolveEventDate, todayISO } from '../utils/resolveEventDate'
import { parseTimeRange, composeTimeRange } from '../utils/eventDuration'

// "Tu próxima ventana": panel vivo que mira el calendario en este momento y
// propone tareas para meter en el siguiente hueco libre del día. Reemplaza al
// hero estático "3 Victorias / Método MIT": en lugar de teoría, da una acción
// concreta cambiante a lo largo del día. Tres estados:
//   1. window  — hay un hueco ≥ MIN_WINDOW_MIN min y hay tareas pendientes.
//   2. shutdown — pasó SHUTDOWN_HOUR y aún hay tareas; ofrece bulk-defer.
//   3. calm    — no hay tareas, o el día está full sin huecos.

const PRIORITY_ORDER = { Alta: 0, Media: 1, Baja: 2 }
const MIN_WINDOW_MIN = 20
const DEFAULT_DURATION_MIN = 30
const DAY_START_H = 8
const DAY_END_H = 22
const SHUTDOWN_HOUR = 17

function formatHourFromDecimal(decimal, { withPeriod = true } = {}) {
  const h24 = Math.floor(decimal)
  const min = Math.round((decimal - h24) * 60)
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const base = `${h12}:${String(min).padStart(2, '0')}`
  return withPeriod ? `${base} ${period}` : base
}

// Devuelve { startH, endH, minutes } del próximo hueco libre desde "ahora"
// hasta DAY_END_H, o null si no hay ninguno ≥ MIN_WINDOW_MIN. Coalesce de
// bloques solapados antes de buscar — eventos repetidos en el mismo slot no
// abren un hueco fantasma entre ellos.
function computeNextFreeWindow(events, now) {
  const todayStr = todayISO()
  const blocks = (events || [])
    .filter((e) => e && !isReminderItem(e) && resolveEventDate(e) === todayStr)
    .map((e) => {
      const r = parseTimeRange(e.time)
      if (!r || r.startH == null) return null
      const endH = r.endH != null && r.endH > r.startH ? r.endH : r.startH + 0.5
      return { startH: r.startH, endH }
    })
    .filter(Boolean)
    .sort((a, b) => a.startH - b.startH)

  const merged = []
  for (const b of blocks) {
    const last = merged[merged.length - 1]
    if (last && b.startH <= last.endH) last.endH = Math.max(last.endH, b.endH)
    else merged.push({ ...b })
  }

  const nowH = now.getHours() + now.getMinutes() / 60
  const roundedNowH = Math.ceil(nowH * 4) / 4
  let cursor = Math.max(roundedNowH, DAY_START_H)

  for (const b of merged) {
    if (b.endH <= cursor) continue
    if (b.startH > cursor) {
      const minutes = (b.startH - cursor) * 60
      if (minutes >= MIN_WINDOW_MIN) {
        return { startH: cursor, endH: b.startH, minutes: Math.round(minutes) }
      }
    }
    if (b.endH > cursor) cursor = b.endH
  }

  if (cursor < DAY_END_H) {
    const minutes = (DAY_END_H - cursor) * 60
    if (minutes >= MIN_WINDOW_MIN) {
      return { startH: cursor, endH: DAY_END_H, minutes: Math.round(minutes) }
    }
  }
  return null
}

function priorityDot(priority) {
  if (priority === 'Alta') return 'bg-error'
  if (priority === 'Media') return 'bg-secondary'
  return 'bg-outline-variant'
}

export default function NextWindowPanel({
  events = [],
  pendingTasks = [],
  onAddEvent = () => {},
  onBulkDefer = () => {},
}) {
  const now = new Date()
  const window = computeNextFreeWindow(events, now)
  const isShutdownTime = now.getHours() >= SHUTDOWN_HOUR

  const suggestedTasks = pendingTasks
    .slice()
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1))
    .slice(0, 3)

  if (isShutdownTime && pendingTasks.length > 0) {
    return <ShutdownCard tasks={pendingTasks} onBulkDefer={onBulkDefer} />
  }

  if (!window || suggestedTasks.length === 0) {
    return <CalmCard hasWindow={!!window} hasTasks={suggestedTasks.length > 0} window={window} />
  }

  function handleSchedule(task) {
    const startStr = formatHourFromDecimal(window.startH)
    const duration = Math.min(DEFAULT_DURATION_MIN, window.minutes)
    const timeStr = composeTimeRange(startStr, duration)
    onAddEvent({
      title: task.label,
      time: timeStr,
      date: todayISO(),
      section: 'focus',
      icon: 'task_alt',
    })
  }

  const startLabel = formatHourFromDecimal(window.startH, { withPeriod: false })
  const endLabel = formatHourFromDecimal(window.endH, { withPeriod: false })

  return (
    <section className="bg-gradient-to-br from-primary/8 to-secondary/5 rounded-[24px] p-5 lg:p-6 border border-primary/15 space-y-4 lg:max-w-3xl">
      <div className="flex items-center gap-2">
        <span
          className="material-symbols-outlined text-primary text-[18px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          schedule
        </span>
        <h2 className="font-headline font-semibold text-on-surface text-sm">Tu próxima ventana</h2>
      </div>

      <div>
        <p className="font-headline font-semibold text-on-surface tracking-tight text-3xl lg:text-4xl">
          {window.minutes} min libres
        </p>
        <p className="text-sm text-outline mt-1">
          {startLabel} → {endLabel}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-outline/70">
          Nova sugiere meter
        </p>
        {suggestedTasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 bg-surface-container-lowest/70 rounded-2xl px-3 py-2.5 ring-1 ring-outline-variant/10"
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot(task.priority)}`} />
            <span className="flex-1 text-sm font-medium text-on-surface truncate">
              {task.label}
            </span>
            <button
              type="button"
              onClick={() => handleSchedule(task)}
              className="inline-flex items-center gap-1 rounded-full bg-primary text-on-primary px-3 py-1.5 text-[11px] font-bold hover:bg-primary/90 transition-colors active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-[13px]">add</span>
              Agendar {startLabel}
            </button>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-outline/70 leading-relaxed">
        Al tocar "Agendar" creo el evento en tu calendario. Lo podés deshacer al instante desde Mi Día.
      </p>
    </section>
  )
}

function ShutdownCard({ tasks, onBulkDefer }) {
  const ids = tasks.map((t) => t.id)
  return (
    <section className="bg-gradient-to-br from-indigo-500/10 to-purple-500/8 rounded-[24px] p-5 lg:p-6 border border-indigo-300/30 space-y-4 lg:max-w-3xl">
      <div className="flex items-center gap-2">
        <span
          className="material-symbols-outlined text-indigo-500 text-[18px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          bedtime
        </span>
        <h2 className="font-headline font-semibold text-on-surface text-sm">Cerrar el día</h2>
      </div>

      <p className="text-sm text-outline leading-relaxed">
        Te {tasks.length === 1 ? 'queda 1 tarea pendiente' : `quedan ${tasks.length} tareas pendientes`} de hoy.
        Movelas en bloque y dormí tranquilo — no se pierden, solo cambian de día.
      </p>

      <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
        {tasks.slice(0, 5).map((t) => (
          <p key={t.id} className="text-sm text-on-surface-variant truncate">
            · {t.label}
          </p>
        ))}
        {tasks.length > 5 && (
          <p className="text-[11px] text-outline">+{tasks.length - 5} más</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onBulkDefer(ids, 'semana')}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary text-on-primary px-3.5 py-2 text-[12px] font-bold hover:bg-primary/90 active:scale-[0.98] transition-all"
        >
          <span className="material-symbols-outlined text-[14px]">date_range</span>
          Mover todas a esta semana
        </button>
        <button
          type="button"
          onClick={() => onBulkDefer(ids, 'algún día')}
          className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/40 px-3.5 py-2 text-[12px] font-bold text-outline hover:bg-outline/10 transition-colors"
        >
          A algún día
        </button>
      </div>
    </section>
  )
}

function CalmCard({ hasWindow, hasTasks, window }) {
  let icon, title, body
  if (!hasWindow && hasTasks) {
    icon = 'event_busy'
    title = 'Tu día está full'
    body = 'No hay huecos libres. Si querés meter algo más, vas a tener que mover un evento desde el calendario.'
  } else if (hasWindow && !hasTasks) {
    icon = 'check_circle'
    title = 'Día limpio'
    body = `Tenés ${window.minutes} min libres pero no hay tareas pendientes. Disfrutá el espacio.`
  } else {
    icon = 'self_improvement'
    title = 'Todo en orden'
    body = 'No hay tareas pendientes ni huecos por agendar. Bien jugado.'
  }
  return (
    <section className="bg-surface-container-lowest rounded-[24px] p-5 lg:p-6 border border-outline-variant/15 space-y-2 lg:max-w-3xl">
      <div className="flex items-center gap-2">
        <span
          className="material-symbols-outlined text-outline text-[18px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
        <h2 className="font-headline font-semibold text-on-surface text-sm">{title}</h2>
      </div>
      <p className="text-sm text-outline leading-relaxed">{body}</p>
    </section>
  )
}

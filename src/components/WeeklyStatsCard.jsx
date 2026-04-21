const DAY_ABBR = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function getWeekDates() {
  const today = new Date()
  const dow   = today.getDay() // 0=Sun
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate()
}

export default function WeeklyStatsCard({ tasks }) {
  const weekDates = getWeekDates()
  const today     = new Date()

  // Count completions per day (using doneAt timestamp if present)
  const countsByDay = weekDates.map((d) => {
    return tasks.filter((t) => t.done && t.doneAt && isSameDay(new Date(t.doneAt), d)).length
  })

  const totalDone   = countsByDay.reduce((a, b) => a + b, 0)
  const activeDays  = countsByDay.filter((c) => c > 0).length
  const totalTasks  = tasks.filter((t) => t.category === 'hoy' || t.category === 'semana').length
  const pct         = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0
  const maxCount    = Math.max(...countsByDay, 1)

  return (
    <div className="bg-gradient-to-br from-primary/8 to-secondary/5 dark:from-primary/15 dark:to-secondary/10 rounded-[24px] p-5 border border-primary/10 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span
          className="material-symbols-outlined text-primary text-[18px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          date_range
        </span>
        <h3 className="font-headline font-bold text-on-surface dark:text-slate-100 text-sm">
          Semana en Resumen
        </h3>
      </div>

      {/* Stats row — labels breves para que nunca se corten en pantallas angostas */}
      <div className="flex gap-2">
        <div className="flex-1 min-w-0 bg-white/60 dark:bg-slate-800/60 rounded-2xl p-2.5 text-center">
          <p className="text-xl font-black text-primary tabular-nums leading-none">{totalDone}</p>
          <p className="text-[10px] font-bold text-outline mt-1 leading-tight">Hechas</p>
        </div>
        <div className="flex-1 min-w-0 bg-white/60 dark:bg-slate-800/60 rounded-2xl p-2.5 text-center">
          <p className="text-xl font-black text-secondary tabular-nums leading-none">{pct}%</p>
          <p className="text-[10px] font-bold text-outline mt-1 leading-tight">Progreso</p>
        </div>
        <div className="flex-1 min-w-0 bg-white/60 dark:bg-slate-800/60 rounded-2xl p-2.5 text-center">
          <p className="text-xl font-black text-amber-500 tabular-nums leading-none">{activeDays}</p>
          <p className="text-[10px] font-bold text-outline mt-1 leading-tight">Días activos</p>
        </div>
      </div>

      {/* 7-day bar chart */}
      <div className="flex items-end justify-between gap-1 pt-1">
        {weekDates.map((d, i) => {
          const count    = countsByDay[i]
          const isToday  = isSameDay(d, today)
          const isFuture = d > today && !isToday
          const barH     = isFuture ? 4 : Math.max(4, Math.round((count / maxCount) * 32))

          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <div
                className={`w-full rounded-full transition-all duration-500 ${
                  isFuture
                    ? 'bg-surface-container-low dark:bg-slate-700'
                    : isToday
                    ? 'bg-primary shadow-sm shadow-primary/30'
                    : count > 0
                    ? 'bg-primary/40'
                    : 'bg-surface-container-low dark:bg-slate-700'
                }`}
                style={{ height: `${barH}px` }}
              />
              <span className={`text-[9px] font-bold ${isToday ? 'text-primary' : 'text-outline/60'}`}>
                {DAY_ABBR[i]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

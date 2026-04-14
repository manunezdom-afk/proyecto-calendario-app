import { useState } from 'react'
import { useTasks } from '../hooks/useTasks'
import WeeklyStatsCard from '../components/WeeklyStatsCard'

const PRIORITY_CFG = {
  Alta:      { color: 'text-error',     bg: 'bg-error/10',     dot: 'bg-error',     ring: 'ring-error/30' },
  Media:     { color: 'text-secondary', bg: 'bg-secondary/10', dot: 'bg-secondary', ring: 'ring-secondary/30' },
  Baja:      { color: 'text-outline',   bg: 'bg-outline/10',   dot: 'bg-outline-variant', ring: 'ring-outline/20' },
}

const CATEGORIES   = ['hoy', 'semana', 'algún día']
const CAT_LABELS   = { hoy: 'Hoy', semana: 'Esta semana', 'algún día': 'Algún día' }
const CAT_ICONS    = { hoy: 'today', semana: 'date_range', 'algún día': 'inbox' }

export default function TasksView() {
  const { tasks, addTask, toggleTask, deleteTask } = useTasks()
  const [activeCategory, setActiveCategory] = useState('hoy')
  const [showInput, setShowInput]   = useState(false)
  const [newLabel, setNewLabel]     = useState('')
  const [newPriority, setNewPriority] = useState('Media')

  // ── Stats ──────────────────────────────────────────────────────────────────
  const todayTasks = tasks.filter((t) => t.category === 'hoy')
  const doneCount  = todayTasks.filter((t) => t.done).length
  const progress   = todayTasks.length > 0 ? Math.round((doneCount / todayTasks.length) * 100) : 0

  // MIT: top 3 undone today tasks sorted by priority
  const topThree = tasks
    .filter((t) => !t.done && t.category === 'hoy')
    .sort((a, b) => ({ Alta: 0, Media: 1, Baja: 2 }[a.priority] - { Alta: 0, Media: 1, Baja: 2 }[b.priority]))
    .slice(0, 3)

  const filtered = tasks.filter((t) => t.category === activeCategory)

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleAdd(e) {
    e.preventDefault()
    const trimmed = newLabel.trim()
    if (!trimmed) return
    addTask({ label: trimmed, priority: newPriority, category: activeCategory })
    setNewLabel('')
    setShowInput(false)
  }

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen pb-32 dark:bg-slate-900 dark:text-slate-100">

      <main className="max-w-md mx-auto px-6 pt-6 space-y-8">

        {/* ── Header + Progress ──────────────────────────────────────────── */}
        <header className="space-y-4">
          <h1 className="text-4xl font-extrabold tracking-tight text-on-surface dark:text-slate-100">Tareas</h1>

          <div className="bg-surface-container-lowest p-5 rounded-[24px] border border-outline-variant/20">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-bold text-on-surface-variant">Progreso de hoy</span>
              <span className="text-sm font-bold text-primary">{doneCount} / {todayTasks.length} completadas</span>
            </div>
            <div className="w-full bg-surface-container-low h-2 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
            {progress === 100 && todayTasks.length > 0 && (
              <p className="text-xs text-primary font-bold mt-2.5 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  celebration
                </span>
                ¡Todas las tareas de hoy completadas!
              </p>
            )}
          </div>
        </header>

        {/* ── Weekly Stats ──────────────────────────────────────────────── */}
        <WeeklyStatsCard tasks={tasks} />

        {/* ── Las 3 Victorias (MIT method) ──────────────────────────────── */}
        {topThree.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className="material-symbols-outlined text-[18px] text-amber-500"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                emoji_events
              </span>
              <h2 className="font-headline font-bold text-on-surface">Las 3 Victorias de Hoy</h2>
              <span className="ml-auto text-[10px] text-outline font-bold uppercase tracking-wider">
                Método MIT
              </span>
            </div>

            {topThree.map(({ id, label, priority }, i) => {
              const cfg = PRIORITY_CFG[priority]
              const isTop = i === 0
              return (
                <button
                  key={id}
                  onClick={() => toggleTask(id)}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all active:scale-[0.98] ${
                    isTop
                      ? 'bg-primary/8 ring-1 ring-primary/25'
                      : 'bg-surface-container-lowest ring-1 ring-outline-variant/15'
                  }`}
                >
                  <span className={`text-2xl font-black tabular-nums w-7 text-center ${isTop ? 'text-primary' : 'text-outline/30'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-on-surface text-sm truncate">{label}</p>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.color}`}>
                      Prioridad {priority}
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-outline-variant text-[20px]">
                    radio_button_unchecked
                  </span>
                </button>
              )
            })}
          </section>
        )}

        {/* ── Category tabs + task list ──────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all ${
                  activeCategory === cat
                    ? 'bg-primary text-white shadow-lg shadow-primary/20'
                    : 'bg-surface-container-low text-outline hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">{CAT_ICONS[cat]}</span>
                {CAT_LABELS[cat]}
                <span className={`ml-0.5 ${activeCategory === cat ? 'text-white/70' : 'text-outline/60'}`}>
                  ({tasks.filter((t) => t.category === cat && !t.done).length})
                </span>
              </button>
            ))}
            <button
              onClick={() => setShowInput(true)}
              className="ml-auto w-9 h-9 flex items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/20 active:scale-90 transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
            </button>
          </div>

          <div className="space-y-2">
            {filtered.length === 0 && !showInput && (
              <div className="bg-surface-container-low rounded-2xl p-8 text-center">
                <span className="material-symbols-outlined text-4xl text-outline/30 block mb-2">task_alt</span>
                <p className="text-sm text-outline font-medium">
                  Sin tareas en <span className="font-bold">{CAT_LABELS[activeCategory]}</span>.<br />
                  Pulsa + para añadir una.
                </p>
              </div>
            )}

            {filtered.map(({ id, label, done, priority }) => {
              const cfg = PRIORITY_CFG[priority]
              return (
                <div
                  key={id}
                  className={`flex items-center gap-3 p-4 rounded-2xl border transition-all ${
                    done
                      ? 'border-outline-variant/10 bg-surface-container-low/40 opacity-50'
                      : 'border-outline-variant/20 bg-surface-container-lowest'
                  }`}
                >
                  <button
                    onClick={() => toggleTask(id)}
                    className="flex-shrink-0 active:scale-90 transition-transform"
                  >
                    <span
                      className={`material-symbols-outlined text-xl transition-colors ${
                        done ? 'text-primary' : 'text-outline-variant hover:text-primary'
                      }`}
                      style={done ? { fontVariationSettings: "'FILL' 1" } : {}}
                    >
                      {done ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                  </button>

                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />

                  <span className={`flex-1 text-sm font-semibold ${done ? 'line-through text-outline' : 'text-on-surface'}`}>
                    {label}
                  </span>

                  <button
                    onClick={() => deleteTask(id)}
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-outline hover:bg-error/10 hover:text-error transition-all active:scale-90"
                  >
                    <span className="material-symbols-outlined text-[15px]">close</span>
                  </button>
                </div>
              )
            })}

            {/* Inline quick-add form */}
            {showInput && (
              <form
                onSubmit={handleAdd}
                className="bg-surface-container-lowest rounded-2xl ring-2 ring-primary/30 p-4 space-y-3"
              >
                <input
                  autoFocus
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowInput(false); setNewLabel('') }
                  }}
                  placeholder="¿Qué necesitas hacer?"
                  className="w-full bg-transparent text-on-surface placeholder:text-outline/50 text-sm font-medium focus:outline-none"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex gap-1">
                    {['Alta', 'Media', 'Baja'].map((p) => {
                      const cfg = PRIORITY_CFG[p]
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setNewPriority(p)}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${
                            newPriority === p ? `${cfg.bg} ${cfg.color}` : 'text-outline'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => { setShowInput(false); setNewLabel('') }}
                      className="text-xs text-outline hover:text-on-surface px-2 py-1 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
                    >
                      Añadir
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </section>

        {/* ── Tip: Patrón de éxito ──────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-primary/8 to-secondary/5 rounded-[24px] p-5 border border-primary/10 space-y-3">
          <div className="flex items-center gap-2">
            <span
              className="material-symbols-outlined text-primary text-[18px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              tips_and_updates
            </span>
            <span className="text-xs font-bold text-primary uppercase tracking-wider">
              Patrón de Éxito · Método MIT
            </span>
          </div>
          <p className="text-sm text-on-surface-variant font-medium leading-relaxed">
            Identifica tu <span className="text-on-surface font-bold">tarea más importante</span> del día y
            complétala antes de revisar correos o mensajes. Un solo foco profundo vale más que diez
            tareas superficiales.
          </p>
        </div>

      </main>
    </div>
  )
}

import { useState, useEffect } from 'react'
import WeeklyStatsCard from '../components/WeeklyStatsCard'
import { buildGhostTasks, ghostsDismissed, dismissGhosts } from '../utils/ghosts'

const PRIORITY_CFG = {
  Alta:      { color: 'text-error',     bg: 'bg-error/10',     dot: 'bg-error',     ring: 'ring-error/30' },
  Media:     { color: 'text-secondary', bg: 'bg-secondary/10', dot: 'bg-secondary', ring: 'ring-secondary/30' },
  Baja:      { color: 'text-outline',   bg: 'bg-outline/10',   dot: 'bg-outline-variant', ring: 'ring-outline/20' },
}

const CATEGORIES = ['hoy', 'semana', 'algún día']
const CAT_LABELS = { hoy: 'Hoy', semana: 'Esta semana', 'algún día': 'Algún día' }
const CAT_ICONS  = { hoy: 'today', semana: 'date_range', 'algún día': 'inbox' }

export default function TasksView({ tasks = [], addTask = () => {}, toggleTask = () => {}, deleteTask = () => {} }) {
  const [showInput, setShowInput]     = useState(false)
  const [addCategory, setAddCategory] = useState('hoy')
  const [newLabel, setNewLabel]       = useState('')
  const [newPriority, setNewPriority] = useState('Media')
  const [collapsed, setCollapsed]     = useState({})

  // ── Ghost tasks — demo visual para usuarios nuevos ─────────────────────
  const [ghostsOff, setGhostsOff] = useState(() => ghostsDismissed())
  const showGhosts = !ghostsOff && tasks.length === 0
  useEffect(() => {
    if (!ghostsOff && tasks.length > 0) {
      dismissGhosts()
      setGhostsOff(true)
    }
  }, [ghostsOff, tasks.length])
  const effectiveTasks = showGhosts ? buildGhostTasks() : tasks

  const handleToggle = (id) => {
    if (String(id).startsWith('ghost-')) return
    toggleTask(id)
  }
  const handleDelete = (id) => {
    if (String(id).startsWith('ghost-')) return
    deleteTask(id)
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const todayTasks = effectiveTasks.filter((t) => t.category === 'hoy')
  const doneCount  = todayTasks.filter((t) => t.done).length
  const progress   = todayTasks.length > 0 ? Math.round((doneCount / todayTasks.length) * 100) : 0

  // MIT: top 3 undone today tasks sorted by priority
  const topThree = effectiveTasks
    .filter((t) => !t.done && t.category === 'hoy')
    .sort((a, b) => ({ Alta: 0, Media: 1, Baja: 2 }[a.priority] - { Alta: 0, Media: 1, Baja: 2 }[b.priority]))
    .slice(0, 3)

  function handleAdd(e) {
    e.preventDefault()
    const trimmed = newLabel.trim()
    if (!trimmed) return
    addTask({ label: trimmed, priority: newPriority, category: addCategory })
    setNewLabel('')
    setShowInput(false)
  }

  function toggleCollapse(cat) {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen pb-44 dark:bg-slate-900 dark:text-slate-100">
      <main className="max-w-md lg:max-w-[1200px] mx-auto px-4 lg:px-10 pt-6 lg:pt-10 space-y-8">

        {/* ── Header + Progress + Weekly Stats (grid en desktop) ─────────── */}
        <header className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-[1fr_1fr_1fr] lg:gap-5 lg:items-stretch">
          <div className="lg:col-span-3 lg:mb-2">
            <h1 className="text-4xl lg:text-5xl font-extrabold text-on-surface dark:text-slate-100">Tareas</h1>
          </div>

          <div className="bg-surface-container-lowest p-5 rounded-[24px] border border-outline-variant/20 lg:col-span-2">
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
                <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>celebration</span>
                ¡Todas las tareas de hoy completadas!
              </p>
            )}
          </div>

          {/* Weekly stats en desktop va al lado del progreso */}
          <div className="hidden lg:block">
            <WeeklyStatsCard tasks={tasks} />
          </div>
        </header>

        {/* ── Weekly Stats (solo mobile) ────────────────────────────────── */}
        <div className="lg:hidden">
          <WeeklyStatsCard tasks={tasks} />
        </div>

        {/* ── Las 3 Victorias (MIT method) ──────────────────────────────── */}
        {topThree.length > 0 && (
          <section className="space-y-3 lg:max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-amber-500" style={{ fontVariationSettings: "'FILL' 1" }}>
                emoji_events
              </span>
              <h2 className="font-headline font-bold text-on-surface">Las 3 Victorias de Hoy</h2>
              <span className="ml-auto text-[10px] text-outline font-bold">Método MIT</span>
            </div>

            {topThree.map(({ id, label, priority, isGhost }, i) => {
              const cfg = PRIORITY_CFG[priority]
              const isTop = i === 0
              return (
                <button
                  key={id}
                  onClick={() => handleToggle(id)}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all active:scale-[0.98] ${
                    isTop ? 'bg-primary/8 ring-1 ring-primary/25' : 'bg-surface-container-lowest ring-1 ring-outline-variant/15'
                  }`}
                >
                  <span className={`text-2xl font-black tabular-nums w-7 text-center ${isTop ? 'text-primary' : 'text-outline/30'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-on-surface text-sm truncate">{label}</p>
                    <span className={`text-[10px] font-bold ${cfg.color}`}>Prioridad {priority}</span>
                  </div>
                  {isGhost ? (
                    <span className="text-[9px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full" style={{ letterSpacing: '0.08em' }}>
                      EJEMPLO
                    </span>
                  ) : (
                    <span className="material-symbols-outlined text-outline-variant text-[20px]">radio_button_unchecked</span>
                  )}
                </button>
              )
            })}
          </section>
        )}

        {/* ── Tareas agrupadas por categoría (kanban 3-col en desktop) ──── */}
        <section className="space-y-5 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:items-start">
          {CATEGORIES.map((cat) => {
            const catTasks = effectiveTasks.filter((t) => t.category === cat)
            const pending  = catTasks.filter((t) => !t.done).length
            const isOpen   = !collapsed[cat]
            return (
              <div key={cat} className="space-y-2 lg:bg-surface-container-lowest lg:rounded-[20px] lg:border lg:border-outline-variant/20 lg:p-4">
                {/* Header de sección */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleCollapse(cat)}
                    className="flex items-center gap-2 flex-1 text-left py-1"
                  >
                    <span className="material-symbols-outlined text-[16px] text-outline">{CAT_ICONS[cat]}</span>
                    <span className="text-sm font-bold text-on-surface">{CAT_LABELS[cat]}</span>
                    {pending > 0 && (
                      <span className="text-[10px] font-bold text-outline/60">({pending})</span>
                    )}
                    <span className={`material-symbols-outlined text-[16px] text-outline/40 ml-auto transition-transform duration-150 ${isOpen ? '' : '-rotate-90'}`}>
                      expand_more
                    </span>
                  </button>
                  <button
                    onClick={() => { setAddCategory(cat); setShowInput(true) }}
                    className="w-7 h-7 flex items-center justify-center rounded-full text-outline hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                  </button>
                </div>

                {isOpen && (
                  <div className="space-y-1.5 pl-1">
                    {catTasks.length === 0 && !(showInput && addCategory === cat) && (
                      <p className="text-xs text-outline/50 pl-5 py-1">Sin tareas. Pulsa + para añadir.</p>
                    )}

                    {catTasks.map(({ id, label, done, priority, isGhost }) => {
                      const cfg = PRIORITY_CFG[priority]
                      return (
                        <div
                          key={id}
                          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${
                            done
                              ? 'border-outline-variant/10 bg-surface-container-low/40 opacity-50'
                              : 'border-outline-variant/20 bg-surface-container-lowest'
                          }`}
                        >
                          <button onClick={() => handleToggle(id)} className="flex-shrink-0 active:scale-90 transition-transform">
                            <span
                              className={`material-symbols-outlined text-[18px] transition-colors ${done ? 'text-primary' : 'text-outline-variant hover:text-primary'}`}
                              style={done ? { fontVariationSettings: "'FILL' 1" } : {}}
                            >
                              {done ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                          </button>

                          <span className={`flex-1 text-sm font-medium ${done ? 'line-through text-outline' : 'text-on-surface'}`}>
                            {label}
                          </span>

                          {/* Priority pill */}
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                            {priority}
                          </span>

                          {isGhost ? (
                            <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ letterSpacing: '0.08em' }}>
                              EJEMPLO
                            </span>
                          ) : (
                            <>
                              {/* Drag handle — decorativo */}
                              <span className="material-symbols-outlined text-[14px] text-outline/30 flex-shrink-0 cursor-grab">
                                drag_indicator
                              </span>
                              <button
                                onClick={() => handleDelete(id)}
                                className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-outline/40 hover:bg-error/10 hover:text-error transition-all active:scale-90"
                              >
                                <span className="material-symbols-outlined text-[13px]">close</span>
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}

                    {/* Inline quick-add para esta categoría */}
                    {showInput && addCategory === cat && (
                      <form
                        onSubmit={handleAdd}
                        className="bg-surface-container-lowest rounded-xl ring-2 ring-primary/30 px-3 py-2.5 space-y-2"
                      >
                        <input
                          autoFocus
                          type="text"
                          value={newLabel}
                          onChange={(e) => setNewLabel(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') { setShowInput(false); setNewLabel('') } }}
                          placeholder="¿Qué necesitas hacer?"
                          className="w-full bg-transparent text-on-surface placeholder:text-outline/50 text-sm font-medium focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {['Alta', 'Media', 'Baja'].map((p) => {
                              const c = PRIORITY_CFG[p]
                              return (
                                <button key={p} type="button" onClick={() => setNewPriority(p)}
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${newPriority === p ? `${c.bg} ${c.color}` : 'text-outline'}`}
                                >
                                  {p}
                                </button>
                              )
                            })}
                          </div>
                          <div className="flex gap-2 ml-auto">
                            <button type="button" onClick={() => { setShowInput(false); setNewLabel('') }} className="text-xs text-outline px-2 py-1">
                              Cancelar
                            </button>
                            <button type="submit" className="text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors">
                              Añadir
                            </button>
                          </div>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </section>

        {/* ── Tip: Patrón de éxito ──────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-primary/8 to-secondary/5 rounded-[24px] p-5 lg:p-6 border border-primary/10 space-y-3 lg:max-w-3xl lg:mx-auto">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              tips_and_updates
            </span>
            <span className="text-xs font-bold text-primary">Patrón de Éxito · Método MIT</span>
          </div>
          <p className="text-sm text-on-surface-variant font-medium leading-relaxed">
            Identifica tu <span className="text-on-surface font-bold">tarea más importante</span> del día y
            complétala antes de revisar correos o mensajes. Una tarea terminada vale más que diez empezadas.
          </p>
        </div>

      </main>
    </div>
  )
}

import { useState, useRef, useEffect } from 'react'
import WeeklyStatsCard from '../components/WeeklyStatsCard'
import TaskCheckmark from '../components/TaskCheckmark'
import NextWindowPanel from '../components/NextWindowPanel'

const PRIORITY_CFG = {
  Alta:      { color: 'text-error',     bg: 'bg-error/10',     dot: 'bg-error',     ring: 'ring-error/30' },
  Media:     { color: 'text-secondary', bg: 'bg-secondary/10', dot: 'bg-secondary', ring: 'ring-secondary/30' },
  Baja:      { color: 'text-outline',   bg: 'bg-outline/10',   dot: 'bg-outline-variant', ring: 'ring-outline/20' },
}

const CATEGORIES = ['hoy', 'semana', 'algún día']
const CAT_LABELS = { hoy: 'Hoy', semana: 'Esta semana', 'algún día': 'Algún día' }
const CAT_ICONS  = { hoy: 'today', semana: 'date_range', 'algún día': 'inbox' }

// Puente cross-view: cuando otra vista quiere disparar Nova en Mi Día,
// escribe aquí un seed y navega al planner. PlannerView lo consume en
// su primer render y lo borra. Evita elevar focusBarSeed a App.jsx.
const NOVA_SEED_KEY = 'focus_pending_nova_seed'

export default function TasksView({ tasks = [], events = [], addTask = () => {}, toggleTask = () => {}, deleteTask = () => {}, updateTask = () => {}, addEvent = () => {}, onNavigate }) {
  const [showInput, setShowInput]     = useState(false)
  const [addCategory, setAddCategory] = useState('hoy')
  const [newLabel, setNewLabel]       = useState('')
  const [newPriority, setNewPriority] = useState('Media')
  const [collapsed, setCollapsed]     = useState({})
  // Feedback tras añadir: contador de tareas creadas en esta sesión de input
  // abierto. Se muestra como chip "· Añadidas N" y sube moral del usuario.
  const [justAddedCount, setJustAddedCount] = useState(0)
  const [flashAdded, setFlashAdded] = useState(false)
  const flashTimerRef = useRef(null)
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current) }, [])

  const handleToggle = (id) => toggleTask(id)
  const handleDelete = (id) => deleteTask(id)

  // ── Stats ──────────────────────────────────────────────────────────────────
  const todayTasks = tasks.filter((t) => t.category === 'hoy')
  const doneCount  = todayTasks.filter((t) => t.done).length
  const progress   = todayTasks.length > 0 ? Math.round((doneCount / todayTasks.length) * 100) : 0

  const pendingToday = tasks.filter((t) => !t.done && t.category === 'hoy')

  function handleBulkDefer(ids, category) {
    ids.forEach((id) => updateTask(id, { category }))
  }

  function handleAdd(e) {
    e.preventDefault()
    const trimmed = newLabel.trim()
    if (!trimmed) return
    addTask({ label: trimmed, priority: newPriority, category: addCategory })
    // UX: dejamos el input abierto para rapid-fire. El usuario cierra con
    // Cancelar/Escape o haciendo click fuera del add-form. Menos fricción
    // cuando vuelca varias tareas de golpe.
    setNewLabel('')
    setJustAddedCount((n) => n + 1)
    setFlashAdded(true)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashAdded(false), 1400)
  }

  function closeAddForm() {
    setShowInput(false)
    setNewLabel('')
    setJustAddedCount(0)
    setFlashAdded(false)
  }

  function toggleCollapse(cat) {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  // Cicla la categoría de la tarea al siguiente bucket (hoy → semana →
  // algún día → hoy). Más rápido que abrir un selector y suficiente para
  // reacomodar tareas sin drag‑and‑drop.
  function cycleCategory(id, current) {
    const idx = CATEGORIES.indexOf(current)
    const next = CATEGORIES[(idx + 1) % CATEGORIES.length]
    updateTask(id, { category: next })
  }

  // "Nova, organiza estas tareas": mandamos al usuario a Mi Día con un
  // prompt ya armado y autosubmit. Incluimos las tareas pendientes de hoy
  // en el mensaje para que Nova no tenga que adivinar a qué se refiere
  // el usuario. Si no hay nada pendiente, ni ofrecemos el botón.
  function askNovaToOrganize() {
    const pending = tasks.filter((t) => !t.done && t.category === 'hoy')
    if (pending.length === 0) return
    const list = pending.map((t) => `- ${t.label} (${t.priority})`).join('\n')
    const prompt = `Organiza estas tareas de hoy en horas concretas, teniendo en cuenta mis eventos ya agendados:\n${list}`
    try {
      sessionStorage.setItem(NOVA_SEED_KEY, JSON.stringify({ text: prompt, autosubmit: true, ts: Date.now() }))
    } catch {}
    onNavigate?.('planner')
  }

  const hasPendingToday = tasks.some((t) => !t.done && t.category === 'hoy')

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen pb-44 dark:bg-slate-900 dark:text-slate-100">
      <main className="max-w-md lg:max-w-[1200px] mx-auto px-4 lg:px-10 pt-6 lg:pt-10 space-y-8">

        {/* ── Header + Progress + Weekly Stats (grid en desktop) ─────────── */}
        <header className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-[1fr_1fr_1fr] lg:gap-5 lg:items-stretch">
          <div className="lg:col-span-3 lg:mb-2 flex items-center gap-3 flex-wrap">
            <h1 className="text-4xl lg:text-5xl font-extrabold text-on-surface dark:text-slate-100">Tareas</h1>
            {hasPendingToday && onNavigate && (
              <button
                type="button"
                onClick={askNovaToOrganize}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-[12px] font-bold text-primary hover:bg-primary/15 transition-colors active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  auto_awesome
                </span>
                Nova, organízame
              </button>
            )}
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
            <WeeklyStatsCard tasks={tasks} events={events} />
          </div>
        </header>

        {/* ── Weekly Stats (solo mobile) ────────────────────────────────── */}
        <div className="lg:hidden">
          <WeeklyStatsCard tasks={tasks} />
        </div>

        {/* ── Tu próxima ventana (panel vivo: window / shutdown / calm) ─── */}
        <NextWindowPanel
          events={events}
          pendingTasks={pendingToday}
          onAddEvent={addEvent}
          onBulkDefer={handleBulkDefer}
        />

        {/* ── Tareas agrupadas por categoría (kanban 3-col en desktop) ──── */}
        <section className="space-y-5 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:items-start">
          {CATEGORIES.map((cat) => {
            const catTasks = tasks.filter((t) => t.category === cat)
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
                    onClick={() => {
                      if (addCategory !== cat) setJustAddedCount(0)
                      setAddCategory(cat); setShowInput(true)
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-full text-outline hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                  </button>
                </div>

                {isOpen && (
                  <div className="space-y-1.5 pl-1">
                    {/* Empty state con CTA real: abre el input inline aquí
                        mismo en lugar de redirigir al usuario a buscar el +
                        mini en el header. Reduce un toque y recompensa la
                        expectativa de "solo quiero agregar una tarea ya". */}
                    {catTasks.length === 0 && !(showInput && addCategory === cat) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (addCategory !== cat) setJustAddedCount(0)
                          setAddCategory(cat)
                          setShowInput(true)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-outline-variant/40 bg-transparent hover:bg-primary/5 hover:border-primary/40 transition-colors text-left"
                      >
                        <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="material-symbols-outlined text-[14px] text-primary">add</span>
                        </span>
                        <span className="text-xs font-medium text-outline">
                          Añadir tarea a <span className="text-on-surface font-semibold">{CAT_LABELS[cat]}</span>
                        </span>
                      </button>
                    )}

                    {catTasks.map(({ id, label, done, priority, category }) => {
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
                          <TaskCheckmark done={done} onToggle={() => handleToggle(id)} size={18} />

                          <span className={`flex-1 text-sm font-medium ${done ? 'line-through text-outline' : 'text-on-surface'}`}>
                            {label}
                          </span>

                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                            {priority}
                          </span>

                          {/* Mover de bucket. Tap = siguiente (hoy → semana → algún día → hoy).
                              Reemplaza al drag‑indicator decorativo anterior. */}
                          <button
                            type="button"
                            onClick={() => cycleCategory(id, category)}
                            title="Mover a otro bucket"
                            aria-label="Mover tarea a otro bucket"
                            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-outline/50 hover:bg-primary/10 hover:text-primary transition-colors active:scale-90"
                          >
                            <span className="material-symbols-outlined text-[14px]">swap_horiz</span>
                          </button>
                          <button
                            onClick={() => handleDelete(id)}
                            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-outline/40 hover:bg-error/10 hover:text-error transition-all active:scale-90"
                          >
                            <span className="material-symbols-outlined text-[13px]">close</span>
                          </button>
                        </div>
                      )
                    })}

                    {/* Inline quick-add para esta categoría */}
                    {showInput && addCategory === cat && (
                      <form
                        onSubmit={handleAdd}
                        className={`bg-surface-container-lowest rounded-xl ring-2 px-3 py-2.5 space-y-2 transition-colors ${
                          flashAdded ? 'ring-primary' : 'ring-primary/30'
                        }`}
                      >
                        <input
                          autoFocus
                          type="text"
                          value={newLabel}
                          onChange={(e) => setNewLabel(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') closeAddForm() }}
                          placeholder={justAddedCount > 0 ? 'Añade otra tarea…' : '¿Qué necesitas hacer?'}
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
                          {justAddedCount > 0 && (
                            <span
                              className={`inline-flex items-center gap-1 text-[10.5px] font-bold ${
                                flashAdded ? 'text-primary' : 'text-outline/70'
                              } transition-colors`}
                            >
                              <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                                check_circle
                              </span>
                              {justAddedCount === 1 ? 'Añadida' : `${justAddedCount} añadidas`}
                            </span>
                          )}
                          <div className="flex gap-2 ml-auto">
                            <button type="button" onClick={closeAddForm} className="text-xs text-outline px-2 py-1">
                              Cerrar
                            </button>
                            <button
                              type="submit"
                              disabled={!newLabel.trim()}
                              className="text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors disabled:opacity-40"
                            >
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

      </main>
    </div>
  )
}

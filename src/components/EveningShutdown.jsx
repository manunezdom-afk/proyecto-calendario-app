import { useState, useEffect, useRef } from 'react'
import { analyzeBehavior } from '../services/behaviorAnalysis'
import { useUserProfile } from '../hooks/useUserProfile'
import { useAuth } from '../context/AuthContext'
import { motion, AnimatePresence } from 'framer-motion'
import { todayISO, tomorrowISO, formatDateLong } from '../utils/dateHelpers'

const PHASES = ['review', 'move', 'tomorrow']
const PHASE_LABELS = { review: 'Revisión', move: 'Pendientes', tomorrow: 'Mañana' }
const MAX_SECONDS = 90

function formatTomorrowDate() {
  return formatDateLong(new Date(Date.now() + 86400000))
}

// ─── Phase 1: Review ────────────────────────────────────────────────────────
function PhaseReview({ tasks, todayEvents, onNext }) {
  const doneTasks     = tasks.filter(t => t.done && t.category === 'hoy')
  const pendingTasks  = tasks.filter(t => !t.done && t.category === 'hoy')
  const donePercent   = tasks.filter(t => t.category === 'hoy').length > 0
    ? Math.round((doneTasks.length / tasks.filter(t => t.category === 'hoy').length) * 100)
    : 0

  return (
    <motion.div
      key="review"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 overflow-y-auto space-y-5"
    >
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-50 rounded-2xl p-4 text-center">
          <p className="text-3xl font-bold text-emerald-600 tabular-nums">{doneTasks.length}</p>
          <p className="text-[10px] font-semibold text-emerald-500 mt-1">Tareas hechas</p>
        </div>
        <div className="bg-amber-50 rounded-2xl p-4 text-center">
          <p className="text-3xl font-bold text-amber-500 tabular-nums">{pendingTasks.length}</p>
          <p className="text-[10px] font-semibold text-amber-400 mt-1">Pendientes</p>
        </div>
        <div className="bg-blue-50 rounded-2xl p-4 text-center">
          <p className="text-3xl font-bold text-blue-600 tabular-nums">{todayEvents.length}</p>
          <p className="text-[10px] font-semibold text-blue-400 mt-1">Eventos</p>
        </div>
      </div>

      {/* Progress ring substitute — bar */}
      <div>
        <div className="flex justify-between mb-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Progreso del día</span>
          <span className="text-xs font-bold text-slate-700">{donePercent}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-emerald-400"
            initial={{ width: 0 }}
            animate={{ width: `${donePercent}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Done tasks list (top 4) */}
      {doneTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Completadas hoy</p>
          {doneTasks.slice(0, 4).map(t => (
            <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 bg-emerald-50/60 rounded-xl">
              <span className="material-symbols-outlined text-emerald-500 text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                check_circle
              </span>
              <span className="text-sm text-slate-600 line-through">{t.label}</span>
            </div>
          ))}
          {doneTasks.length > 4 && (
            <p className="text-[11px] text-slate-400 pl-2">+{doneTasks.length - 4} más completadas</p>
          )}
        </div>
      )}

      {doneTasks.length === 0 && pendingTasks.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-4">
          Sin tareas registradas para hoy.
        </p>
      )}

      <button
        onClick={onNext}
        className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-slate-800 hover:bg-slate-700 active:scale-[0.98] transition-all"
      >
        {pendingTasks.length > 0 ? `Ver pendientes (${pendingTasks.length})` : 'Ver mañana →'}
      </button>
    </motion.div>
  )
}

// ─── Phase 2: Move ──────────────────────────────────────────────────────────
function PhaseMove({ tasks, todayEvents, onMoveEvent, onNext }) {
  const pendingTasks   = tasks.filter(t => !t.done && t.category === 'hoy')
  const pendingEvents  = todayEvents.filter(e => !e._dismissed)
  const [movedEvents, setMovedEvents] = useState(new Set())
  const [keptEvents, setKeptEvents]   = useState(new Set())

  const tomorrow = tomorrowISO()

  function moveEvent(id) {
    onMoveEvent?.(id, { date: tomorrow })
    setMovedEvents(prev => new Set([...prev, id]))
  }

  function keepEvent(id) {
    setKeptEvents(prev => new Set([...prev, id]))
  }

  const undecided = pendingEvents.filter(e => !movedEvents.has(e.id) && !keptEvents.has(e.id))

  return (
    <motion.div
      key="move"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 overflow-y-auto space-y-4"
    >
      {pendingTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Tareas sin completar
          </p>
          {pendingTasks.map(t => (
            <div key={t.id} className="flex items-center gap-2.5 px-3 py-2.5 bg-amber-50/60 rounded-xl border border-amber-100">
              <span className="material-symbols-outlined text-amber-400 text-[16px]">radio_button_unchecked</span>
              <span className="text-sm text-slate-700 flex-1">{t.label}</span>
              <span className="text-[10px] text-slate-400 font-medium">seguirán mañana</span>
            </div>
          ))}
        </div>
      )}

      {undecided.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Eventos pendientes — ¿mover a mañana?
          </p>
          {undecided.map(e => (
            <div key={e.id} className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{e.title}</p>
                {e.time && <p className="text-[10px] text-slate-400">{e.time}</p>}
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => keepEvent(e.id)}
                  className="text-[10px] font-bold text-slate-400 border border-slate-200 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  Dejar
                </button>
                <button
                  onClick={() => moveEvent(e.id)}
                  className="text-[10px] font-bold text-blue-600 border border-blue-200 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  Mañana
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Moved confirmation */}
      {movedEvents.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 rounded-xl">
          <span className="material-symbols-outlined text-emerald-500 text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            check_circle
          </span>
          <p className="text-[12px] text-emerald-600 font-medium">
            {movedEvents.size} evento{movedEvents.size > 1 ? 's' : ''} movido{movedEvents.size > 1 ? 's' : ''} a mañana
          </p>
        </div>
      )}

      {pendingTasks.length === 0 && undecided.length === 0 && movedEvents.size === 0 && (
        <p className="text-sm text-slate-400 text-center py-4">Todo está en orden.</p>
      )}

      <button
        onClick={onNext}
        className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-slate-800 hover:bg-slate-700 active:scale-[0.98] transition-all"
      >
        Ver mañana →
      </button>
    </motion.div>
  )
}

// ─── Phase 3: Tomorrow ───────────────────────────────────────────────────────
function PhaseTomorrow({ tomorrowEvents, tasks, onClose }) {
  const pendingWeek = tasks.filter(t => !t.done && t.category === 'semana')

  return (
    <motion.div
      key="tomorrow"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 overflow-y-auto space-y-4"
    >
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
          {formatTomorrowDate()}
        </p>

        {tomorrowEvents.length > 0 ? (
          <div className="space-y-2">
            {tomorrowEvents.map(e => (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 bg-blue-50/60 rounded-xl">
                <span className="material-symbols-outlined text-blue-400 text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  event
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{e.title}</p>
                  {e.time && <p className="text-[10px] text-slate-400">{e.time}</p>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 space-y-2">
            <span className="material-symbols-outlined text-slate-300 text-[32px] block">
              calendar_today
            </span>
            <p className="text-sm text-slate-400">Mañana está despejado.</p>
            <p className="text-xs text-slate-300">Usa Nova para armar el skeleton.</p>
          </div>
        )}
      </div>

      {pendingWeek.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Tareas de esta semana
          </p>
          {pendingWeek.slice(0, 3).map(t => (
            <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 bg-slate-50 rounded-xl">
              <span className="material-symbols-outlined text-slate-300 text-[14px]">circle</span>
              <span className="text-sm text-slate-600 truncate">{t.label}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onClose}
        className="w-full py-4 rounded-2xl font-bold text-[15px] text-white transition-transform active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}
      >
        Listo. Buenas noches.
      </button>
    </motion.div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function EveningShutdown({
  events = [],
  tasks  = [],
  onClose,
  onEditEvent,
}) {
  const [phaseIdx, setPhaseIdx] = useState(0)
  const [elapsed,  setElapsed]  = useState(0)
  const { user } = useAuth()
  const { profile } = useUserProfile()

  const today    = todayISO()
  const tomorrow = tomorrowISO()
  const todayEvents    = events.filter(e => !e.date || e.date === today)
  const tomorrowEvents = events.filter(e => e.date === tomorrow)

  // 90-second soft timer
  useEffect(() => {
    const id = setInterval(() => setElapsed(t => Math.min(t + 1, MAX_SECONDS)), 1000)
    return () => clearInterval(id)
  }, [])

  // Al cerrar el Evening Shutdown (cuando el usuario completa el ritual),
  // analizamos las señales del día y actualizamos el modelo de comportamiento.
  // Esto corre una vez por sesión de shutdown, silenciosamente.
  const analyzedRef = useRef(false)
  useEffect(() => {
    if (analyzedRef.current) return
    analyzedRef.current = true
    // Pequeño delay para no bloquear el render inicial
    const id = setTimeout(() => {
      analyzeBehavior({ userId: user?.id, profile })
        .catch(err => console.warn('[Focus] ⚠️ analyzeBehavior', err))
    }, 1500)
    return () => clearTimeout(id)
  }, [user?.id, profile])

  function nextPhase() {
    setPhaseIdx(i => Math.min(i + 1, PHASES.length - 1))
  }

  const currentPhase = PHASES[phaseIdx]
  const timerPct = (elapsed / MAX_SECONDS) * 100

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[200] flex items-end"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="w-full max-h-[85vh] flex flex-col rounded-t-[28px] bg-white overflow-hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}
      >
        {/* Timer bar */}
        <div className="h-1 bg-slate-100">
          <motion.div
            className="h-full bg-blue-400"
            animate={{ width: `${timerPct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
          <div>
            <h2 className="text-[17px] font-bold text-slate-800">Cerrar el día</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {MAX_SECONDS - elapsed}s restantes
            </p>
          </div>

          {/* Phase stepper */}
          <div className="flex items-center gap-1.5">
            {PHASES.map((p, i) => (
              <div
                key={p}
                className={`rounded-full transition-all duration-300 ${
                  i === phaseIdx
                    ? 'w-5 h-1.5 bg-slate-800'
                    : i < phaseIdx
                    ? 'w-1.5 h-1.5 bg-slate-400'
                    : 'w-1.5 h-1.5 bg-slate-200'
                }`}
              />
            ))}
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Phase label */}
        <div className="px-6 pb-3 flex-shrink-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            {PHASE_LABELS[currentPhase]}
          </p>
        </div>

        {/* Phase content */}
        <div className="flex-1 overflow-y-auto px-6 pb-2 min-h-0">
          <AnimatePresence mode="wait">
            {currentPhase === 'review' && (
              <PhaseReview
                key="review"
                tasks={tasks}
                todayEvents={todayEvents}
                onNext={nextPhase}
              />
            )}
            {currentPhase === 'move' && (
              <PhaseMove
                key="move"
                tasks={tasks}
                todayEvents={todayEvents}
                onMoveEvent={(id, updates) => onEditEvent?.(id, updates)}
                onNext={nextPhase}
              />
            )}
            {currentPhase === 'tomorrow' && (
              <PhaseTomorrow
                key="tomorrow"
                tomorrowEvents={tomorrowEvents}
                tasks={tasks}
                onClose={onClose}
              />
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  )
}

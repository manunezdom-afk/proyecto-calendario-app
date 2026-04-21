import { useState, useEffect, useRef } from 'react'
import { analyzeBehavior } from '../services/behaviorAnalysis'
import { useUserProfile } from '../hooks/useUserProfile'
import { useAuth } from '../context/AuthContext'
import { motion, AnimatePresence } from 'framer-motion'
import AuroraBackground from './AuroraBackground'
import NovaOrb from './NovaOrb'

const PHASES = ['review', 'move', 'tomorrow']
const PHASE_LABELS = { review: 'Revisión', move: 'Pendientes', tomorrow: 'Mañana' }
const MAX_SECONDS = 90

function getTodayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getTomorrowISO() {
  const d = new Date(Date.now() + 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatTomorrowDate() {
  const d = new Date(Date.now() + 86400000)
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
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
          <span className="text-xs font-bold text-slate-500">Progreso del día</span>
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
          <p className="text-[11px] font-bold text-slate-400">Completadas hoy</p>
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

  const tomorrowISO = getTomorrowISO()

  function moveEvent(id) {
    onMoveEvent?.(id, { date: tomorrowISO })
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
          <p className="text-[11px] font-bold text-slate-400">
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
          <p className="text-[11px] font-bold text-slate-400">
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
        <p className="text-[11px] font-bold text-slate-400 mb-3">
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
          <p className="text-[11px] font-bold text-slate-400">
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

  const todayISO     = getTodayISO()
  const tomorrowISO  = getTomorrowISO()
  const todayEvents  = events.filter(e => !e.date || e.date === todayISO)
  const tomorrowEvents = events.filter(e => e.date === tomorrowISO)

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
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[200] flex items-end"
      style={{ background: 'radial-gradient(ellipse at 50% 80%, #0f1a2e 0%, #05060a 70%)' }}
    >
      <AuroraBackground variant="threshold" intensity={0.5} />
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, info) => {
          if (info.offset.y > 160 || info.velocity.y > 600) onClose?.()
        }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="relative z-10 w-full max-h-[90vh] flex flex-col rounded-t-[28px] bg-white/5 backdrop-blur-2xl border-t border-white/10 overflow-hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}
      >
        {/* Grip handle */}
        <div className="flex justify-center pt-3 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/25" aria-hidden />
        </div>

        {/* Timer bar */}
        <div className="mx-6 mt-3 h-0.5 bg-white/10 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-nova-soft"
            animate={{ width: `${timerPct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Header ceremonial */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <NovaOrb size={36} ambient={false} />
            <div>
              <h2 className="font-nova text-[17px] font-medium text-white/90">Cerrar el día</h2>
              <p className="text-[11px] text-white/40 mt-0.5">
                {MAX_SECONDS - elapsed}s restantes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {PHASES.map((p, i) => (
              <div
                key={p}
                className={`rounded-full transition-all duration-300 ${
                  i === phaseIdx
                    ? 'w-5 h-1.5 bg-nova-soft'
                    : i < phaseIdx
                    ? 'w-1.5 h-1.5 bg-white/40'
                    : 'w-1.5 h-1.5 bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Phase label */}
        <div className="px-6 pb-3 flex-shrink-0">
          <p className="text-[11px] text-white/40">
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

import { useState, useEffect, useCallback } from 'react'

const WORK_SECS  = 25 * 60
const BREAK_SECS = 5  * 60
const RADIUS     = 76
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function pad(n) { return String(n).padStart(2, '0') }

export default function FocusTimerOverlay({ block, onClose, onComplete }) {
  const [phase, setPhase]     = useState('work')   // 'work' | 'break'
  const [total, setTotal]     = useState(WORK_SECS)
  const [left, setLeft]       = useState(WORK_SECS)
  const [running, setRunning] = useState(false)

  const progress = left / total
  const dashOffset = CIRCUMFERENCE * (1 - progress)

  const mins = Math.floor(left / 60)
  const secs = left % 60

  const handlePhaseEnd = useCallback(() => {
    setRunning(false)
    if (phase === 'work') {
      // Start break
      setPhase('break')
      setTotal(BREAK_SECS)
      setLeft(BREAK_SECS)
    } else {
      // Break done — close/complete
      onComplete?.()
    }
  }, [phase, onComplete])

  useEffect(() => {
    if (!running) return
    if (left <= 0) { handlePhaseEnd(); return }
    const id = setInterval(() => setLeft((l) => l - 1), 1000)
    return () => clearInterval(id)
  }, [running, left, handlePhaseEnd])

  function reset() {
    setRunning(false)
    setPhase('work')
    setTotal(WORK_SECS)
    setLeft(WORK_SECS)
  }

  const phaseLabel = phase === 'work' ? 'TRABAJO PROFUNDO' : 'DESCANSO'
  const phaseColor = phase === 'work' ? '#0058bc' : '#4c4aca'

  return (
    <div className="fixed inset-0 z-[70] bg-surface/95 dark:bg-slate-900/95 backdrop-blur-xl flex flex-col items-center justify-center px-6">
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full bg-surface-container-low text-outline hover:text-on-surface transition-colors active:scale-90"
      >
        <span className="material-symbols-outlined">close</span>
      </button>

      {/* Block title */}
      <p className="text-xs font-bold text-outline uppercase tracking-widest mb-8">
        {block?.title ?? 'Bloque de foco'}
      </p>

      {/* Progress ring */}
      <div className="relative flex items-center justify-center mb-8">
        <svg width="180" height="180" className="-rotate-90">
          {/* Track */}
          <circle
            cx="90" cy="90" r={RADIUS}
            fill="none"
            stroke="currentColor"
            className="text-surface-container-low dark:text-slate-700"
            strokeWidth="6"
          />
          {/* Progress */}
          <circle
            cx="90" cy="90" r={RADIUS}
            fill="none"
            stroke={phaseColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.4s ease' }}
          />
        </svg>

        {/* Center time */}
        <div className="absolute flex flex-col items-center">
          <span className="font-headline font-black text-5xl text-on-surface dark:text-slate-100 tabular-nums">
            {pad(mins)}:{pad(secs)}
          </span>
        </div>
      </div>

      {/* Phase badge */}
      <span
        className="text-[10px] font-black tracking-[0.15em] px-4 py-1.5 rounded-full mb-10"
        style={{ background: `${phaseColor}18`, color: phaseColor }}
      >
        {phaseLabel}
      </span>

      {/* Controls */}
      <div className="flex items-center gap-5">
        <button
          onClick={reset}
          className="w-12 h-12 rounded-2xl bg-surface-container-low flex items-center justify-center text-outline hover:text-on-surface transition-colors active:scale-90"
        >
          <span className="material-symbols-outlined text-[22px]">restart_alt</span>
        </button>

        <button
          onClick={() => setRunning((r) => !r)}
          className="w-16 h-16 rounded-2xl text-white flex items-center justify-center shadow-xl active:scale-95 transition-all"
          style={{ background: phaseColor, boxShadow: `0 12px 28px ${phaseColor}40` }}
        >
          <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
            {running ? 'pause' : 'play_arrow'}
          </span>
        </button>

        <button
          onClick={onClose}
          className="w-12 h-12 rounded-2xl bg-surface-container-low flex items-center justify-center text-outline hover:text-on-surface transition-colors active:scale-90"
        >
          <span className="material-symbols-outlined text-[22px]">skip_next</span>
        </button>
      </div>

      <p className="mt-8 text-xs text-outline font-medium text-center max-w-xs leading-relaxed">
        {running
          ? phase === 'work'
            ? 'Mantén el foco. Las distracciones pueden esperar.'
            : 'Descansa de verdad. Aléjate de la pantalla.'
          : 'Pulsa play para empezar el bloque.'}
      </p>
    </div>
  )
}

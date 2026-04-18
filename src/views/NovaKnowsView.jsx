import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useUserProfile } from '../hooks/useUserProfile'
import { analyzeBehavior, getCachedBehavior, fetchBehavior } from '../services/behaviorAnalysis'
import { clearAllSignals } from '../services/signalsService'

// ── Humaniza el modelo en insights legibles ───────────────────────────────────
function buildInsights(b, profile) {
  if (!b) return []
  const out = []

  // Pico real vs declarado
  if (b.real_peak_window) {
    const { start, end } = b.real_peak_window
    const decl = b.profile_peak
    if (decl && start !== decl.start) {
      out.push({
        icon: 'bolt',
        gradient: 'from-amber-400 to-orange-500',
        title: `Tu pico real es ${start}–${end}h, no ${decl.start}–${decl.end}h`,
        body: `Tu perfil declara esa franja, pero los datos muestran que rendís mejor más tarde. Estoy usando la observada, no la declarada.`,
      })
    } else {
      out.push({
        icon: 'bolt',
        gradient: 'from-amber-400 to-orange-500',
        title: `Tu pico de productividad es ${start}–${end}h`,
        body: `Completas la mayoría de tus tareas en esa franja. Intento proteger ese bloque de reuniones.`,
      })
    }
  }

  // Día fuerte / día flojo
  if (b.busy_weekday) {
    out.push({
      icon: 'calendar_month',
      gradient: 'from-blue-500 to-violet-500',
      title: `Los ${b.busy_weekday} son tus días más productivos`,
      body: b.slow_weekday
        ? `Y los ${b.slow_weekday} los más lentos — no te exijo lo mismo esos días.`
        : `Ajusto la carga según el día.`,
    })
  }

  // Tipo que aprueba
  if (b.top_approved_kind) {
    const KIND_LABELS = {
      add_event: 'crear eventos',
      edit_event: 'reprogramar eventos',
      delete_event: 'cancelar eventos',
      add_task: 'agregar tareas',
      toggle_task: 'marcar tareas',
      remember: 'recordar datos sobre vos',
    }
    out.push({
      icon: 'thumb_up',
      gradient: 'from-emerald-400 to-teal-500',
      title: `Apruebas sobre todo cuando propongo ${KIND_LABELS[b.top_approved_kind] || b.top_approved_kind}`,
      body: `Seguiré priorizando ese tipo de sugerencias.`,
    })
  }

  // Avoid kinds
  if (b.avoid_kinds && b.avoid_kinds.length > 0) {
    const KIND_LABELS = {
      add_event: 'crear eventos',
      edit_event: 'reprogramar eventos',
      delete_event: 'cancelar eventos',
      add_task: 'agregar tareas',
      toggle_task: 'marcar tareas',
      remember: 'recordar datos sobre vos',
    }
    const friendly = b.avoid_kinds.map(k => KIND_LABELS[k] || k).join(', ')
    out.push({
      icon: 'do_not_disturb_on',
      gradient: 'from-slate-400 to-slate-600',
      title: `Ya no sugiero ${friendly}`,
      body: `Los rechazaste varias veces. Me callo con eso hasta que me indiques lo contrario.`,
    })
  }

  // Categorías
  if (b.top_categories && b.top_categories.length > 0) {
    const top = b.top_categories[0]
    out.push({
      icon: 'category',
      gradient: 'from-violet-500 to-fuchsia-500',
      title: `Tu categoría dominante: ${top.category}`,
      body: b.top_categories.length > 1
        ? `Seguida de ${b.top_categories.slice(1).map(c => c.category).join(', ')}.`
        : `Mayoría de tus eventos pertenecen a esa categoría.`,
    })
  }

  // Nova usage
  if (b.nova_favorite_hour != null) {
    out.push({
      icon: 'chat',
      gradient: 'from-cyan-400 to-blue-500',
      title: `Sueles escribirme alrededor de las ${b.nova_favorite_hour}h`,
      body: `En promedio me mandas ${b.nova_daily_avg} mensaje(s) por día.`,
    })
  }

  // Trend
  if (b.engagement_trend) {
    const TREND = {
      subiendo: { icon: 'trending_up',    gradient: 'from-emerald-400 to-green-600', title: 'Tu actividad viene en alza', body: 'Estás usando la app más que la semana pasada.' },
      bajando:  { icon: 'trending_down',  gradient: 'from-rose-400 to-pink-500',     title: 'Tu actividad bajó un poco',   body: 'Menos interacciones que la semana pasada — todo bien, solo lo noto.' },
      estable:  { icon: 'trending_flat',  gradient: 'from-slate-400 to-slate-600',   title: 'Ritmo consistente',            body: 'Actividad similar a la semana pasada.' },
    }[b.engagement_trend]
    if (TREND) out.push(TREND)
  }

  return out
}

function InsightCard({ icon, gradient, title, body, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className="bg-white rounded-[20px] border border-slate-100 shadow-sm p-5 flex gap-3"
    >
      <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0 shadow-md`}>
        <span
          className="material-symbols-outlined text-white text-[20px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold text-slate-900 leading-tight">{title}</p>
        <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">{body}</p>
      </div>
    </motion.div>
  )
}

function StatTile({ label, value, hint }) {
  return (
    <div className="flex-1 min-w-[140px] bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
      <p className="text-[10.5px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900 mt-1 font-headline tracking-tight">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────
export default function NovaKnowsView({ onBack }) {
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const [model, setModel] = useState(() => getCachedBehavior())
  const [analyzing, setAnalyzing] = useState(false)
  const [justCleared, setJustCleared] = useState(false)

  // Cargar modelo de la nube al montar
  useEffect(() => {
    fetchBehavior(user?.id).then(m => { if (m) setModel(m) }).catch(() => {})
  }, [user?.id])

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true)
    try {
      const m = await analyzeBehavior({ userId: user?.id, profile })
      if (m) setModel(m)
    } finally {
      setAnalyzing(false)
    }
  }, [user?.id, profile])

  const handleClear = useCallback(async () => {
    if (!confirm('¿Borrar todo lo que Nova aprendió de ti? Esto borra el historial de señales y el modelo. No afecta tus eventos ni tareas.')) return
    await clearAllSignals()
    setModel(null)
    setJustCleared(true)
    setTimeout(() => setJustCleared(false), 3000)
  }, [])

  const insights = buildInsights(model, profile)
  const hasModel = !!model && model.sample_size > 0
  const lastAnalyzed = model?.computed_at
    ? new Date(model.computed_at).toLocaleString('es-ES', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <div className="max-w-lg lg:max-w-3xl mx-auto px-4 py-6 space-y-5 pb-32">
      {/* Header */}
      <div className="px-1">
        {onBack && (
          <button
            onClick={onBack}
            className="text-[13px] text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1 mb-3"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Volver
          </button>
        )}
        <h1 className="text-2xl lg:text-3xl font-extrabold text-slate-900 tracking-tight font-headline">
          Lo que Nova sabe de vos
        </h1>
        <p className="text-[13.5px] text-slate-500 mt-1 leading-snug">
          Un resumen transparente de los patrones que Nova aprendió de tu uso.
          No es mágico — son tus datos, analizados.
        </p>
      </div>

      {/* Sin datos suficientes */}
      {!hasModel && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[20px] border border-slate-100 p-8 text-center shadow-sm"
        >
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 via-violet-500 to-fuchsia-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span
              className="material-symbols-outlined text-white text-[28px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              hourglass_empty
            </span>
          </div>
          <p className="text-[15px] font-bold text-slate-900">
            {justCleared ? '¡Listo! Nova ya no recuerda nada.' : 'Nova todavía no tiene suficientes datos'}
          </p>
          <p className="text-[13px] text-slate-500 mt-2 leading-snug max-w-sm mx-auto">
            {justCleared
              ? 'Seguirá aprendiendo a medida que uses la app.'
              : 'Usá Focus unos días — completá tareas, aceptá o rechazá sugerencias — y acá vas a empezar a ver patrones.'}
          </p>
          <button
            onClick={runAnalysis}
            disabled={analyzing}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-900 text-white text-[12.5px] font-semibold disabled:opacity-40 hover:bg-slate-800 transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]">refresh</span>
            {analyzing ? 'Analizando…' : 'Intentar analizar ahora'}
          </button>
        </motion.div>
      )}

      {/* Modelo con datos */}
      {hasModel && (
        <>
          {/* Top stats */}
          <div className="flex gap-2.5 flex-wrap">
            <StatTile
              label="Señales"
              value={model.sample_size}
              hint={`últimos ${model.period_days || 30} días`}
            />
            <StatTile
              label="Aprobaciones"
              value={model.approved_count}
              hint={model.approval_rate != null ? `${Math.round(model.approval_rate * 100)}% tasa` : null}
            />
            <StatTile
              label="Con Nova"
              value={model.nova_daily_avg ? `${model.nova_daily_avg}/día` : '—'}
              hint="mensajes promedio"
            />
          </div>

          {/* Insights */}
          <div className="space-y-2.5">
            {insights.map((ins, i) => (
              <InsightCard key={i} {...ins} delay={i * 0.05} />
            ))}
          </div>

          {/* Weekday histogram */}
          {model.weekday_completions && model.weekday_completions.some(n => n > 0) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-[20px] border border-slate-100 shadow-sm p-5"
            >
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                Tareas completadas por día
              </p>
              <div className="flex items-end gap-2 h-24">
                {model.weekday_completions.map((n, wd) => {
                  const max = Math.max(...model.weekday_completions, 1)
                  const pct = (n / max) * 100
                  const label = ['D', 'L', 'M', 'X', 'J', 'V', 'S'][wd]
                  return (
                    <div key={wd} className="flex-1 flex flex-col items-center gap-1.5">
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className="w-full rounded-t-md bg-gradient-to-t from-blue-500 via-violet-500 to-fuchsia-500"
                          style={{ height: `${pct}%`, minHeight: n > 0 ? '6px' : '2px', opacity: n > 0 ? 1 : 0.2 }}
                        />
                      </div>
                      <p className="text-[11px] font-bold text-slate-500">{label}</p>
                      <p className="text-[10px] text-slate-400 -mt-1">{n}</p>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* Footer actions */}
          <div className="pt-2 space-y-2">
            <p className="text-[11px] text-slate-400 text-center">
              {lastAnalyzed ? `Última actualización: ${lastAnalyzed}` : ''}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 text-slate-700 text-[12.5px] font-semibold disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">refresh</span>
                {analyzing ? 'Analizando…' : 'Actualizar ahora'}
              </button>
              <button
                onClick={handleClear}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-red-100 text-red-500 text-[12.5px] font-semibold hover:bg-red-50 transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">delete_sweep</span>
                Borrar lo aprendido
              </button>
            </div>
            <p className="text-[10.5px] text-slate-400 text-center leading-snug max-w-md mx-auto pt-1">
              Tus señales y el modelo son privados — solo tu sesión autenticada los ve.
              Borrarlos no afecta tus eventos, tareas ni sugerencias.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

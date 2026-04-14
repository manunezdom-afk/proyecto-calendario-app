import { useState, useEffect } from 'react'
import QuickAddSheet    from '../components/QuickAddSheet'
import FocusTimerOverlay from '../components/FocusTimerOverlay'
import ProfileSetupCard from '../components/ProfileSetupCard'
import { useUserProfile } from '../hooks/useUserProfile'

// ── Helpers ────────────────────────────────────────────────────────────────
const DAY_NAMES_ES   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

function formatToday() {
  const d = new Date()
  return `${DAY_NAMES_ES[d.getDay()]}, ${d.getDate()} de ${MONTH_NAMES_ES[d.getMonth()]}`
}

function currentHour() {
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}

// ── Seed timeline blocks ───────────────────────────────────────────────────
const SEED_BLOCKS = [
  { id: 'blk-001', time: '09:00', type: 'confirmed', title: 'Trabajo Profundo: Arquitectura del Sistema',   description: 'Bloque de máxima concentración. Sin interrupciones.' },
  { id: 'blk-002', time: '10:30', type: 'suggestion', title: 'Descanso Inteligente: Meditación de 15 min', description: 'Carga cognitiva alta detectada. Recarga para la sincro de las 11:00.' },
  { id: 'blk-003', time: '11:00', type: 'confirmed', title: 'Sincro con el Equipo de Producto',             description: null },
  { id: 'blk-004', time: '12:30', type: 'suggestion', title: 'Sugerido: Inbox Zero (20 min)',               description: 'Tienes mensajes urgentes sin leer.' },
]

const STORAGE_KEY = 'focus_planner_blocks'

// ── Lógica de insights personalizados ─────────────────────────────────────
function buildInsights(events, profile) {
  const todayISO = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  })()

  const todayEvents = events.filter((e) => !e.date || e.date === todayISO)
  const eveningCount = todayEvents.filter((e) => e.section === 'evening').length
  const meetingCount = todayEvents.filter((e) =>
    /reuni[oó]n|meeting|llamada|call|sincro|junta/i.test(e.title)
  ).length
  const h = currentHour()

  const { role, chronotype, peakStart } = profile
  const roleLabel = { student: 'estudiar', worker: 'trabajar', freelance: 'producir', other: 'concentrarte' }[role] ?? 'concentrarte'

  const insights = []

  // Insight 1: basado en cantidad de reuniones
  if (meetingCount >= 3) {
    insights.push({
      color: 'text-amber-600',
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      icon: 'groups',
      label: 'REUNIONES',
      text: `${meetingCount} reuniones hoy. Bloquea al menos 30 min de recuperación entre ellas para mantener el foco.`,
    })
  } else if (meetingCount > 0) {
    insights.push({
      color: 'text-primary',
      bg: 'bg-primary/5',
      icon: 'groups',
      label: 'AGENDA',
      text: `${meetingCount} reunión${meetingCount > 1 ? 'es' : ''} programada${meetingCount > 1 ? 's' : ''}. Prepara los puntos clave antes de entrar.`,
    })
  }

  // Insight 2: carga de tarde
  if (eveningCount >= 2) {
    insights.push({
      color: 'text-secondary',
      bg: 'bg-secondary/5',
      icon: 'nights_stay',
      label: 'TARDE OCUPADA',
      text: 'Tu tarde está cargada. Resuelve lo urgente antes del mediodía para llegar sin presión.',
    })
  }

  // Insight 3: agenda vacía
  if (todayEvents.length === 0) {
    insights.push({
      color: 'text-primary',
      bg: 'bg-primary/5',
      icon: 'spa',
      label: 'ESPACIO LIBRE',
      text: `Sin eventos agendados. Día ideal para ${roleLabel} profundo sin interrupciones. Usa Time Blocking.`,
    })
  } else if (todayEvents.length <= 2) {
    insights.push({
      color: 'text-primary',
      bg: 'bg-primary/5',
      icon: 'self_improvement',
      label: 'AGENDA LIGERA',
      text: `Pocos eventos hoy. Aprovecha los bloques libres para ${roleLabel} con máxima concentración.`,
    })
  }

  // Insight 4: cronobio + hora actual
  if (chronotype === 'night' && h < 13) {
    insights.push({
      color: 'text-outline',
      bg: 'bg-surface-container-low',
      icon: 'bedtime',
      label: 'TU MOMENTO',
      text: 'Aún no es tu pico de energía. Haz tareas rutinarias ahora y guarda lo difícil para la noche.',
    })
  } else if (chronotype === 'morning' && h > 14) {
    insights.push({
      color: 'text-outline',
      bg: 'bg-surface-container-low',
      icon: 'wb_twilight',
      label: 'TU MOMENTO',
      text: 'Tu pico de mañana ya pasó. Es buen momento para reuniones, correos y tareas más ligeras.',
    })
  }

  // Insight 5: tip según rol
  if (role === 'student') {
    insights.push({
      color: 'text-secondary',
      bg: 'bg-secondary/5',
      icon: 'timer',
      label: 'TÉCNICA',
      text: 'Pomodoro activo: 25 min de estudio sin distracciones → 5 min de descanso. La ciencia lo respalda.',
    })
  } else {
    insights.push({
      color: 'text-primary',
      bg: 'bg-primary/5',
      icon: 'tips_and_updates',
      label: 'TIME BLOCKING',
      text: 'Divide tu día en bloques dedicados. Los estudios muestran hasta un 80% más de productividad frente a listas de tareas.',
    })
  }

  // Devolver los 2 más relevantes (los primeros que se acumularon)
  return insights.slice(0, 2)
}

// ── Componente ─────────────────────────────────────────────────────────────
export default function PlannerView({ onAddEvent, events = [] }) {
  const [blocks, setBlocks] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return SEED_BLOCKS
  })
  const [showModal, setShowModal]         = useState(false)
  const [activeTimerBlock, setActiveTimerBlock] = useState(null)

  const { profile, saveProfile, snoozeSetup, showSetup } = useUserProfile()

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks))
  }, [blocks])

  function acceptSuggestion(id) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, type: 'confirmed' } : b)))
  }

  function dismissBlock(id) {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  function handleModalSave(formData) {
    if (onAddEvent) onAddEvent(formData)
    setBlocks((prev) => [...prev, {
      id: `blk-${Date.now()}`,
      time: formData.time || '—',
      type: 'confirmed',
      title: formData.title,
      description: formData.description || null,
    }])
    setShowModal(false)
  }

  // ── Datos personalizados ─────────────────────────────────────────────────
  const peakStart = profile.peakStart ?? 9
  const peakEnd   = profile.peakEnd   ?? 11.5
  const inPeak    = currentHour() >= peakStart && currentHour() < peakEnd

  const confirmedCount  = blocks.filter((b) => b.type === 'confirmed').length
  const suggestionCount = blocks.filter((b) => b.type === 'suggestion').length

  const insights = buildInsights(events, profile)

  const peakLabel = (() => {
    const startH = Math.floor(peakStart)
    const startM = Math.round((peakStart % 1) * 60)
    const endH   = Math.floor(peakEnd)
    const endM   = Math.round((peakEnd % 1) * 60)
    return `${startH}:${String(startM).padStart(2,'0')} – ${endH}:${String(endM).padStart(2,'0')}`
  })()

  const chronoLabel = { morning: 'mañanero', afternoon: 'vespertino', night: 'nocturno' }[profile.chronotype] ?? ''

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen pb-32 dark:bg-slate-900 dark:text-slate-100">

      {/* Setup card */}
      {showSetup && (
        <ProfileSetupCard onSave={saveProfile} onSnooze={snoozeSetup} />
      )}

      <main className="max-w-7xl mx-auto px-6 pt-8">
        <div className="flex flex-col md:flex-row gap-12">

          {/* ── Left: Timeline ────────────────────────────────────────────── */}
          <div className="flex-1">
            <header className="mb-10 flex justify-between items-end">
              <div>
                <p className="text-primary font-semibold tracking-wider text-xs uppercase mb-2">
                  {formatToday()}
                </p>
                <h2 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">
                  Mi Día
                </h2>
              </div>
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1 text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Añadir bloque
              </button>
            </header>

            <div className="relative space-y-2">
              {blocks.map(({ id, time, type, title, description }) => {
                const isSuggestion = type === 'suggestion'
                return (
                  <div key={id} className="flex gap-6 group">
                    <div className="w-16 pt-2 text-right flex-shrink-0">
                      <span className={`text-sm font-semibold tracking-tighter ${isSuggestion ? 'text-outline/40 italic' : 'text-outline'}`}>
                        {time}
                      </span>
                    </div>
                    <div className="relative flex-1 pb-8">
                      <div className={`absolute left-[-25px] top-4 w-2 h-2 rounded-full ring-4 ring-surface ${isSuggestion ? 'bg-secondary' : 'bg-primary'}`} />
                      <div
                        className={`p-5 rounded-xl ${
                          isSuggestion
                            ? 'bg-surface-container-low/50 border border-dashed border-secondary/30'
                            : 'bg-surface-container-lowest shadow-[0_12px_32px_rgba(27,27,29,0.04)] border-l-4 border-primary cursor-pointer hover:shadow-md transition-shadow'
                        }`}
                        onClick={!isSuggestion ? () => setActiveTimerBlock({ id, time, type, title, description }) : undefined}
                      >
                        <div className="flex justify-between items-start mb-1 gap-3">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <h3 className={`font-bold flex-1 ${isSuggestion ? 'text-secondary' : 'text-on-surface'}`}>
                              {title}
                            </h3>
                            {!isSuggestion && (
                              <span className="material-symbols-outlined text-outline/40 text-[16px] flex-shrink-0">timer</span>
                            )}
                          </div>
                          {isSuggestion ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); acceptSuggestion(id) }}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-secondary/20 hover:bg-secondary/10 text-secondary transition-colors flex-shrink-0"
                            >
                              ACEPTAR
                            </button>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); dismissBlock(id) }}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-error/10 hover:text-error transition-colors flex-shrink-0"
                            >
                              HECHO ✓
                            </button>
                          )}
                        </div>
                        {description && (
                          <p className={`text-sm leading-relaxed ${isSuggestion ? 'italic text-on-surface-variant/70' : 'text-on-surface-variant'}`}>
                            {description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}

              {blocks.length === 0 && (
                <div className="flex gap-6">
                  <div className="w-16" />
                  <div className="flex-1 bg-surface-container-low rounded-xl p-8 text-center">
                    <p className="text-outline text-sm font-semibold">Todos los bloques completados. Añade uno nuevo.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Insights personalizados ────────────────────────────── */}
          <div className="w-full md:w-80 space-y-5">

            {/* Energy peak card — personalizado */}
            <div className={`p-6 rounded-[24px] ${inPeak ? 'bg-primary text-white' : 'bg-surface-container-high/40 backdrop-blur-sm'}`}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`material-symbols-outlined ${inPeak ? 'text-white' : 'text-amber-500'}`}
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  {inPeak ? 'bolt' : 'brightness_high'}
                </span>
                <h4 className={`font-headline font-bold ${inPeak ? 'text-white' : 'text-on-surface'}`}>
                  {inPeak ? '¡Estás en tu pico!' : 'Pico de Energía'}
                </h4>
                {chronoLabel && !inPeak && (
                  <span className="ml-auto text-[10px] font-bold text-outline uppercase tracking-wider">{chronoLabel}</span>
                )}
              </div>
              <p className={`text-sm font-medium leading-relaxed ${inPeak ? 'text-white/80' : 'text-on-surface-variant'}`}>
                {inPeak
                  ? `Ahora mismo es tu mejor ventana${chronoLabel ? ` (perfil ${chronoLabel})` : ''}. Prioriza trabajo profundo sin interrupciones.`
                  : `Tu ventana de máxima concentración es de ${peakLabel}.${profile.setupDone ? '' : ' Personalízala respondiendo las 2 preguntas de arriba.'}`}
              </p>
            </div>

            {/* AI Insights — dinámicos y personalizados */}
            <div className="bg-surface-container-high/40 p-5 rounded-[24px] backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-4">
                <span
                  className="material-symbols-outlined text-secondary text-[20px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  auto_awesome
                </span>
                <h4 className="font-headline font-bold text-on-surface">
                  {profile.setupDone ? 'Tu resumen' : 'Resumen IA'}
                </h4>
              </div>

              <div className="space-y-2.5">
                {/* Conteo de bloques */}
                <div className="p-3.5 bg-surface-container-lowest rounded-xl">
                  <p className="text-[10px] font-bold text-primary mb-1 uppercase tracking-tight">HOY</p>
                  <p className="text-sm text-on-surface-variant font-medium">
                    {confirmedCount} bloque{confirmedCount !== 1 ? 's' : ''} confirmado{confirmedCount !== 1 ? 's' : ''}
                    {suggestionCount > 0 ? ` · ${suggestionCount} sugerencia${suggestionCount !== 1 ? 's' : ''} pendiente${suggestionCount !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>

                {/* Insights personalizados */}
                {insights.map((ins, i) => (
                  <div key={i} className={`p-3.5 ${ins.bg} rounded-xl`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className={`material-symbols-outlined ${ins.color} text-[14px]`}
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        {ins.icon}
                      </span>
                      <p className={`text-[10px] font-bold ${ins.color} uppercase tracking-tight`}>{ins.label}</p>
                    </div>
                    <p className="text-sm text-on-surface-variant font-medium leading-snug">{ins.text}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* FAB */}
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-28 right-6 w-14 h-14 bg-primary text-white rounded-2xl shadow-2xl flex items-center justify-center hover:scale-105 active:scale-90 transition-transform z-40"
        title="Añadir bloque"
      >
        <span className="material-symbols-outlined text-3xl">add</span>
      </button>

      {showModal && (
        <QuickAddSheet onSave={handleModalSave} onCancel={() => setShowModal(false)} />
      )}

      {activeTimerBlock && (
        <FocusTimerOverlay
          block={activeTimerBlock}
          onClose={() => setActiveTimerBlock(null)}
          onComplete={() => { dismissBlock(activeTimerBlock.id); setActiveTimerBlock(null) }}
        />
      )}
    </div>
  )
}

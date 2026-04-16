import { useState, useEffect } from 'react'
import QuickAddSheet     from '../components/QuickAddSheet'
import FocusTimerOverlay from '../components/FocusTimerOverlay'
import ProfileSetupCard  from '../components/ProfileSetupCard'
import FocusBar          from '../components/FocusBar'
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

function parseTimeToDecimal(timeStr) {
  if (!timeStr || timeStr === '—') return null
  const [h, m] = timeStr.split(':').map(Number)
  if (isNaN(h)) return null
  return h + m / 60
}

function formatMinutes(totalMinutes) {
  if (totalMinutes < 1) return 'ahora'
  if (totalMinutes < 60) return `${Math.round(totalMinutes)} min`
  const h = Math.floor(totalMinutes / 60)
  const m = Math.round(totalMinutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function todayISODate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function eventTimeToBlockTime(timeStr) {
  // Accepts: "3:00 PM", "2:00 PM - 3:30 PM", "15:00", "09:00"
  if (!timeStr) return '—'
  const first = String(timeStr).split('-')[0].trim()
  // 24h "HH:mm"
  const m24 = first.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const hh = Math.max(0, Math.min(23, Number(m24[1])))
    const mm = Math.max(0, Math.min(59, Number(m24[2])))
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  // 12h "h:mm AM/PM"
  const m12 = first.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (m12) {
    let hh = Number(m12[1])
    const mm = Number(m12[2] ?? '00')
    const ap = m12[3].toUpperCase()
    if (hh === 12) hh = 0
    if (ap === 'PM') hh += 12
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  return '—'
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
export default function PlannerView({ onAddEvent, onEditEvent, onDeleteEvent, events = [] }) {
  const [blocks, setBlocks] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return SEED_BLOCKS
  })
  const [showModal, setShowModal]         = useState(false)
  const [activeTimerBlock, setActiveTimerBlock] = useState(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const { profile, saveProfile, snoozeSetup, showSetup } = useUserProfile()

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks))
  }, [blocks])

  // Sincroniza "Mi Día" (timeline) con eventos de HOY para reflejar cambios inmediatos
  useEffect(() => {
    const todayISO = todayISODate()
    const todayEvents = (events || []).filter((e) => !e.date || e.date === todayISO)
    setBlocks((prev) => {
      const prevArr = Array.isArray(prev) ? prev : []
      const hasEvent = new Set(prevArr.map((b) => b?.eventId).filter(Boolean))
      const nextBlocksToAdd = []

      for (const ev of todayEvents) {
        if (!ev?.id) continue
        if (hasEvent.has(ev.id)) continue
        nextBlocksToAdd.push({
          id: `blk-ev-${ev.id}`,
          eventId: ev.id,
          time: eventTimeToBlockTime(ev.time),
          type: 'confirmed',
          title: ev.title,
          description: ev.description || null,
        })
      }

      if (nextBlocksToAdd.length === 0) return prevArr
      return [...prevArr, ...nextBlocksToAdd]
    })
  }, [events])

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
  const confirmedCount  = blocks.filter((b) => b.type === 'confirmed').length
  const suggestionCount = blocks.filter((b) => b.type === 'suggestion').length
  const completedCount  = blocks.filter((b) => b.type === 'done').length
  const totalBlocks     = blocks.length
  const blockProgress   = totalBlocks > 0 ? completedCount / totalBlocks : 0

  const topInsight = buildInsights(events, profile)[0] ?? null

  // ── Card 1: Próximo Bloque ────────────────────────────────────────────────
  const DAY_START_H = 8
  const DAY_END_H   = 22
  const now = currentHour()

  const blocksWithDecimal = blocks
    .map((b) => ({ ...b, _h: parseTimeToDecimal(b.time) }))
    .filter((b) => b._h !== null)
    .sort((a, b) => a._h - b._h)

  const activeBlock = (() => {
    for (let i = 0; i < blocksWithDecimal.length; i++) {
      const b = blocksWithDecimal[i]
      const nextH = blocksWithDecimal[i + 1]?._h ?? (b._h + 1)
      if (now >= b._h && now < nextH) return b
    }
    return null
  })()

  const nextBlock   = blocksWithDecimal.find((b) => b._h > now) ?? null
  const minsToNext  = nextBlock   ? (nextBlock._h   - now) * 60 : null
  const minsElapsed = activeBlock ? (now - activeBlock._h) * 60 : null
  const dayProgress = Math.min(1, Math.max(0, (now - DAY_START_H) / (DAY_END_H - DAY_START_H)))

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen pb-52 dark:bg-slate-900 dark:text-slate-100">

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

            <FocusBar
              onAddEvent={onAddEvent}
              onEditEvent={onEditEvent}
              onDeleteEvent={onDeleteEvent}
              events={events}
              inline
            />

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

            {/* ── Card 1: Próximo Bloque ────────────────────────────────── */}
            <div className="bg-surface-container-high/40 backdrop-blur-sm rounded-[24px] p-6 space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="material-symbols-outlined text-primary text-[20px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    {activeBlock ? 'play_circle' : 'schedule'}
                  </span>
                  <h4 className="font-headline font-bold text-on-surface">
                    {activeBlock ? 'En Curso' : 'Próximo Bloque'}
                  </h4>
                </div>
                {activeBlock && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wider">
                    ACTIVO
                  </span>
                )}
              </div>

              {/* Contenido dinámico */}
              {activeBlock ? (
                <div>
                  <p className="text-xs font-semibold text-outline uppercase tracking-wider mb-1">{activeBlock.time}</p>
                  <p className="font-headline font-bold text-on-surface text-[17px] leading-snug mb-3">{activeBlock.title}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold font-headline text-primary tabular-nums">{Math.round(minsElapsed)}</span>
                    <span className="text-sm font-semibold text-outline">min transcurridos</span>
                  </div>
                </div>
              ) : nextBlock ? (
                <div>
                  <p className="text-xs font-semibold text-outline uppercase tracking-wider mb-1">{nextBlock.time}</p>
                  <p className="font-headline font-bold text-on-surface text-[17px] leading-snug mb-3">{nextBlock.title}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold font-headline text-primary tabular-nums">{formatMinutes(minsToNext)}</span>
                    {minsToNext >= 1 && <span className="text-sm font-semibold text-outline">para empezar</span>}
                  </div>
                </div>
              ) : (
                <div className="text-center py-2">
                  <span
                    className="material-symbols-outlined text-outline/40 text-[36px] block mb-2"
                    style={{ fontVariationSettings: "'FILL' 0" }}
                  >check_circle</span>
                  <p className="text-sm font-semibold text-outline">Sin bloques pendientes.</p>
                  <p className="text-xs text-outline/60 mt-0.5">Añade uno para comenzar el día.</p>
                </div>
              )}

              {/* Barra de progreso del día */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-outline uppercase tracking-wider">Progreso del día</span>
                  <span className="text-[10px] font-bold text-outline tabular-nums">{Math.round(dayProgress * 100)}%</span>
                </div>
                <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-700"
                    style={{ width: `${dayProgress * 100}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-outline/50">8:00</span>
                  <span className="text-[10px] text-outline/50">22:00</span>
                </div>
              </div>
            </div>

            {/* ── Card 2: Tu Día ────────────────────────────────────────── */}
            <div className="bg-surface-container-high/40 backdrop-blur-sm rounded-[24px] p-5 space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h4 className="font-headline font-bold text-on-surface">Tu Día</h4>
                <span className="text-[10px] font-bold text-outline uppercase tracking-wider">HOY</span>
              </div>

              {/* 3 métricas en grid */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-surface-container-lowest rounded-2xl p-3 text-center">
                  <p className="text-2xl font-extrabold font-headline text-primary tabular-nums">{confirmedCount}</p>
                  <p className="text-[10px] font-semibold text-outline mt-0.5 leading-tight">Confirmados</p>
                </div>
                <div className="bg-surface-container-lowest rounded-2xl p-3 text-center">
                  <p className="text-2xl font-extrabold font-headline text-secondary tabular-nums">{suggestionCount}</p>
                  <p className="text-[10px] font-semibold text-outline mt-0.5 leading-tight">Pendientes</p>
                </div>
                <div className="bg-surface-container-lowest rounded-2xl p-3 text-center">
                  <p className="text-2xl font-extrabold font-headline text-on-surface-variant tabular-nums">{completedCount}</p>
                  <p className="text-[10px] font-semibold text-outline mt-0.5 leading-tight">Completados</p>
                </div>
              </div>

              {/* Barra de bloques completados */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-outline uppercase tracking-wider">Bloques completados</span>
                  <span className="text-[10px] font-bold text-outline tabular-nums">{completedCount}/{totalBlocks}</span>
                </div>
                <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className="h-full bg-secondary rounded-full transition-all duration-500"
                    style={{ width: `${blockProgress * 100}%` }}
                  />
                </div>
              </div>

              {/* 1 insight prominente */}
              {topInsight && (
                <div className={`p-4 ${topInsight.bg} rounded-2xl`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={`material-symbols-outlined ${topInsight.color} text-[18px]`}
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >{topInsight.icon}</span>
                    <p className={`text-[10px] font-bold ${topInsight.color} uppercase tracking-widest`}>{topInsight.label}</p>
                  </div>
                  <p className="text-sm text-on-surface-variant font-medium leading-snug">{topInsight.text}</p>
                </div>
              )}
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

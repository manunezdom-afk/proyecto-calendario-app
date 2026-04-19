import { useState, useEffect } from 'react'
import QuickAddSheet     from '../components/QuickAddSheet'
import FocusTimerOverlay from '../components/FocusTimerOverlay'
import FocusBar          from '../components/FocusBar'
import MorningBrief      from '../components/MorningBrief'
import { useUserProfile } from '../hooks/useUserProfile'
import { isInPeak, parseEventHour, peakRangeLabel } from '../utils/peakZone'
import { todayISO, weekdayName, monthName } from '../utils/dateHelpers'

// ── Helpers ────────────────────────────────────────────────────────────────
// Nombres de días/meses vienen de Intl.DateTimeFormat (dateHelpers.js)
// para no hardcodear arrays en español y permitir i18n futuro.
function formatToday() {
  const d = new Date()
  const day = weekdayName(d)
  // Capitalizamos para que "lunes" → "Lunes"
  const dayCap = day.charAt(0).toUpperCase() + day.slice(1)
  return `${dayCap}, ${d.getDate()} de ${monthName(d)}`
}

function currentHour() {
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}

// Parser simple (HH:MM 24h) usado por el render. Para parseo coloquial
// completo hay parseTimeToDecimal en utils/dateHelpers.js — aquí solo
// necesitamos interpretar los horarios normalizados del grid.
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

// Alias mantenido por compatibilidad con el resto del archivo.
const todayISODate = todayISO

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

function normalizeTitleKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractReminderMeta(title) {
  const t = String(title || '').trim()
  // Common patterns:
  // - "Recordatorio: Clases de Historia"
  // - "Clases de Historia — recordatorio"
  // - "Clases de Historia (recordatorio 10 min)"
  // - "Clases de Historia en 10 minutos"
  const m1 = t.match(/^recordatorio:\s*(.+)$/i)
  if (m1) return { isReminder: true, parentTitle: m1[1].trim(), label: 'Recordatorio' }

  const m2 = t.match(/^(.+?)\s*(?:—|-)\s*recordatorio\b.*$/i)
  if (m2) return { isReminder: true, parentTitle: m2[1].trim(), label: 'Recordatorio' }

  const m3 = t.match(/^(.+?)\s*\((?:.*\brecordatorio\b.*)\)\s*$/i)
  if (m3) {
    const inside = t.replace(m3[1], '').trim().replace(/^\(|\)$/g, '').trim()
    return { isReminder: true, parentTitle: m3[1].trim(), label: inside || 'Recordatorio' }
  }

  const m4 = t.match(/^(.+?)\s+en\s+(?:10|30|60)\s+minutos\b/i)
  if (m4) return { isReminder: true, parentTitle: m4[1].trim(), label: t.slice(m4[1].length).trim() }

  if (/\b(recordatorio|reminder)\b/i.test(t)) {
    // Fallback: try stripping the keyword and using the rest
    const guessParent = t
      .replace(/\b(recordatorio|reminder)\b/ig, '')
      .replace(/[()—-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return { isReminder: true, parentTitle: guessParent || t, label: 'Recordatorio' }
  }

  return { isReminder: false, parentTitle: '', label: '' }
}

function titleTokenSet(title) {
  const cleaned = normalizeTitleKey(title)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = cleaned.split(' ').filter(Boolean)
  // remove very common stop-words to improve similarity signal
  const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'en', 'para', 'por', 'con', 'un', 'una'])
  return new Set(tokens.filter((t) => t.length > 2 && !STOP.has(t)))
}

function jaccard(a, b) {
  if (!a?.size || !b?.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function looksLikeReminderTitle(title) {
  const t = normalizeTitleKey(title)
  // Imperative / checklist-like reminders often created as short standalone events.
  // Examples: "Recordar enviar mail", "Check presentación", "Revisar notas", etc.
  if (/^(recordar|recuerda|remember|check|revisar|enviar|llamar|pagar|comprar|hacer|preparar|confirmar|agendar)\b/.test(t)) return true
  if (/\b(recordatorio|reminder)\b/.test(t)) return true
  if (/^todo\b/.test(t)) return true
  return false
}

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
export default function PlannerView({ onAddEvent, onEditEvent, onDeleteEvent, events = [], tasks = [], onOpenAssistant, onEveningShutdown, isDesktop = false, morningBrief = null }) {
  const [blocks, setBlocks] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return []
  })
  const [showModal, setShowModal]         = useState(false)
  const [activeTimerBlock, setActiveTimerBlock] = useState(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const { profile } = useUserProfile()
  const semanaCount  = tasks.filter((t) => t.category === 'semana'    && !t.done).length
  const algoDiaCount = tasks.filter((t) => t.category === 'algún día' && !t.done).length

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

  // Heurística "Google Calendar": recordatorios como eventos cortos anidados (UI-only)
  const displayBlocks = (() => {
    const arrRaw = Array.isArray(blocks) ? blocks : []
    const arr = arrRaw.map((b, originalIndex) => ({ ...b, _orig: originalIndex, _h: parseTimeToDecimal(b?.time) }))
      .sort((a, b) => {
        const ah = a._h ?? Number.POSITIVE_INFINITY
        const bh = b._h ?? Number.POSITIVE_INFINITY
        if (ah !== bh) return ah - bh
        return (a._orig ?? 0) - (b._orig ?? 0)
      })

    const order = []
    const byTitle = new Map()
    const byComposite = new Map()
    const pendingReminders = [] // reminders seen before their parent is created

    const pushUniqueSubtask = (parent, sub) => {
      if (!parent) return
      if (!Array.isArray(parent.subtasks)) parent.subtasks = []
      const key = normalizeTitleKey(`${sub.label} ${sub.text}`)
      if (parent.subtasks.some((s) => normalizeTitleKey(`${s.label} ${s.text}`) === key)) return
      parent.subtasks.push(sub)
    }

    // 1) Build main blocks, unify duplicates
    for (const b of arr) {
      const meta = extractReminderMeta(b?.title)
      const isReminder = meta.isReminder || looksLikeReminderTitle(b?.title)
      if (isReminder) {
        pendingReminders.push({ b, meta })
        continue
      }

      const titleKey = normalizeTitleKey(b?.title || b?.id)
      const compositeKey = `${titleKey}|${String(b?.time || '—').trim()}`

      if (byComposite.has(compositeKey)) {
        const existing = byComposite.get(compositeKey)
        // unify description when missing
        if (!existing.description && b?.description) existing.description = b.description
        continue
      }

      const entry = { ...b, subtasks: [], _asReminderOnly: false }
      byTitle.set(titleKey, entry)
      byComposite.set(compositeKey, entry)
      order.push(entry)
    }

    // Helper: find next plausible parent by time proximity and similarity
    const findNextParent = (reminderBlock) => {
      const rh = reminderBlock?._h
      if (rh === null || rh === undefined) return null
      const rTokens = titleTokenSet(reminderBlock?.title)
      for (const candidate of order) {
        const ch = parseTimeToDecimal(candidate?.time)
        if (ch === null || ch === undefined) continue
        const deltaMin = (ch - rh) * 60
        if (deltaMin < 0) continue
        if (deltaMin > 60) break
        const sim = jaccard(rTokens, titleTokenSet(candidate?.title))
        if (sim >= 0.55) return candidate
      }
      return null
    }

    // 2) Attach reminders (explicit "Recordatorio: X" or heuristics)
    for (const { b, meta } of pendingReminders) {
      const explicit = meta?.isReminder
      let parent = null

      if (explicit && meta.parentTitle) {
        parent = byTitle.get(normalizeTitleKey(meta.parentTitle)) || null
      }

      if (!parent) {
        // Heuristic: attach to the next similar event within 60 minutes
        parent = findNextParent(b)
      }

      const label =
        explicit ? (meta.label || 'Recordatorio')
        : (looksLikeReminderTitle(b?.title) ? 'Subtarea' : 'Recordatorio')

      const sub = {
        id: b?.id || `sub-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        label,
        text: (b?.description || '').trim() || String(b?.title || '').trim(),
      }

      if (parent) {
        pushUniqueSubtask(parent, sub)
      } else {
        // No parent found: render as small reminder-only card (still not a big block)
        order.push({ ...b, _asReminderOnly: true, subtasks: [sub] })
      }
    }

    return order
  })()

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen pb-52 dark:bg-slate-900 dark:text-slate-100">

      {/* Setup card legacy — reemplazado por OnboardingTour animado.
          El sistema de user_signals aprende el cronotipo solo, sin preguntar. */}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-8">
        <div className={isDesktop ? "flex flex-col gap-6" : "flex flex-col md:flex-row gap-12"}>

          {/* ── Left: Timeline ────────────────────────────────────────────── */}
          <div className="flex-1">
            {isDesktop && morningBrief && (
              <div className="mb-6">
                <MorningBrief inline {...morningBrief} />
              </div>
            )}
            <header className="mb-10">
              <p className="text-primary font-semibold tracking-wider text-xs uppercase mb-2">
                {formatToday()}
              </p>
              <h2 className="text-4xl font-headline font-extrabold tracking-tight text-on-surface">
                Mi Día
              </h2>
            </header>

            <FocusBar
              onAddEvent={onAddEvent}
              onEditEvent={onEditEvent}
              onDeleteEvent={onDeleteEvent}
              events={events}
              inline
            />

            {/* ── Shield: eventos que interrumpen la zona de rendimiento ─── */}
            {(() => {
              if (!profile.peakStart) return null
              const intruders = displayBlocks.filter(b => {
                if (b.type === 'suggestion' || b._asReminderOnly) return false
                const h = parseEventHour(b.time)
                if (h === null) return false
                if (h < profile.peakStart || h >= profile.peakEnd) return false
                return /reuni[oó]n|meeting|llamada|call|sincro|junta|clase|lecture|training/i.test(b.title)
              })
              if (intruders.length === 0) return null
              return (
                <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-amber-600 text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>shield</span>
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">Zona de Rendimiento en riesgo</p>
                  </div>
                  <p className="text-sm text-amber-800 leading-snug mb-2">
                    {intruders.length === 1
                      ? <><strong>"{intruders[0].title}"</strong> está en tu zona de rendimiento ({peakRangeLabel(profile.peakStart, profile.peakEnd)}). Considera moverlo fuera de ese horario.</>
                      : <><strong>{intruders.length} eventos</strong> interrumpen tu zona de rendimiento ({peakRangeLabel(profile.peakStart, profile.peakEnd)}). Protege ese tiempo para trabajo profundo.</>
                    }
                  </p>
                  {onOpenAssistant && (
                    <button
                      onClick={onOpenAssistant}
                      className="flex items-center gap-1 text-xs font-bold text-primary hover:bg-primary/10 px-2 py-1 rounded-full transition-colors"
                    >
                      <span className="material-symbols-outlined text-[13px]">auto_awesome</span>
                      Pedirle a Nova que proponga un horario
                    </button>
                  )}
                </div>
              )
            })()}

            <div className="relative space-y-2">
              {displayBlocks.map(({ id, time, type, title, description, subtasks = [], _asReminderOnly }) => {
                const isSuggestion = type === 'suggestion'
                const inPeak = !isSuggestion && profile.peakStart != null
                  ? isInPeak(time, profile.peakStart, profile.peakEnd)
                  : null
                return (
                  <div key={id} style={{ display: 'flex', gap: '24px', overflow: 'visible' }} className="group">
                    {/* Columna de hora — nunca se comprime */}
                    <div style={{ flexShrink: 0, width: '52px', paddingTop: '8px', textAlign: 'right', overflow: 'visible' }}>
                      <span
                        style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                        className={`text-[13px] font-semibold ${isSuggestion ? 'text-outline/40 italic' : 'text-outline'}`}
                      >
                        {time}
                      </span>
                    </div>

                    {/* Columna de tarjeta */}
                    <div style={{ flex: 1, minWidth: 0, position: 'relative', paddingBottom: '32px' }}>
                      <div className={`absolute top-4 w-2 h-2 rounded-full ring-4 ring-surface ${isSuggestion ? 'bg-secondary' : 'bg-primary'}`}
                        style={{ left: '-21px' }} />
                      <div
                        className={`rounded-xl ${
                          isSuggestion
                            ? 'bg-surface-container-low/50 border border-dashed border-secondary/30'
                            : 'bg-surface-container-lowest shadow-[0_12px_32px_rgba(27,27,29,0.04)] border-l-4 border-primary cursor-pointer hover:shadow-md transition-shadow'
                        }`}
                        style={{ padding: '14px 16px 14px 14px', overflow: 'visible' }}
                        onClick={!isSuggestion && !_asReminderOnly ? () => setActiveTimerBlock({ id, time, type, title, description }) : undefined}
                      >
                        <div className="flex justify-between items-start gap-2" style={{ marginBottom: '2px' }}>
                          <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 0 }}>
                            <h3 className={`font-bold ${isSuggestion ? 'text-secondary' : 'text-on-surface'}`}
                              style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {title}
                            </h3>
                            {!isSuggestion && !_asReminderOnly && (
                              <span className="material-symbols-outlined text-outline/40 text-[16px]" style={{ flexShrink: 0 }}>timer</span>
                            )}
                          </div>
                          {isSuggestion ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); acceptSuggestion(id) }}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-secondary/20 hover:bg-secondary/10 text-secondary transition-colors"
                              style={{ flexShrink: 0 }}
                            >
                              ACEPTAR
                            </button>
                          ) : _asReminderOnly ? null : (
                            <button
                              onClick={(e) => { e.stopPropagation(); dismissBlock(id) }}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-error/10 hover:text-error transition-colors"
                              style={{ flexShrink: 0 }}
                            >
                              HECHO ✓
                            </button>
                          )}
                        </div>

                        {/* Badge zona de rendimiento */}
                        {inPeak !== null && (
                          <div style={{ marginTop: '6px', marginBottom: '2px' }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              fontSize: '9px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
                              ...(inPeak
                                ? { background: '#d1fae5', color: '#065f46' }
                                : { background: '#fef9c3', color: '#92400e' })
                            }}>
                              {inPeak ? '🟢' : '🟡'}
                              {inPeak ? 'En tu zona de rendimiento' : 'Fuera de tu zona de rendimiento'}
                            </span>
                          </div>
                        )}

                        {subtasks.length > 0 && (
                          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {subtasks.map((s) => (
                              <div
                                key={s.id}
                                style={{
                                  marginTop: '0px',
                                  paddingLeft: '12px',
                                  paddingRight: '10px',
                                  paddingTop: '5px',
                                  paddingBottom: '5px',
                                  background: '#f8fafc',
                                  borderRadius: '6px',
                                  borderLeft: '2px solid #e2e8f0',
                                }}
                              >
                                <p style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', marginBottom: '1px' }}>
                                  {s.label}
                                </p>
                                <p style={{ fontSize: '11px', lineHeight: '1.4', color: '#64748b' }}>
                                  {s.text}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

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

              {blocks.length === 0 && (() => {
                const pendingTotal = semanaCount + algoDiaCount
                // Ghost events: previews no-interactivos que desaparecen en
                // cuanto el usuario crea su primer evento real. Visibles solo
                // cuando blocks.length === 0.
                const GHOSTS = [
                  { time: '09:00', title: 'Reunión de equipo',   icon: 'groups',        color: 'bg-blue-500' },
                  { time: '10:30', title: 'Foco profundo',       icon: 'bolt',          color: 'bg-violet-500' },
                  { time: '13:00', title: 'Almuerzo',            icon: 'restaurant',    color: 'bg-emerald-500' },
                  { time: '18:00', title: 'Gym',                 icon: 'fitness_center',color: 'bg-rose-500' },
                ]
                return (
                  <>
                    <div className="flex gap-6">
                      <div className="w-16" />
                      <div className="flex-1 bg-surface-container-low rounded-xl p-6 space-y-3">
                        <p className="text-outline text-sm font-semibold">Tu día todavía está en blanco.</p>
                        <p className="text-outline/70 text-xs leading-relaxed">
                          {pendingTotal > 0
                            ? `Tienes ${pendingTotal} tarea${pendingTotal !== 1 ? 's' : ''} pendiente${pendingTotal !== 1 ? 's' : ''}. ¿Qué arrancamos?`
                            : 'Abajo verás ejemplos de cómo podría lucir. Desaparecen cuando crees tu primer evento.'}
                        </p>
                        {onOpenAssistant && (
                          <button
                            onClick={onOpenAssistant}
                            className="flex items-center gap-1.5 text-xs font-bold text-white bg-primary hover:bg-primary/90 px-4 py-2 rounded-full transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                            Hablar con Nova
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Events preview: se ven como eventos reales (a color)
                        pero tienen chip 'ejemplo' y no son interactivos */}
                    <div className="space-y-2 pt-2 pointer-events-none select-none" aria-hidden="true">
                      {GHOSTS.map((g, i) => (
                        <div key={i} className="flex gap-6 items-start">
                          <div className="w-16 pt-3 text-right text-outline text-[12px] font-semibold">
                            {g.time}
                          </div>
                          <div className="flex-1 rounded-xl bg-surface-container-lowest shadow-[0_12px_32px_rgba(27,27,29,0.04)] border-l-4 border-primary p-3 flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg ${g.color} flex items-center justify-center flex-shrink-0`}>
                              <span className="material-symbols-outlined text-white text-[16px]">{g.icon}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-on-surface text-sm truncate">{g.title}</p>
                            </div>
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 uppercase tracking-wider flex-shrink-0">
                              ejemplo
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )
              })()}
            </div>
          </div>

          {/* ── Right: Insights personalizados ────────────────────────────── */}
          <div className={isDesktop ? "w-full space-y-5" : "w-full md:w-80 space-y-5"}>

            {/* ── Card 1: Próximo Bloque ────────────────────────────────── */}
            {blocks.length > 0 && (
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

              {/* Barra de bloques completados */}
              {totalBlocks > 0 && (
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-outline uppercase tracking-wider">Bloques completados</span>
                    <span className="text-[10px] font-bold text-outline tabular-nums">{completedCount}/{totalBlocks} · {Math.round(blockProgress * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-700"
                      style={{ width: `${blockProgress * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            )}

            {/* ── Card 2: Tu Día ────────────────────────────────────────── */}
            {blocks.length > 0 && !isDesktop && (
            <div className="bg-surface-container-high/40 backdrop-blur-sm rounded-[24px] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-headline font-bold text-on-surface">Tu Día</h4>
                <span className="text-[10px] font-bold text-outline uppercase tracking-wider">HOY</span>
              </div>

              {totalBlocks === 0 ? (
                <div className="text-center py-3 space-y-3">
                  <span className="material-symbols-outlined text-outline/30 text-[40px] block" style={{ fontVariationSettings: "'FILL' 0" }}>
                    calendar_today
                  </span>
                  <p className="text-sm font-semibold text-outline">Tu día está vacío.</p>
                  <p className="text-xs text-outline/60 leading-relaxed">Pídele a Nova que lo arme.</p>
                  {onOpenAssistant && (
                    <button
                      onClick={onOpenAssistant}
                      className="mx-auto flex items-center gap-1.5 text-xs font-bold text-white bg-primary px-4 py-2 rounded-full shadow-lg shadow-primary/20 transition-transform active:scale-95"
                    >
                      <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                      Hablar con Nova
                    </button>
                  )}
                </div>
              ) : (
                <>
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
                </>
              )}

              {/* 1 insight prominente — siempre */}
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
            )}

            {/* ── Cerrar el día ─────────────────────────────────────────── */}
            {onEveningShutdown && (
              <button
                onClick={onEveningShutdown}
                className="w-full flex items-center justify-center gap-2.5 py-4 rounded-[20px] border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50 transition-all active:scale-[0.98] group"
              >
                <span
                  className="material-symbols-outlined text-[18px] group-hover:text-slate-700 transition-colors"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  bedtime
                </span>
                <span className="text-[13px] font-semibold">Cerrar el día</span>
              </button>
            )}

          </div>
        </div>
      </main>

      {/* FAB — solo visible cuando hay bloques y en mobile */}
      {blocks.length > 0 && !isDesktop && (
        <button
          onClick={() => setShowModal(true)}
          className="fixed bottom-28 right-6 w-14 h-14 bg-primary text-white rounded-2xl shadow-2xl flex items-center justify-center hover:scale-105 active:scale-90 transition-transform z-40"
          title="Añadir bloque"
        >
          <span className="material-symbols-outlined text-3xl">add</span>
        </button>
      )}

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

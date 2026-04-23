import { useState, useEffect, useRef } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import QuickAddSheet     from '../components/QuickAddSheet'
import FocusBar          from '../components/FocusBar'
import MorningBrief      from '../components/MorningBrief'
import { useUserProfile } from '../hooks/useUserProfile'
import { todayISO as todayISODate, parseTimeToDecimal } from '../utils/time'
import {
  normalizeTitleKey,
  extractReminderMeta,
  titleTokenSet,
  jaccard,
  looksLikeReminderTitle,
  isReminderItem as isReminderBlock,
  reminderHasParent,
  isMainEntity,
} from '../utils/reminders'
import { parseTimeRange, NO_END_TIME_LABEL } from '../utils/eventDuration'

// ── Helpers ────────────────────────────────────────────────────────────────
const DAY_NAMES_ES   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

function formatToday() {
  const d = new Date()
  return `${DAY_NAMES_ES[d.getDay()]}, ${d.getDate()} de ${MONTH_NAMES_ES[d.getMonth()]}`
}

function tomorrowISO() {
  const d = new Date(Date.now() + 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatTomorrow() {
  const d = new Date(Date.now() + 86400000)
  return `${DAY_NAMES_ES[d.getDay()]}, ${d.getDate()} de ${MONTH_NAMES_ES[d.getMonth()]}`
}

function currentHour() {
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}

function formatMinutes(totalMinutes) {
  if (totalMinutes < 1) return 'ahora'
  if (totalMinutes < 60) return `${Math.round(totalMinutes)} min`
  const h = Math.floor(totalMinutes / 60)
  const m = Math.round(totalMinutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
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

// Helpers de recordatorios (isReminderBlock, reminderHasParent, extracción de
// meta por título, similitud Jaccard, etc.) viven en src/utils/reminders.js y
// están importados arriba. Single source of truth — Mi Día, Morning Brief y
// Evening Shutdown usan los mismos criterios para no descontar en un lado y
// duplicar en otro.

// Copy del contador de un recordatorio. "Ahora" dentro de ±30 seg; "En 1 min"
// hasta 1.5 min; luego "En X min" y "En Xh Ym" para tiempos más largos.
function formatReminderCountdown(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined) return ''
  if (totalMinutes <= 0.5) return 'Ahora'
  if (totalMinutes < 1.5) return 'En 1 min'
  if (totalMinutes < 60) return `En ${Math.round(totalMinutes)} min`
  const h = Math.floor(totalMinutes / 60)
  const m = Math.round(totalMinutes % 60)
  return m > 0 ? `En ${h}h ${m}m` : `En ${h}h`
}

const STORAGE_KEY = 'focus_planner_blocks'

// ── Lógica de insights personalizados ─────────────────────────────────────
function buildInsights(events, profile) {
  const todayISO = todayISODate()
  const todayEvents = events.filter((e) => !e.date || e.date === todayISO)
  const eveningCount = todayEvents.filter((e) => e.section === 'evening').length
  const meetingCount = todayEvents.filter((e) =>
    /reuni[oó]n|meeting|llamada|call|sincro|junta/i.test(e.title)
  ).length

  const { role } = profile
  const roleLabel = { student: 'estudiar', worker: 'trabajar', freelance: 'producir', other: 'concentrarte' }[role] ?? 'concentrarte'

  const insights = []

  // Insight 1: basado en cantidad de reuniones
  if (meetingCount >= 3) {
    insights.push({
      color: 'text-amber-600',
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      icon: 'groups',
      label: 'REUNIONES',
      text: `${meetingCount} reuniones hoy. Deja al menos 30 min de recuperación entre ellas.`,
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
      text: `Sin eventos agendados. Día ideal para ${roleLabel} sin interrupciones. Usa Time Blocking.`,
    })
  } else if (todayEvents.length <= 2) {
    insights.push({
      color: 'text-primary',
      bg: 'bg-primary/5',
      icon: 'self_improvement',
      label: 'AGENDA LIGERA',
      text: `Pocos eventos hoy. Aprovecha el tiempo libre para ${roleLabel} con calma.`,
    })
  }

  // Insight 5: tip de planificación general
  insights.push({
    color: 'text-primary',
    bg: 'bg-primary/5',
    icon: 'tips_and_updates',
    label: 'TIME BLOCKING',
    text: 'Divide tu día en bloques dedicados. Los estudios muestran hasta un 80% más de productividad frente a listas de tareas.',
  })

  // Devolver los 2 más relevantes (los primeros que se acumularon)
  return insights.slice(0, 2)
}

// ── Swipe-to-delete card ────────────────────────────────────────────────────
// Desliza hacia la izquierda para revelar el basurero y eliminar el evento.
// Long-press: mantener apretada la tarjeta ~600ms → dispara acción.
// Se cancela si el usuario se mueve (drag/scroll) o levanta el dedo antes.
// onClickCapture intercepta el click sintético que viene después del
// pointerup cuando el long-press ya disparó — así el click no abre el timer.
function LongPressZone({ onLongPress, onClick, className, style, title, children }) {
  const timer     = useRef(null)
  const startPos  = useRef({ x: 0, y: 0 })
  const fired     = useRef(false)
  const [pressed, setPressed] = useState(false)

  function cancel() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setPressed(false)
  }

  function start(e) {
    fired.current = false
    const p = e.touches?.[0] || e
    startPos.current = { x: p.clientX ?? 0, y: p.clientY ?? 0 }
    cancel()
    setPressed(true)
    timer.current = setTimeout(() => {
      fired.current = true
      timer.current = null
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(10) } catch {}
      }
      onLongPress?.()
      setPressed(false)
    }, 500)
  }

  function move(e) {
    if (!timer.current) return
    const p = e.touches?.[0] || e
    const dx = Math.abs((p.clientX ?? 0) - startPos.current.x)
    const dy = Math.abs((p.clientY ?? 0) - startPos.current.y)
    if (dx > 8 || dy > 8) cancel()
  }

  function handleClickCapture(e) {
    if (fired.current) {
      e.stopPropagation()
      e.preventDefault()
      fired.current = false
    }
  }

  const mergedStyle = {
    ...style,
    WebkitTouchCallout: 'none',
    WebkitUserSelect:   'none',
    userSelect:         'none',
    transform: pressed ? 'scale(1.02)' : 'scale(1)',
    boxShadow: pressed ? '0 12px 32px -10px rgba(124, 107, 255, 0.35)' : undefined,
    transition: 'transform 180ms var(--ease, cubic-bezier(0.22,1,0.36,1)), box-shadow 180ms var(--ease, cubic-bezier(0.22,1,0.36,1))',
  }

  return (
    <div
      className={className}
      style={mergedStyle}
      title={title}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClickCapture={handleClickCapture}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

function SwipeableCard({ onDelete, disabled, children }) {
  const x = useMotionValue(0)
  const THRESHOLD = -72

  const trashOpacity = useTransform(x, [0, -40, THRESHOLD], [0, 0.6, 1])
  const trashScale   = useTransform(x, [0, -40, THRESHOLD], [0.6, 0.8, 1])
  const bgOpacity    = useTransform(x, [0, THRESHOLD], [0, 1])

  function handleDragEnd(_, info) {
    if (info.offset.x < THRESHOLD) {
      animate(x, -400, { duration: 0.25, ease: 'easeIn' }).then(onDelete)
    } else {
      animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 })
    }
  }

  if (disabled) return <>{children}</>

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
      {/* Fondo rojo con basurero */}
      <motion.div
        style={{ opacity: bgOpacity }}
        className="absolute inset-0 bg-red-500 rounded-xl flex items-center justify-end pr-5"
      >
        <motion.span
          style={{ scale: trashScale, opacity: trashOpacity, fontVariationSettings: "'FILL' 1" }}
          className="material-symbols-outlined text-white text-[26px]"
        >
          delete
        </motion.span>
      </motion.div>

      <motion.div
        style={{ x, touchAction: 'pan-y' }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -200, right: 0 }}
        dragElastic={{ left: 0.15, right: 0.05 }}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
      >
        {children}
      </motion.div>
    </div>
  )
}

// ── Componente ─────────────────────────────────────────────────────────────
export default function PlannerView({ onAddEvent, onEditEvent, onDeleteEvent, onAddTask, onToggleTask, onDeleteTask, events = [], tasks = [], onOpenAssistant, onEveningShutdown, onNavigate, isDesktop = false, morningBrief = null }) {
  const [blocks, setBlocks] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return []
  })
  const [showModal, setShowModal]         = useState(false)
  const [, setTick] = useState(0)
  // seed de la FocusBar: los chips del empty state inyectan texto aquí y
  // la FocusBar lo aplica + enfoca el input. n es un contador para poder
  // re-sembrar el mismo texto y re-disparar el efecto.
  const [focusBarSeed, setFocusBarSeed] = useState({ text: '', n: 0 })

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

  // Sincroniza "Mi Día" (timeline) con eventos de HOY.
  // Antes solo AÑADÍA blocks — por eso cuando Nova decía "eliminé tus eventos"
  // los blocks quedaban zombies en localStorage. Ahora también los elimina
  // cuando el evento correspondiente deja de existir, y actualiza título/hora
  // si cambiaron. Los blocks manuales (sin eventId) no se tocan.
  useEffect(() => {
    const todayISO = todayISODate()
    const todayEvents = (events || []).filter((e) => !e.date || e.date === todayISO)
    const eventById = new Map(todayEvents.map(e => [e.id, e]))

    setBlocks((prev) => {
      const prevArr = Array.isArray(prev) ? prev : []
      const synced = []
      const usedEventIds = new Set()

      for (const b of prevArr) {
        if (!b) continue
        if (b.eventId) {
          const ev = eventById.get(b.eventId)
          if (!ev) continue // evento borrado → block también desaparece
          synced.push({
            ...b,
            time: eventTimeToBlockTime(ev.time),
            title: ev.title,
            description: ev.description || null,
          })
          usedEventIds.add(b.eventId)
        } else {
          synced.push(b) // block manual (sin eventId) → preservar
        }
      }

      for (const ev of todayEvents) {
        if (!ev?.id || usedEventIds.has(ev.id)) continue
        synced.push({
          id: `blk-ev-${ev.id}`,
          eventId: ev.id,
          time: eventTimeToBlockTime(ev.time),
          type: 'confirmed',
          title: ev.title,
          description: ev.description || null,
        })
      }

      return synced
    })
  }, [events])

  function acceptSuggestion(id) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, type: 'confirmed' } : b)))
  }

  function dismissBlock(id) {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  // Marca el bloque como completado (HECHO ✓): no lo borra. El bloque sigue
  // visible, atenuado, para que "Bloques completados" refleje la realidad.
  function completeBlock(id) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, type: 'done' } : b)))
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
  // Contadores de "Tu Día" cuentan SOLO entidades principales. Un recordatorio
  // asociado a un evento (ej: "Recordatorio: Reunión con Juan" para la reunión
  // de las 15:00) no es una entidad separada — se renderiza como subtarea del
  // evento padre, así que no debe aparecer en confirmados/pendientes/completados
  // ni en la barra de progreso. Sí cuentan los recordatorios independientes
  // (sin padre) porque son la única representación de ese compromiso.
  // Ver src/utils/reminders.js para la definición completa de "entidad principal".
  const mainBlocks = Array.isArray(blocks)
    ? blocks.filter((b) => b && isMainEntity(b, blocks))
    : []
  const confirmedCount  = mainBlocks.filter((b) => b.type === 'confirmed').length
  const suggestionCount = mainBlocks.filter((b) => b.type === 'suggestion').length
  const completedCount  = mainBlocks.filter((b) => b.type === 'done').length
  const totalBlocks     = mainBlocks.length
  // Progreso del día = cuántos bloques confirmados del día ya se cerraron.
  // Las sugerencias aún no son parte del día, así que no cuentan en el denominador.
  const scheduledBlocks = confirmedCount + completedCount
  const blockProgress   = scheduledBlocks > 0 ? completedCount / scheduledBlocks : 0

  const topInsight = buildInsights(events, profile)[0] ?? null

  // ── Adelanto de mañana ───────────────────────────────────────────────────
  // Se muestra cuando Mi Día ya no aporta acción inmediata: día vacío, o
  // todos los eventos de hoy ya quedaron atrás (no hay activeBlock ni next).
  // Si mañana tampoco tiene eventos, no renderizamos nada — evitamos una
  // tarjeta vacía.
  const tomorrowEvents = (() => {
    const iso = tomorrowISO()
    return (events || [])
      .filter((e) => e?.date === iso)
      .map((e) => {
        const firstTime = String(e.time || '').split('-')[0].trim()
        return { ...e, _displayTime: firstTime || '—', _h: parseTimeToDecimal(firstTime) }
      })
      .sort((a, b) => {
        const ah = a._h ?? Number.POSITIVE_INFINITY
        const bh = b._h ?? Number.POSITIVE_INFINITY
        return ah - bh
      })
      .slice(0, 3)
  })()

  // ── Card 1: Próximo Bloque ────────────────────────────────────────────────
  const DAY_START_H = 8
  const DAY_END_H   = 22
  const now = currentHour()

  // Separamos recordatorios de eventos/bloques reales. Un recordatorio no es un
  // "bloque activo" ni un "próximo bloque": no debe mostrar "En curso" ni
  // "X min transcurridos". Se maneja con su propia tarjeta más abajo.
  const allBlocksRaw = Array.isArray(blocks) ? blocks : []
  const eventBlocksRaw = allBlocksRaw.filter((b) => !isReminderBlock(b))
  const reminderBlocksRaw = allBlocksRaw.filter((b) => isReminderBlock(b))

  const blocksWithDecimal = eventBlocksRaw
    .map((b) => {
      const range = parseTimeRange(b.time)
      const startH = range?.startH ?? parseTimeToDecimal(b.time)
      const endH = range?.endH ?? null
      return { ...b, _h: startH, _endH: endH }
    })
    .filter((b) => b._h !== null)
    .sort((a, b) => a._h - b._h)

  // Un bloque se considera "En curso" cuando estamos dentro de su ventana
  // temporal. Distinguimos dos casos:
  //   · Con hora de término válida: activo mientras [start, end).
  //   · Sin hora de término: activo solo durante una ventana corta de
  //     cortesía (15 min) a partir de start, o hasta que empiece el próximo
  //     bloque — lo que ocurra antes. Así la tarjeta refleja "esto acaba de
  //     empezar" sin inventar un `end` arbitrario de 1h, y sin afirmar
  //     elapsed/progress sobre una duración inexistente (la UI se encarga de
  //     eso con activeHasEnd).
  const activeBlock = (() => {
    const NO_END_GRACE_H = 15 / 60
    for (let i = 0; i < blocksWithDecimal.length; i++) {
      const b = blocksWithDecimal[i]
      if (b._endH !== null && b._endH > b._h) {
        if (now >= b._h && now < b._endH) return b
        continue
      }
      const nextH = blocksWithDecimal[i + 1]?._h ?? Number.POSITIVE_INFINITY
      const graceEnd = Math.min(b._h + NO_END_GRACE_H, nextH)
      if (now >= b._h && now < graceEnd) return b
    }
    return null
  })()

  const nextBlock   = blocksWithDecimal.find((b) => b._h > now) ?? null

  // Recordatorio destacado: solo los standalone (sin evento padre) y dentro de
  // una ventana cercana a "ahora" (de -5 min a +120 min). Si ya pasó hace más
  // de 5 min, no secuestra la tarjeta — sigue visible en el timeline.
  const upcomingReminder = (() => {
    if (!reminderBlocksRaw.length) return null
    const standalone = reminderBlocksRaw
      .filter((r) => !reminderHasParent(r, eventBlocksRaw))
      .map((r) => ({ ...r, _h: parseTimeToDecimal(r.time) }))
      .filter((r) => r._h !== null && r.type !== 'done')
    if (!standalone.length) return null
    const windowed = standalone
      .filter((r) => {
        const delta = (r._h - now) * 60
        return delta >= -5 && delta <= 120
      })
      .sort((a, b) => Math.abs(a._h - now) - Math.abs(b._h - now))
    return windowed[0] ?? null
  })()

  // Cuándo el recordatorio debe ocupar la tarjeta: no hay bloque activo, y
  // o bien no hay próximo bloque, o el recordatorio ocurre antes.
  const reminderInFocus = !activeBlock
    && upcomingReminder
    && (!nextBlock || upcomingReminder._h <= nextBlock._h)

  // Fallback flexible: si no hay activo ni próximo con hora ni recordatorio
  // cercano, pero sí queda un pendiente de hoy sin hora definida, lo mostramos
  // como "Próximo bloque sugerido" para que la tarjeta no quede vacía cuando
  // aún hay algo por hacer. Importante: no usamos tasks como flexibleBlock —
  // las tareas de hoy ya se renderizan como items con chip "Pendiente de hoy"
  // en el timeline, así que esta tarjeta sigue siendo exclusiva de bloques/
  // eventos sin hora. También excluimos recordatorios para que nunca aparezcan
  // en modo "flexible".
  const flexibleBlock = (!activeBlock && !nextBlock && !reminderInFocus)
    ? eventBlocksRaw.find(
        (b) => b && b.type !== 'done' && parseTimeToDecimal(b.time) === null,
      ) ?? null
    : null

  const hasBlocks   = blocksWithDecimal.length > 0 || !!upcomingReminder
  const dayIsEmpty  = !hasBlocks && !flexibleBlock
  const dayIsDone   = hasBlocks && !activeBlock && !nextBlock && !upcomingReminder && !flexibleBlock
  // Tareas de hoy pendientes. Se calcula aquí (y no derivado de displayBlocks)
  // para evitar TDZ: showTomorrowPreview lo lee más abajo y displayBlocks se
  // arma mucho después. Antes, borrar el último evento dejaba dayIsEmpty=true
  // y la evaluación de pendingTasksCount antes de su const crasheaba el render
  // entero (pantalla blanca).
  const pendingTasksCount = Array.isArray(tasks)
    ? tasks.filter((t) => t && !t.done && t.category === 'hoy').length
    : 0
  // Si hay tareas pendientes de hoy, el día no está vacío aunque no haya
  // eventos con hora — no tiene sentido empujar al usuario al adelanto de
  // mañana cuando tiene cosas por resolver hoy.
  const showTomorrowPreview = (dayIsEmpty || dayIsDone)
    && pendingTasksCount === 0
    && tomorrowEvents.length > 0
  const minsToNext     = nextBlock        ? (nextBlock._h        - now) * 60 : null
  // minsElapsed solo tiene sentido cuando el bloque activo tiene ambos
  // extremos válidos. Por construcción activeBlock ya lo garantiza, pero lo
  // dejamos explícito para que un refactor futuro no regrese al comportamiento
  // de eventos "eternos".
  const activeHasEnd    = !!(activeBlock && activeBlock._endH && activeBlock._endH > activeBlock._h)
  const minsElapsed     = activeHasEnd ? (now - activeBlock._h) * 60 : null
  const activeDurationMin = activeHasEnd ? (activeBlock._endH - activeBlock._h) * 60 : null
  const activeProgress  = activeHasEnd
    ? Math.min(1, Math.max(0, (now - activeBlock._h) / (activeBlock._endH - activeBlock._h)))
    : null
  const minsToReminder = upcomingReminder ? (upcomingReminder._h - now) * 60 : null
  const dayProgress = Math.min(1, Math.max(0, (now - DAY_START_H) / (DAY_END_H - DAY_START_H)))

  // Heurística "Google Calendar": recordatorios como eventos cortos anidados (UI-only)
  const displayBlocks = (() => {
    const arrRaw = Array.isArray(blocks) ? blocks : []
    // NO ocultamos eventos pasados: si el usuario crea "fútbol 5 PM" a las 9 PM
    // debe verlo en Mi Día como confirmación. El estilo "pasado" se aplica en
    // el render (opacity/tachado), no filtrando.
    const arrFiltered = arrRaw.filter(Boolean)
    const arr = arrFiltered.map((b, originalIndex) => ({ ...b, _orig: originalIndex, _h: parseTimeToDecimal(b?.time) }))
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

    // 3) Attach tasks linked to events (Nova las crea con linkedEventId cuando
    //    provienen de un evento concreto: subtareas de una reunión, checklist
    //    antes de una llamada, etc.). Buscamos el bloque cuyo eventId coincida
    //    y las mostramos como subtareas debajo, para que no queden flotando
    //    sueltas en la pestaña Tareas sin contexto.
    const attachedTaskIds = new Set()
    if (Array.isArray(tasks) && tasks.length > 0) {
      const blocksByEventId = new Map()
      for (const entry of order) {
        if (entry?.eventId) blocksByEventId.set(entry.eventId, entry)
      }
      for (const t of tasks) {
        if (!t?.linkedEventId || t.done) continue
        const parent = blocksByEventId.get(t.linkedEventId)
        if (!parent) continue
        pushUniqueSubtask(parent, {
          id: `tsk-sub-${t.id}`,
          label: t.priority === 'Alta' ? 'Tarea · prioridad alta' : 'Tarea',
          text: t.label,
          taskId: t.id,
        })
        attachedTaskIds.add(t.id)
      }
    }

    // 4) Append standalone "hoy" tasks as flexible items al final del día.
    //    Evita duplicar las que ya colgamos como subtareas en paso 3.
    //    Orden: prioridad Alta primero, luego Media, luego Baja; dentro de
    //    cada nivel respetamos el orden de creación para que la lista no baile.
    if (Array.isArray(tasks) && tasks.length > 0) {
      const PRIO_RANK = { Alta: 0, Media: 1, Baja: 2 }
      const pendingToday = tasks
        .filter((t) => t && !t.done && t.category === 'hoy' && !attachedTaskIds.has(t.id))
        .sort((a, b) => (PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1))
      for (const t of pendingToday) {
        order.push({
          id: `tsk-${t.id}`,
          taskId: t.id,
          time: '—',
          type: 'task',
          title: t.label,
          priority: t.priority,
          _isTask: true,
          subtasks: [],
        })
      }
    }

    return order
  })()

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen pb-56 dark:bg-slate-900 dark:text-slate-100">

      {/* Setup card legacy — reemplazado por OnboardingTour animado.
          El sistema de user_signals aprende el cronotipo solo, sin preguntar. */}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-8">
        {/* Desktop: 2 columnas (timeline 2fr + insights 1fr). Mobile: stack.
            Antes todo iba en flex-col incluso en desktop, lo que dejaba la
            columna derecha vacía a partir de 1024px. El grid con fr permite
            que el timeline respire y los insights queden fijos al lado. */}
        <div className={isDesktop ? "grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-8 items-start" : "flex flex-col gap-10"}>

          {/* ── Left: Timeline ────────────────────────────────────────────── */}
          <div className="min-w-0">
            {isDesktop && morningBrief && (
              <div className="mb-6">
                <MorningBrief inline {...morningBrief} />
              </div>
            )}
            <header className="mb-8">
              <p className="text-primary font-bold text-[11px] uppercase tracking-[0.14em] mb-2.5">
                {formatToday()}
              </p>
              <h2 className="text-4xl lg:text-5xl font-headline font-extrabold tracking-tight text-on-surface">
                Mi Día
              </h2>
            </header>

            <FocusBar
              onAddEvent={onAddEvent}
              onEditEvent={onEditEvent}
              onDeleteEvent={onDeleteEvent}
              onAddTask={onAddTask}
              onToggleTask={onToggleTask}
              onDeleteTask={onDeleteTask}
              events={events}
              tasks={tasks}
              inline
              seed={focusBarSeed}
            />

            <div className="relative space-y-3">
              {displayBlocks.map(({ id, eventId, taskId, time, type, title, description, priority, subtasks = [], _asReminderOnly, _isTask }) => {
                // Tareas de hoy (sin hora): se pintan como item distinto del
                // timeline, con etiqueta "Pendiente de hoy" y acciones ligadas
                // a los handlers de tareas (no a los de eventos).
                if (_isTask) {
                  const prioStyle = priority === 'Alta'
                    ? 'border-error'
                    : priority === 'Baja'
                      ? 'border-outline-variant'
                      : 'border-secondary'
                  const handleToggle = () => { if (taskId) onToggleTask?.(taskId) }
                  const handleTaskDelete = () => { if (taskId) onDeleteTask?.(taskId) }
                  const handleTaskLongPress = () => {
                    if (window.confirm(`¿Eliminar "${title}"?`)) handleTaskDelete()
                  }
                  return (
                    <div
                      key={id}
                      data-task-card
                      style={{ display: 'flex', gap: '24px', overflow: 'visible' }}
                      className="group"
                    >
                      <div style={{ flexShrink: 0, width: '52px', paddingTop: '10px', textAlign: 'right', overflow: 'visible' }}>
                        <span
                          className="material-symbols-outlined text-outline/50 text-[18px]"
                          style={{ fontVariationSettings: "'FILL' 0" }}
                          title="Sin hora · pendiente del día"
                        >
                          check_box_outline_blank
                        </span>
                      </div>

                      <div style={{ flex: 1, minWidth: 0, position: 'relative', paddingBottom: '24px' }}>
                        <div
                          className="absolute top-4 w-2 h-2 rounded-full ring-4 ring-surface bg-outline-variant"
                          style={{ left: '-21px', zIndex: 1 }}
                        />
                        <SwipeableCard onDelete={handleTaskDelete}>
                          <LongPressZone
                            onLongPress={handleTaskLongPress}
                            className={`rounded-xl bg-surface-container-low/60 border-l-4 ${prioStyle}`}
                            style={{ padding: '12px 14px 12px 14px', overflow: 'visible', touchAction: 'pan-y' }}
                            title="Mantén apretado para eliminar"
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div className="min-w-0" style={{ flex: 1 }}>
                                <span
                                  className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-secondary/10 text-secondary"
                                  style={{ letterSpacing: '0.08em', marginBottom: '4px' }}
                                >
                                  <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>task_alt</span>
                                  Pendiente de hoy
                                </span>
                                <h3
                                  className="font-semibold text-on-surface text-[14px] leading-snug"
                                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                                >
                                  {title || '(sin título)'}
                                </h3>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleToggle() }}
                                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-emerald-100 hover:text-emerald-600 transition-colors"
                                style={{ flexShrink: 0 }}
                              >
                                HECHO ✓
                              </button>
                            </div>
                          </LongPressZone>
                        </SwipeableCard>
                      </div>
                    </div>
                  )
                }

                const isSuggestion = type === 'suggestion'
                const isActive = activeBlock?.id === id
                const isNext = !activeBlock && nextBlock?.id === id

                // Delete handler unificado — usa eventId cuando existe para borrar
                // también de Supabase (antes solo se borraba el bloque local y la
                // useEffect de sync lo volvía a resucitar porque el evento seguía vivo).
                const handleDeleteBlock = () => {
                  dismissBlock(id)
                  if (eventId) onDeleteEvent?.(eventId)
                }
                const handleLongPressDelete = () => {
                  if (isSuggestion || _asReminderOnly) return
                  if (window.confirm(`¿Eliminar "${title}"?`)) handleDeleteBlock()
                }
                return (
                  <div
                    key={id}
                    data-event-card
                    data-next-event={isActive || isNext ? '' : undefined}
                    style={{ display: 'flex', gap: '24px', overflow: 'visible' }}
                    className="group"
                  >
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
                      <div className={`absolute top-4 w-2 h-2 rounded-full ring-4 ring-surface transition-all ${
                        isSuggestion
                          ? 'bg-secondary'
                          : isActive
                            ? 'bg-primary scale-125 shadow-[0_0_0_4px_rgba(59,130,246,0.18)]'
                            : 'bg-primary'
                      }`}
                        style={{ left: '-21px', zIndex: 1 }} />
                      <SwipeableCard
                        onDelete={!isSuggestion && !_asReminderOnly ? handleDeleteBlock : undefined}
                        disabled={isSuggestion || _asReminderOnly}
                      >
                      <LongPressZone
                        onLongPress={!isSuggestion && !_asReminderOnly ? handleLongPressDelete : undefined}
                        className={`rounded-xl transition-all duration-200 ${
                          isSuggestion
                            ? 'bg-surface-container-low/50 border border-dashed border-secondary/30 hover:border-secondary/50'
                            : `bg-surface-container-lowest border-l-4 hover:shadow-[0_16px_36px_rgba(27,27,29,0.08)] ${
                                type === 'done'
                                  ? 'border-emerald-400 opacity-60 shadow-[0_4px_12px_rgba(27,27,29,0.03)]'
                                  : isActive
                                    ? 'border-primary ring-1 ring-primary/20 shadow-[0_16px_40px_rgba(59,130,246,0.12)]'
                                    : isNext
                                      ? 'border-primary/70 shadow-[0_12px_32px_rgba(27,27,29,0.05)]'
                                      : 'border-primary shadow-[0_12px_32px_rgba(27,27,29,0.04)]'
                              }`
                        }`}
                        style={{ padding: '14px 16px 14px 14px', overflow: 'visible', touchAction: 'pan-y' }}
                        title="Mantén apretado para eliminar"
                      >
                        <div className="flex justify-between items-start gap-2" style={{ marginBottom: '2px' }}>
                          <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 0 }}>
                            <h3 className={`font-bold ${isSuggestion ? 'text-secondary' : 'text-on-surface'} ${type === 'done' ? 'line-through decoration-emerald-400/60' : ''}`}
                              style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {title || '(sin título)'}
                            </h3>
                          </div>
                          {isSuggestion ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); acceptSuggestion(id) }}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-secondary/20 hover:bg-secondary/10 text-secondary transition-colors"
                              style={{ flexShrink: 0 }}
                            >
                              ACEPTAR
                            </button>
                          ) : _asReminderOnly ? null : type === 'done' ? (
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600"
                              style={{ flexShrink: 0, letterSpacing: '0.04em' }}
                            >
                              ✓ HECHO
                            </span>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); completeBlock(id) }}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-emerald-100 hover:text-emerald-600 transition-colors"
                              style={{ flexShrink: 0 }}
                            >
                              HECHO ✓
                            </button>
                          )}
                        </div>

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
                                <p style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '1px' }}>
                                  {s.label}
                                </p>
                                <p style={{ fontSize: '11px', lineHeight: '1.4', color: '#64748b' }}>
                                  {s.text}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </LongPressZone>
                      </SwipeableCard>

                      {/* Nota/recordatorio adjunto — sticky note pegada debajo del bloque.
                          Filtramos descripciones que son solo una fecha ISO (YYYY-MM-DD) —
                          data vieja generada por QuickAddSheet cuando stuffing date en
                          description. Si el evento está en Mi Día ya es obvio que es hoy. */}
                      {description && !_asReminderOnly && !isSuggestion && !/^\d{4}-\d{2}-\d{2}$/.test(String(description).trim()) && (
                        <div
                          className="mt-1.5 ml-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2"
                          style={{ maxWidth: 'calc(100% - 12px)' }}
                        >
                          <span className="material-symbols-outlined text-amber-600 text-[14px] mt-0.5 flex-shrink-0">sticky_note_2</span>
                          <p className="text-[12px] leading-snug text-amber-900/80 flex-1 break-words">
                            {description}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {blocks.length === 0 && pendingTasksCount === 0 && (() => {
                const pendingTotal = semanaCount + algoDiaCount
                // label = texto corto visible en el chip (cabe en iPhone sin truncar).
                // prompt = texto completo que se siembra en la FocusBar al tocar.
                const chips = [
                  { icon: 'fitness_center', label: 'Agendar gym mañana',   prompt: 'Agenda gym mañana a las 7' },
                  { icon: 'schedule',       label: 'Bloquear 2h de foco',  prompt: 'Bloquea 2h de foco esta tarde' },
                  { icon: 'event_repeat',   label: 'Reunión semanal fija', prompt: 'Agenda una reunión todos los lunes a las 9 am' },
                ]
                return (
                  <div className="flex gap-6">
                    <div className="w-16" />
                    <div className="flex-1 space-y-4">
                      <div className="space-y-1">
                        <p className="text-on-surface text-sm font-semibold">Hoy está libre.</p>
                        <p className="text-outline/70 text-xs leading-relaxed">
                          {pendingTotal > 0
                            ? `Tienes ${pendingTotal} tarea${pendingTotal !== 1 ? 's' : ''} pendiente${pendingTotal !== 1 ? 's' : ''}. ¿Por dónde empezamos?`
                            : '¿Por dónde empezamos? Toca un ejemplo o escríbele a Nova.'}
                        </p>
                      </div>
                      <ul className="space-y-2">
                        {chips.map((chip) => (
                          <li key={chip.label}>
                            <button
                              type="button"
                              onClick={() => setFocusBarSeed(({ n }) => ({ text: chip.prompt, n: n + 1 }))}
                              className="w-full flex items-center gap-2.5 bg-surface-container-lowest hover:bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 py-2.5 text-left transition-colors active:scale-[0.99]"
                            >
                              <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <span
                                  className="material-symbols-outlined text-primary text-[16px]"
                                  style={{ fontVariationSettings: "'FILL' 1" }}
                                >
                                  {chip.icon}
                                </span>
                              </span>
                              <span className="flex-1 min-w-0 text-[13px] font-medium text-on-surface leading-snug break-words">
                                {chip.label}
                              </span>
                              <span className="material-symbols-outlined text-outline/50 text-[16px] flex-shrink-0">
                                arrow_outward
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              })()}

              {/* ── Adelanto de mañana ─────────────────────────────────────
                  Aparece cuando hoy está vacío o ya no quedan bloques por
                  delante. Máx. 3 eventos, ordenados por hora, sin tarjeta
                  vacía cuando mañana tampoco tiene nada. */}
              {showTomorrowPreview && (
                <div className="mt-10 flex gap-6">
                  <div className="w-16 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-end justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="text-primary font-semibold text-xs mb-1">Adelanto de mañana</p>
                        <p className="text-sm text-outline truncate">{formatTomorrow()}</p>
                      </div>
                      {onNavigate && (
                        <button
                          onClick={() => onNavigate('calendar')}
                          className="flex items-center gap-1 text-xs font-bold text-primary hover:bg-primary/10 px-2 py-1 rounded-full transition-colors flex-shrink-0"
                        >
                          Ver calendario
                          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                        </button>
                      )}
                    </div>
                    <ul className="space-y-2">
                      {tomorrowEvents.map((ev) => {
                        const detail = ev.description && !/^\d{4}-\d{2}-\d{2}$/.test(String(ev.description).trim())
                          ? String(ev.description).trim()
                          : null
                        return (
                          <li
                            key={ev.id}
                            className="flex items-start gap-3 bg-surface-container-lowest rounded-xl px-3 py-2.5 border-l-2 border-primary/40"
                          >
                            <span
                              className="text-[12px] font-semibold text-outline tabular-nums flex-shrink-0 pt-0.5"
                              style={{ minWidth: '52px' }}
                            >
                              {ev._displayTime}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-on-surface truncate">
                                {ev.title || '(sin título)'}
                              </p>
                              {detail && (
                                <p className="text-xs text-outline/70 mt-0.5 truncate">
                                  {detail}
                                </p>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Insights personalizados ────────────────────────────── */}
          <div className="w-full space-y-5">

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
                    {activeBlock
                      ? 'play_circle'
                      : reminderInFocus
                        ? 'notifications'
                        : flexibleBlock && !nextBlock
                          ? 'bolt'
                          : 'schedule'}
                  </span>
                  <h4 className="font-headline font-bold text-on-surface">
                    {activeBlock
                      ? 'En Curso'
                      : reminderInFocus
                        ? 'Recordatorio'
                        : nextBlock
                          ? 'Próximo Bloque'
                          : flexibleBlock
                            ? 'Próximo bloque sugerido'
                            : 'Próximo Bloque'}
                  </h4>
                </div>
                {activeBlock && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    ACTIVO
                  </span>
                )}
                {!activeBlock && reminderInFocus && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-tertiary/10 text-tertiary">
                    RECORDATORIO
                  </span>
                )}
                {!activeBlock && !reminderInFocus && !nextBlock && flexibleBlock && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary/10 text-secondary">
                    FLEXIBLE
                  </span>
                )}
              </div>

              {/* Contenido dinámico */}
              {activeBlock ? (
                <SwipeableCard onDelete={() => { dismissBlock(activeBlock.id); if (activeBlock.eventId) onDeleteEvent?.(activeBlock.eventId) }}>
                  <LongPressZone
                    onLongPress={() => { if (window.confirm(`¿Eliminar "${activeBlock.title}"?`)) { dismissBlock(activeBlock.id); if (activeBlock.eventId) onDeleteEvent?.(activeBlock.eventId) } }}
                    className="py-1"
                    title="Mantén apretado para eliminar"
                    data-next-event
                  >
                    <p className="text-xs font-semibold text-outline mb-1">{activeBlock.time}</p>
                    <p className="font-headline font-bold text-on-surface text-[17px] leading-snug mb-3 break-words">{activeBlock.title || '(sin título)'}</p>
                    {/* Métricas de "en curso" — SOLO cuando el bloque tiene
                        hora de término real. Sin endTime no mostramos
                        transcurridos ni barra de progreso: son métricas
                        inventadas sobre una duración inexistente. */}
                    {activeHasEnd ? (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-extrabold font-headline text-primary tabular-nums">{Math.round(minsElapsed)}</span>
                          <span className="text-sm font-semibold text-outline">
                            min transcurridos{activeDurationMin ? ` · de ${Math.round(activeDurationMin)} min` : ''}
                          </span>
                        </div>
                        <div className="mt-2 h-1 bg-surface-container-highest rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-700"
                            style={{ width: `${(activeProgress ?? 0) * 100}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-outline/80 px-2 py-0.5 rounded-full bg-surface-container-low">
                        <span className="material-symbols-outlined text-[13px]">hourglass_empty</span>
                        {NO_END_TIME_LABEL}
                      </span>
                    )}
                  </LongPressZone>
                </SwipeableCard>
              ) : reminderInFocus ? (
                <SwipeableCard onDelete={() => { dismissBlock(upcomingReminder.id); if (upcomingReminder.eventId) onDeleteEvent?.(upcomingReminder.eventId) }}>
                  <LongPressZone
                    onLongPress={() => { if (window.confirm(`¿Eliminar "${upcomingReminder.title}"?`)) { dismissBlock(upcomingReminder.id); if (upcomingReminder.eventId) onDeleteEvent?.(upcomingReminder.eventId) } }}
                    className="py-1"
                    title="Mantén apretado para eliminar"
                    data-next-event
                  >
                    <p className="text-xs font-semibold text-outline mb-1">{upcomingReminder.time}</p>
                    <p className="font-headline font-bold text-on-surface text-[17px] leading-snug mb-3 break-words">{upcomingReminder.title || '(sin título)'}</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold font-headline text-tertiary tabular-nums">{formatReminderCountdown(minsToReminder)}</span>
                    </div>
                  </LongPressZone>
                </SwipeableCard>
              ) : nextBlock ? (
                <SwipeableCard onDelete={() => { dismissBlock(nextBlock.id); if (nextBlock.eventId) onDeleteEvent?.(nextBlock.eventId) }}>
                  <LongPressZone
                    onLongPress={() => { if (window.confirm(`¿Eliminar "${nextBlock.title}"?`)) { dismissBlock(nextBlock.id); if (nextBlock.eventId) onDeleteEvent?.(nextBlock.eventId) } }}
                    className="py-1"
                    title="Mantén apretado para eliminar"
                    data-next-event
                  >
                    <p className="text-xs font-semibold text-outline mb-1">{nextBlock.time}</p>
                    <p className="font-headline font-bold text-on-surface text-[17px] leading-snug mb-3 break-words">{nextBlock.title || '(sin título)'}</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold font-headline text-primary tabular-nums">{formatMinutes(minsToNext)}</span>
                      {minsToNext >= 1 && <span className="text-sm font-semibold text-outline">para empezar</span>}
                    </div>
                  </LongPressZone>
                </SwipeableCard>
              ) : flexibleBlock ? (
                <SwipeableCard onDelete={() => { dismissBlock(flexibleBlock.id); if (flexibleBlock.eventId) onDeleteEvent?.(flexibleBlock.eventId) }}>
                  <LongPressZone
                    onLongPress={() => { if (window.confirm(`¿Eliminar "${flexibleBlock.title}"?`)) { dismissBlock(flexibleBlock.id); if (flexibleBlock.eventId) onDeleteEvent?.(flexibleBlock.eventId) } }}
                    className="py-1"
                    title="Mantén apretado para eliminar"
                    data-next-event
                  >
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-secondary/10 text-secondary mb-2">
                      <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                      Sin hora definida
                    </span>
                    <p className="font-headline font-bold text-on-surface text-[17px] leading-snug mb-2 break-words">{flexibleBlock.title || '(sin título)'}</p>
                    <p className="text-sm font-medium text-outline leading-snug">Cuando puedas durante el día.</p>
                  </LongPressZone>
                </SwipeableCard>
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
              {scheduledBlocks > 0 && (
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-outline">Progreso del día</span>
                    <span className="text-[10px] font-bold text-outline tabular-nums">{completedCount}/{scheduledBlocks} · {Math.round(blockProgress * 100)}%</span>
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
                <span className="text-[10px] font-bold text-outline">HOY</span>
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

                  {/* Barra de progreso del día */}
                  {scheduledBlocks > 0 && (
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-outline">Progreso del día</span>
                        <span className="text-[10px] font-bold text-outline tabular-nums">{completedCount}/{scheduledBlocks}</span>
                      </div>
                      <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                        <div
                          className="h-full bg-secondary rounded-full transition-all duration-500"
                          style={{ width: `${blockProgress * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
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
                    <p className={`text-[12px] font-semibold ${topInsight.color}`}>{topInsight.label}</p>
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

      {/* FAB — solo visible cuando hay bloques y en mobile.
          Bottom calculado para que jamás pise el bottom nav:
          safe-area + 20 (nav offset) + ~80 (alto nav) + 16 (gap) ≈ 116 + safe. */}
      {blocks.length > 0 && !isDesktop && (
        <button
          onClick={() => setShowModal(true)}
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 116px)' }}
          className="fixed right-6 w-14 h-14 bg-primary text-white rounded-2xl shadow-2xl flex items-center justify-center hover:scale-105 active:scale-90 transition-transform z-40"
          title="Añadir bloque"
        >
          <span className="material-symbols-outlined text-3xl">add</span>
        </button>
      )}

      {showModal && (
        <QuickAddSheet onSave={handleModalSave} onCancel={() => setShowModal(false)} />
      )}
    </div>
  )
}

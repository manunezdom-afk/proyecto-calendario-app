import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { resolveEventDate } from '../utils/resolveEventDate'

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function score(text, query) {
  const t = normalize(text)
  const q = normalize(query)
  if (!q) return 1
  if (t === q) return 1000
  if (t.startsWith(q)) return 500
  const idx = t.indexOf(q)
  if (idx >= 0) return 300 - idx
  // fallback: todas las palabras del query aparecen
  const words = q.split(/\s+/).filter(Boolean)
  if (words.every((w) => t.includes(w))) return 100
  return 0
}

function formatDateLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const delta = Math.round((d - today) / (1000 * 60 * 60 * 24))
  if (delta === 0) return 'Hoy'
  if (delta === 1) return 'Mañana'
  if (delta === -1) return 'Ayer'
  const names = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${names[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`
}

export default function CommandPalette({ isOpen, onClose, events = [], tasks = [], onNavigate, onOpenEvent, onQuickAdd }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [isOpen])

  // Acciones siempre disponibles
  const actions = useMemo(() => ([
    { id: 'act-planner',  kind: 'action', label: 'Ir a Mi Día',      icon: 'view_day',       hint: 'planner',  run: () => onNavigate?.('planner') },
    { id: 'act-calendar', kind: 'action', label: 'Ir a Calendario',  icon: 'calendar_month', hint: 'calendar', run: () => onNavigate?.('calendar') },
    { id: 'act-day',      kind: 'action', label: 'Vista Día (hoy)',  icon: 'today',          hint: 'day',      run: () => onNavigate?.('day') },
    { id: 'act-tasks',    kind: 'action', label: 'Ir a Tareas',      icon: 'task_alt',       hint: 'tasks',    run: () => onNavigate?.('tasks') },
    { id: 'act-settings', kind: 'action', label: 'Ir a Ajustes',     icon: 'settings',       hint: 'settings', run: () => onNavigate?.('settings') },
    { id: 'act-add',      kind: 'action', label: 'Crear evento…',    icon: 'add',            hint: 'nuevo',    run: () => onQuickAdd?.() },
  ]), [onNavigate, onQuickAdd])

  // Scoring y filtrado
  const results = useMemo(() => {
    const q = query.trim()
    const scoredActions = actions
      .map((a) => ({ ...a, _s: score(`${a.label} ${a.hint}`, q) }))
      .filter((a) => a._s > 0)
      .sort((a, b) => b._s - a._s)

    const scoredEvents = (events || [])
      .map((ev) => ({
        id: `ev-${ev.id}`,
        kind: 'event',
        raw: ev,
        icon: ev.icon || 'event',
        label: ev.title || 'Sin título',
        hint: `${formatDateLabel(resolveEventDate(ev))}${ev.time ? ` · ${ev.time}` : ''}`,
        _s: score(`${ev.title} ${ev.description || ''}`, q),
      }))
      .filter((ev) => ev._s > 0)
      .sort((a, b) => b._s - a._s)
      .slice(0, 20)

    const scoredTasks = (tasks || [])
      .map((t) => ({
        id: `tk-${t.id}`,
        kind: 'task',
        raw: t,
        icon: t.done ? 'check_circle' : 'radio_button_unchecked',
        label: t.label || 'Sin título',
        hint: t.done ? 'Hecha' : t.priority || t.category || '',
        _s: score(`${t.label} ${t.priority || ''} ${t.category || ''}`, q),
      }))
      .filter((t) => t._s > 0)
      .sort((a, b) => b._s - a._s)
      .slice(0, 20)

    return { actions: scoredActions, events: scoredEvents, tasks: scoredTasks }
  }, [query, actions, events, tasks])

  // Lista aplanada para navegación con teclado
  const flat = useMemo(() => {
    const arr = []
    results.actions.forEach((a) => arr.push(a))
    results.events.forEach((e) => arr.push(e))
    results.tasks.forEach((t) => arr.push(t))
    return arr
  }, [results])

  useEffect(() => {
    if (active >= flat.length) setActive(0)
  }, [flat.length, active])

  useEffect(() => {
    // Scrollear al item activo
    const node = listRef.current?.querySelector(`[data-idx="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function runItem(item) {
    if (!item) return
    if (item.kind === 'action') item.run?.()
    else if (item.kind === 'event') onOpenEvent?.(item.raw)
    else if (item.kind === 'task') onNavigate?.('tasks')
    onClose?.()
  }

  function handleKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(flat.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runItem(flat[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[110] flex items-start justify-center bg-on-surface/40 backdrop-blur-sm p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
          role="dialog"
          aria-label="Buscar y navegar"
          aria-modal="true"
        >
          <motion.div
            className="w-full max-w-xl bg-surface rounded-2xl shadow-2xl overflow-hidden border border-slate-200/50"
            initial={{ y: -12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
              <span className="material-symbols-outlined text-[20px] text-outline">search</span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Buscar eventos, tareas o acciones…"
                className="flex-1 bg-transparent text-sm font-medium text-on-surface placeholder:text-outline/60 focus:outline-none"
                aria-label="Buscar"
              />
              <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-slate-200 text-[10px] font-semibold text-outline/80">ESC</kbd>
            </div>

            <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2">
              {flat.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-outline">Sin resultados</p>
                </div>
              )}

              {results.actions.length > 0 && (
                <Section title="Acciones">
                  {results.actions.map((a, i) => {
                    const idx = i
                    return (
                      <Row key={a.id} idx={idx} active={active === idx} onHover={() => setActive(idx)} onClick={() => runItem(a)}
                           icon={a.icon} label={a.label} hint={a.hint} />
                    )
                  })}
                </Section>
              )}

              {results.events.length > 0 && (
                <Section title="Eventos">
                  {results.events.map((ev, i) => {
                    const idx = results.actions.length + i
                    return (
                      <Row key={ev.id} idx={idx} active={active === idx} onHover={() => setActive(idx)} onClick={() => runItem(ev)}
                           icon={ev.icon} label={ev.label} hint={ev.hint} />
                    )
                  })}
                </Section>
              )}

              {results.tasks.length > 0 && (
                <Section title="Tareas">
                  {results.tasks.map((t, i) => {
                    const idx = results.actions.length + results.events.length + i
                    return (
                      <Row key={t.id} idx={idx} active={active === idx} onHover={() => setActive(idx)} onClick={() => runItem(t)}
                           icon={t.icon} label={t.label} hint={t.hint} muted={t.raw.done} />
                    )
                  })}
                </Section>
              )}
            </div>

            <div className="flex items-center justify-between px-4 py-2 bg-surface-container-low text-[10px] text-outline/80 font-semibold border-t border-slate-100">
              <div className="flex items-center gap-3">
                <span><kbd className="px-1 py-0.5 rounded bg-white/60 border border-slate-200">↑↓</kbd> navegar</span>
                <span><kbd className="px-1 py-0.5 rounded bg-white/60 border border-slate-200">↵</kbd> abrir</span>
              </div>
              <span><kbd className="px-1 py-0.5 rounded bg-white/60 border border-slate-200">⌘K</kbd> abrir paleta</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Section({ title, children }) {
  return (
    <div className="px-2 pb-1">
      <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-outline/70">{title}</p>
      <ul>{children}</ul>
    </div>
  )
}

function Row({ idx, active, onHover, onClick, icon, label, hint, muted }) {
  return (
    <li data-idx={idx}>
      <button
        type="button"
        onMouseMove={onHover}
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
          active ? 'bg-primary/10 text-on-surface' : 'hover:bg-surface-container-low text-on-surface'
        } ${muted ? 'opacity-60' : ''}`}
      >
        <span className={`material-symbols-outlined text-[20px] ${active ? 'text-primary' : 'text-outline'}`}>{icon}</span>
        <span className="flex-1 min-w-0">
          <span className={`block text-sm font-semibold truncate ${muted ? 'line-through' : ''}`}>{label}</span>
          {hint && <span className="block text-[11px] text-outline/80 truncate font-medium">{hint}</span>}
        </span>
      </button>
    </li>
  )
}

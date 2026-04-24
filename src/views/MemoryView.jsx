import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserMemories } from '../hooks/useUserMemories'

const CATEGORIES = [
  { id: 'fact',         label: 'Hechos',        icon: 'badge',            color: 'bg-blue-50 text-blue-600 border-blue-100' },
  { id: 'relationship', label: 'Relaciones',    icon: 'groups',           color: 'bg-violet-50 text-violet-600 border-violet-100' },
  { id: 'preference',   label: 'Preferencias',  icon: 'tune',             color: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
  { id: 'goal',         label: 'Metas',         icon: 'flag',             color: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'pain',         label: 'Fricciones',    icon: 'sentiment_stressed',color: 'bg-rose-50 text-rose-600 border-rose-100' },
  { id: 'routine',      label: 'Rutinas',       icon: 'autorenew',        color: 'bg-cyan-50 text-cyan-600 border-cyan-100' },
  { id: 'context',      label: 'Contexto',      icon: 'description',      color: 'bg-slate-50 text-slate-600 border-slate-100' },
]

// Muestra de dónde salió la memoria. Es clave para la confianza del usuario:
// si Nova inventó algo raro, el usuario ve "Inferido" y sabe que puede borrarlo
// sin culpa. Si lo escribió él mismo ("Tú"), tiene autoridad total.
const SOURCE_BADGES = {
  user_edited:  { label: 'Tú',          className: 'bg-slate-100 text-slate-600' },
  conversation: { label: 'De una charla', className: 'bg-blue-50 text-blue-600' },
  inferred:     { label: 'Inferido',    className: 'bg-amber-50 text-amber-700' },
}

function MemoryCard({ memory, onPin, onEdit, onDelete }) {
  const cat = CATEGORIES.find(c => c.id === memory.category) || CATEGORIES[0]
  const srcBadge = SOURCE_BADGES[memory.source] || null
  const lowConfidence = memory.confidence === 'low'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white rounded-[16px] border border-slate-100 shadow-sm p-4 flex gap-3 items-start"
    >
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${cat.color}`}>
        <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          {cat.icon}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className="text-[10px] font-bold text-slate-400">
            {cat.label}
          </span>
          {memory.subject && (
            <span className="text-[10px] font-semibold text-slate-500 bg-slate-50 rounded-full px-2 py-0.5 truncate max-w-[140px]">
              {memory.subject}
            </span>
          )}
          {srcBadge && (
            <span className={`text-[9.5px] font-bold uppercase tracking-wide rounded-full px-1.5 py-0.5 ${srcBadge.className}`}>
              {srcBadge.label}
            </span>
          )}
          {lowConfidence && (
            <span
              className="text-[9.5px] font-bold uppercase tracking-wide rounded-full px-1.5 py-0.5 bg-rose-50 text-rose-600"
              title="Nova no está segura — revísalo"
            >
              Dudoso
            </span>
          )}
          {memory.pinned && (
            <span className="material-symbols-outlined text-[13px] text-amber-500" style={{ fontVariationSettings: "'FILL' 1" }}>
              push_pin
            </span>
          )}
        </div>
        <p className="text-[13.5px] leading-snug text-slate-800">{memory.content}</p>
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          onClick={() => onPin(memory.id)}
          aria-label={memory.pinned ? 'Quitar pin' : 'Anclar'}
          className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors ${
            memory.pinned ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500'
          }`}
        >
          <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: memory.pinned ? "'FILL' 1" : "'FILL' 0" }}>
            push_pin
          </span>
        </button>
        <button
          onClick={() => onEdit(memory)}
          aria-label="Editar"
          className="h-7 w-7 rounded-full flex items-center justify-center text-slate-300 hover:bg-slate-100 hover:text-slate-500 transition-colors"
        >
          <span className="material-symbols-outlined text-[15px]">edit</span>
        </button>
        <button
          onClick={() => onDelete(memory.id)}
          aria-label="Eliminar"
          className="h-7 w-7 rounded-full flex items-center justify-center text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-colors"
        >
          <span className="material-symbols-outlined text-[15px]">delete</span>
        </button>
      </div>
    </motion.div>
  )
}

function EditDialog({ memory, onClose, onSave }) {
  const [category, setCategory] = useState(memory?.category || 'fact')
  const [subject, setSubject] = useState(memory?.subject || '')
  const [content, setContent] = useState(memory?.content || '')

  const isNew = !memory?.id
  const canSave = content.trim().length > 0

  function handleSave() {
    if (!canSave) return
    onSave({ id: memory?.id, category, subject: subject.trim() || null, content: content.trim() })
    onClose()
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm"
      />
      <div className="fixed inset-0 z-[91] flex items-center justify-center p-4 pointer-events-none">
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.96 }}
        transition={{ type: 'spring', damping: 26, stiffness: 280 }}
        className="w-full max-w-[440px] rounded-3xl bg-white p-6 shadow-2xl pointer-events-auto"
      >
        <p className="mb-5 text-[16px] font-bold text-slate-900">
          {isNew ? 'Nueva memoria' : 'Editar memoria'}
        </p>

        <label className="block mb-4">
          <span className="text-[11px] font-bold text-slate-500 block mb-2">Categoría</span>
          <div className="grid grid-cols-3 gap-1.5">
            {CATEGORIES.map(c => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 text-[10.5px] font-semibold transition-colors ${
                  category === c.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-200'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {c.icon}
                </span>
                {c.label}
              </button>
            ))}
          </div>
        </label>

        <label className="block mb-4">
          <span className="text-[11px] font-bold text-slate-500 block mb-2">Sujeto (opcional)</span>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="pareja, jefe, tesis..."
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-slate-400"
          />
        </label>

        <label className="block mb-5">
          <span className="text-[11px] font-bold text-slate-500 block mb-2">Memoria</span>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Qué debe recordar Nova..."
            rows={3}
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[13px] resize-none focus:outline-none focus:border-slate-400"
          />
        </label>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-full bg-slate-100 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-200"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 rounded-full bg-slate-900 py-2.5 text-[13px] font-semibold text-white disabled:opacity-30 hover:bg-slate-800"
          >
            Guardar
          </button>
        </div>
      </motion.div>
      </div>
    </>
  )
}

export default function MemoryView() {
  const { memories, loaded, addMemory, updateMemory, deleteMemory, togglePin } = useUserMemories()
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState(null) // null | {} para nueva | memoria para editar
  const [deletingId, setDeletingId] = useState(null)

  const filtered = useMemo(() => {
    const base = filter === 'all' ? memories : memories.filter(m => m.category === filter)
    return [...base].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '')
    })
  }, [memories, filter])

  const counts = useMemo(() => {
    const c = { all: memories.length }
    for (const cat of CATEGORIES) c[cat.id] = memories.filter(m => m.category === cat.id).length
    return c
  }, [memories])

  function handleSave(patch) {
    if (patch.id) {
      updateMemory(patch.id, patch)
    } else {
      addMemory({ ...patch, source: 'user_edited' })
    }
  }

  function confirmDelete(id) {
    setDeletingId(id)
  }

  function doDelete() {
    if (deletingId) deleteMemory(deletingId)
    setDeletingId(null)
  }

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 py-6 space-y-4 pb-40">
      <div className="px-1 mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-slate-900">Lo que Nova sabe de ti</h1>
          <p className="text-[12.5px] text-slate-500 mt-1">
            Memorias que Nova aprende en tus conversaciones para personalizar sus respuestas.
          </p>
        </div>
        <button
          onClick={() => setEditing({})}
          aria-label="Agregar memoria"
          className="flex-shrink-0 h-9 w-9 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-slate-800 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
        </button>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 pb-1">
        <div className="flex gap-1.5 min-w-max">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="Todas" count={counts.all} />
          {CATEGORIES.map(c => (
            counts[c.id] > 0 && (
              <FilterChip
                key={c.id}
                active={filter === c.id}
                onClick={() => setFilter(c.id)}
                label={c.label}
                count={counts[c.id]}
                icon={c.icon}
              />
            )
          ))}
        </div>
      </div>

      {loaded && filtered.length === 0 ? (
        <EmptyState onAdd={() => setEditing({})} hasAny={memories.length > 0} />
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="space-y-2.5">
            {filtered.map(m => (
              <MemoryCard
                key={m.id}
                memory={m}
                onPin={togglePin}
                onEdit={setEditing}
                onDelete={confirmDelete}
              />
            ))}
          </div>
        </AnimatePresence>
      )}

      <AnimatePresence>
        {editing !== null && (
          <EditDialog
            memory={editing}
            onClose={() => setEditing(null)}
            onSave={handleSave}
          />
        )}
        {deletingId && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDeletingId(null)}
              className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[91] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.96 }}
                className="w-full max-w-[360px] rounded-3xl bg-white p-6 shadow-2xl text-center pointer-events-auto"
              >
                <p className="text-[15px] font-bold text-slate-900 mb-2">¿Eliminar esta memoria?</p>
                <p className="text-[12.5px] text-slate-500 mb-5">Nova dejará de recordarlo en futuras conversaciones.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeletingId(null)}
                    className="flex-1 rounded-full bg-slate-100 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-200"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={doDelete}
                    className="flex-1 rounded-full bg-rose-600 py-2.5 text-[13px] font-semibold text-white hover:bg-rose-700"
                  >
                    Eliminar
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function FilterChip({ active, onClick, label, count, icon }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors ${
        active
          ? 'bg-slate-900 text-white'
          : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
      }`}
    >
      {icon && (
        <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          {icon}
        </span>
      )}
      {label}
      <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
        {count}
      </span>
    </button>
  )
}

function EmptyState({ onAdd, hasAny }) {
  return (
    <div className="text-center py-12 px-6">
      <div className="h-14 w-14 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 via-violet-500 to-fuchsia-500 flex items-center justify-center mb-5 shadow-lg shadow-violet-500/20">
        <span className="material-symbols-outlined text-white text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          psychology
        </span>
      </div>
      <p className="text-[15px] font-bold text-slate-800 mb-1.5">
        {hasAny ? 'Sin memorias en esta categoría' : 'Nova aún no sabe nada sobre ti'}
      </p>
      <p className="text-[12.5px] text-slate-500 max-w-[320px] mx-auto mb-5">
        {hasAny
          ? 'Cambia el filtro o agrega una memoria manualmente.'
          : 'Háblale de tu rutina, tu trabajo, tus relaciones — irá aprendiendo y referenciándolo en futuras conversaciones.'}
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-slate-800"
      >
        <span className="material-symbols-outlined text-[16px]">add</span>
        Agregar memoria
      </button>
    </div>
  )
}

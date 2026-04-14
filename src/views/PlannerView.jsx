import { useState } from 'react'
import TopAppBar from '../components/TopAppBar'
import QuickAddSheet from '../components/QuickAddSheet'

const AVATAR_1 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA6uixvLBbbeTBU4o6ECI8czwv2rG4Ab9QRoZzG80VUdtQGrNTKfEN6uAsjVY_xDejxYU0ty7i-w-WkdOwFL75tUeP3QdhnoU-aXj6gBXa_rA-EF4EnS0xA9i3U1C5A2ptq4qNGoThpYsChziALLNaGKBd5tmrg4sTexQTMX_Q76n0RKR0a6HoVsDWd3rDMM5crCyQShmr0MknscIOQMi0WkXjd-nwAlIW_5Y3hCfVOk4gFFs573xU55aE4-nN1yrW3tey74rnRdTLX'
const AVATAR_2 =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBuP-YYDCS8puBN4BdB0p1a4oljJzvzAN_GJ1lnTWJoxLpt9qIMsUE-4SWVCGzBa4bd7Z28lWv1H2krPfVj1H-oxbauQP2yyGkzV51kMnCXLIiWzp2kNCUGDr3vdI-ptHCUeYQZ4o2k5zO4JC_4Wpj-MXYYhIWpbeDm_C95308waqJo-iw_MmyWV-shmMwOE2beNt4wetEgc-JFNnb8FwwZiHB145oLw_PNHljogMsgzx3aoBguhA6Tlj-Lp4MXrM3p-ulqb2d5kwCn'

// Seed timeline blocks (suggestions start as type:'suggestion', confirmed stay as 'confirmed')
const SEED_BLOCKS = [
  {
    id: 'blk-001',
    time: '09:00',
    type: 'confirmed',
    title: 'Trabajo Profundo: Arquitectura del Sistema',
    description: 'Enfoque en el motor de navegación principal para el proyecto Sanctuary.',
    showAvatars: false,
  },
  {
    id: 'blk-002',
    time: '10:30',
    type: 'suggestion',
    title: 'Descanso Inteligente: Meditación de 15 min',
    description: 'Carga cognitiva alta detectada. Recarga para la sincro de las 11:00.',
  },
  {
    id: 'blk-003',
    time: '11:00',
    type: 'confirmed',
    title: 'Sincro con el Equipo de Producto',
    description: null,
    showAvatars: true,
  },
  {
    id: 'blk-004',
    time: '12:30',
    type: 'suggestion',
    title: 'Sugerido: Inbox Zero (20m)',
    description: 'Tienes 12 mensajes urgentes sin leer en Slack.',
  },
]

const SEED_TASKS = [
  { id: 'tsk-001', label: 'Revisar Roadmap del Q4', done: false },
  { id: 'tsk-002', label: 'Preparar diapositivas de presentación', done: false },
]

export default function PlannerView({ onAddEvent }) {
  const [blocks, setBlocks] = useState(SEED_BLOCKS)
  const [tasks, setTasks] = useState(SEED_TASKS)
  const [showModal, setShowModal] = useState(false)

  // ── Accept a suggestion → promote to confirmed ─────────────────────────────
  function acceptSuggestion(id) {
    console.log(`[Sanctuary] ✅ Planner: accepting suggestion block id="${id}"`)
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, type: 'confirmed' } : b)),
    )
  }

  // ── Dismiss a confirmed block ──────────────────────────────────────────────
  function dismissBlock(id) {
    console.log(`[Sanctuary] 🗑️ Planner: dismissing block id="${id}"`)
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  // ── Toggle task checkbox ───────────────────────────────────────────────────
  function toggleTask(id) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const next = { ...t, done: !t.done }
        console.log(`[Sanctuary] ☑️ Task "${t.label}" → ${next.done ? 'done' : 'pending'}`)
        return next
      }),
    )
  }

  // ── Add event via modal ────────────────────────────────────────────────────
  function handleModalSave(formData) {
    // Add to the global calendar via prop
    if (onAddEvent) onAddEvent(formData)
    // Also add a confirmed block to the local timeline
    const newBlock = {
      id: `blk-${Date.now()}`,
      time: formData.time || '—',
      type: 'confirmed',
      title: formData.title,
      description: formData.description || null,
      showAvatars: false,
    }
    console.log(`[Sanctuary] ➕ Planner: adding new block "${newBlock.title}"`)
    setBlocks((prev) => [...prev, newBlock])
    setShowModal(false)
  }

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen pb-32">
      <TopAppBar />

      <main className="max-w-7xl mx-auto px-6 pt-8">
        <div className="flex flex-col md:flex-row gap-12">

          {/* ── Left: Timeline ────────────────────────────────────────────── */}
          <div className="flex-1">
            <header className="mb-10 flex justify-between items-end">
              <div>
                <p className="text-primary font-semibold tracking-wider text-xs uppercase mb-2">
                  Martes, 24 de Oct
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
              {blocks.map(({ id, time, type, title, description, showAvatars }) => {
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
                      <div className={`p-5 rounded-xl ${
                        isSuggestion
                          ? 'bg-surface-container-low/50 border border-dashed border-secondary/30'
                          : 'bg-surface-container-lowest shadow-[0_12px_32px_rgba(27,27,29,0.04)] border-l-4 border-primary'
                      }`}>
                        <div className="flex justify-between items-start mb-1 gap-3">
                          <h3 className={`font-bold flex-1 ${isSuggestion ? 'text-secondary' : 'text-on-surface'}`}>
                            {title}
                          </h3>
                          {isSuggestion ? (
                            <button
                              onClick={() => acceptSuggestion(id)}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-secondary/20 hover:bg-secondary/10 text-secondary transition-colors flex-shrink-0"
                            >
                              ACEPTAR
                            </button>
                          ) : (
                            <button
                              onClick={() => dismissBlock(id)}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed hover:bg-error/10 hover:text-error transition-colors flex-shrink-0"
                            >
                              CONFIRMAR ✓
                            </button>
                          )}
                        </div>
                        {description && (
                          <p className={`text-sm leading-relaxed ${isSuggestion ? 'italic text-on-surface-variant/70' : 'text-on-surface-variant'}`}>
                            {description}
                          </p>
                        )}
                        {showAvatars && (
                          <div className="flex items-center gap-2 mt-3">
                            <div className="flex -space-x-2">
                              <img alt="Team member" className="w-6 h-6 rounded-full border-2 border-surface object-cover" src={AVATAR_1} />
                              <img alt="Team member" className="w-6 h-6 rounded-full border-2 border-surface object-cover" src={AVATAR_2} />
                            </div>
                            <span className="text-xs text-on-surface-variant">con el Equipo de Producto</span>
                          </div>
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

          {/* ── Right: Insights + Tasks ────────────────────────────────────── */}
          <div className="w-full md:w-80 space-y-8">
            {/* Intelligence Card */}
            <div className="bg-surface-container-high/40 p-6 rounded-[24px] backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
                  auto_awesome
                </span>
                <h4 className="font-headline font-bold text-on-surface">Resumen IA</h4>
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-surface-container-lowest rounded-xl">
                  <p className="text-xs font-bold text-primary mb-1 uppercase tracking-tight">MÁXIMA CONCENTRACIÓN</p>
                  <p className="text-sm text-on-surface-variant font-medium">
                    Tu energía alcanza su pico entre las 09:00 - 11:30. {blocks.filter((b) => b.type === 'confirmed').length} bloques confirmados.
                  </p>
                </div>
                <div className="p-4 bg-surface-container-lowest rounded-xl">
                  <p className="text-xs font-bold text-secondary mb-1 uppercase tracking-tight">ANÁLISIS DE HUECOS</p>
                  <p className="text-sm text-on-surface-variant font-medium">
                    {blocks.filter((b) => b.type === 'suggestion').length} sugerencia(s) pendiente(s) de aceptar.
                  </p>
                </div>
              </div>
            </div>

            {/* Priority Tasks */}
            <div>
              <div className="flex justify-between items-center mb-4 px-2">
                <h4 className="font-headline font-bold text-on-surface">Tareas</h4>
                <button
                  onClick={() => {
                    const label = prompt('Nueva tarea:')
                    if (!label?.trim()) return
                    const newTask = { id: `tsk-${Date.now()}`, label: label.trim(), done: false }
                    console.log(`[Sanctuary] ➕ Task added: "${newTask.label}"`)
                    setTasks((prev) => [...prev, newTask])
                  }}
                  className="text-primary hover:bg-primary/10 rounded-full p-1 transition-colors"
                  title="Añadir tarea"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {tasks.map(({ id, label, done }) => (
                  <div
                    key={id}
                    className={`bg-surface-container-lowest p-4 rounded-2xl shadow-sm border-l-4 transition-all ${
                      done ? 'border-outline-variant opacity-60' : 'border-secondary-container'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`text-sm font-semibold text-on-surface ${done ? 'line-through text-outline' : ''}`}>
                        {label}
                      </span>
                      <button
                        onClick={() => toggleTask(id)}
                        className="flex-shrink-0 transition-all active:scale-90"
                      >
                        <span
                          className={`material-symbols-outlined text-lg transition-colors ${done ? 'text-primary' : 'text-outline-variant hover:text-primary'}`}
                          style={done ? { fontVariationSettings: "'FILL' 1" } : {}}
                        >
                          {done ? 'check_circle' : 'radio_button_unchecked'}
                        </span>
                      </button>
                    </div>
                  </div>
                ))}

                {tasks.length === 0 && (
                  <div className="bg-surface-container-lowest p-4 rounded-2xl text-center text-outline text-sm font-semibold">
                    Sin tareas. Pulsa + para añadir.
                  </div>
                )}

                {/* Goal card */}
                <div className="bg-primary p-6 rounded-[24px] text-white shadow-xl shadow-primary/20">
                  <h5 className="text-lg font-bold mb-2">Mi Meta</h5>
                  <p className="text-primary-fixed text-sm mb-4 leading-relaxed opacity-90">
                    Terminar la documentación arquitectónica para la nueva capa de datos.
                  </p>
                  <div className="w-full bg-white/20 h-1 rounded-full overflow-hidden">
                    <div
                      className="bg-white h-full transition-all duration-500"
                      style={{ width: `${tasks.length === 0 ? 100 : Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] mt-2 font-bold uppercase tracking-widest opacity-70">
                    {tasks.length === 0
                      ? '100% COMPLETADO'
                      : `${Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100)}% COMPLETADO`}
                  </p>
                </div>
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
    </div>
  )
}

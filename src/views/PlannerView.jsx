import { useState } from 'react'
import TopAppBar from '../components/TopAppBar'
import QuickAddSheet from '../components/QuickAddSheet'

// ── Helpers ────────────────────────────────────────────────────────────────
const DAY_NAMES_ES   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

function formatToday() {
  const d = new Date()
  return `${DAY_NAMES_ES[d.getDay()]}, ${d.getDate()} de ${MONTH_NAMES_ES[d.getMonth()]}`
}

// ── Seed timeline blocks ───────────────────────────────────────────────────
const SEED_BLOCKS = [
  {
    id: 'blk-001',
    time: '09:00',
    type: 'confirmed',
    title: 'Trabajo Profundo: Arquitectura del Sistema',
    description: 'Bloque de máxima concentración. Sin interrupciones.',
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
  },
  {
    id: 'blk-004',
    time: '12:30',
    type: 'suggestion',
    title: 'Sugerido: Inbox Zero (20 min)',
    description: 'Tienes mensajes urgentes sin leer.',
  },
]

// Energy blocks by hour range (for the insight card)
const ENERGY_PEAK_START = 9
const ENERGY_PEAK_END   = 11.5

function currentHour() {
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}

function isInPeak() {
  const h = currentHour()
  return h >= ENERGY_PEAK_START && h < ENERGY_PEAK_END
}

// ── Component ─────────────────────────────────────────────────────────────
export default function PlannerView({ onAddEvent }) {
  const [blocks, setBlocks] = useState(SEED_BLOCKS)
  const [showModal, setShowModal] = useState(false)

  function acceptSuggestion(id) {
    console.log(`[Focus] ✅ Planner: accepting suggestion id="${id}"`)
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, type: 'confirmed' } : b)))
  }

  function dismissBlock(id) {
    console.log(`[Focus] 🗑️ Planner: dismissing block id="${id}"`)
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  function handleModalSave(formData) {
    if (onAddEvent) onAddEvent(formData)
    const newBlock = {
      id: `blk-${Date.now()}`,
      time: formData.time || '—',
      type: 'confirmed',
      title: formData.title,
      description: formData.description || null,
    }
    console.log(`[Focus] ➕ Planner: adding new block "${newBlock.title}"`)
    setBlocks((prev) => [...prev, newBlock])
    setShowModal(false)
  }

  const confirmedCount  = blocks.filter((b) => b.type === 'confirmed').length
  const suggestionCount = blocks.filter((b) => b.type === 'suggestion').length
  const inPeak          = isInPeak()

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

          {/* ── Right: Insights ───────────────────────────────────────────── */}
          <div className="w-full md:w-80 space-y-6">

            {/* Energy peak card */}
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
              </div>
              <p className={`text-sm font-medium leading-relaxed ${inPeak ? 'text-white/80' : 'text-on-surface-variant'}`}>
                {inPeak
                  ? 'Ahora mismo es tu mejor ventana de concentración. Prioriza trabajo profundo sin interrupciones.'
                  : `Tu ventana de máxima concentración es de ${ENERGY_PEAK_START}:00 a ${Math.floor(ENERGY_PEAK_END)}:${String(Math.round((ENERGY_PEAK_END % 1) * 60)).padStart(2, '0')}. Guarda las tareas difíciles para ese bloque.`}
              </p>
            </div>

            {/* Intelligence Card */}
            <div className="bg-surface-container-high/40 p-6 rounded-[24px] backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
                  auto_awesome
                </span>
                <h4 className="font-headline font-bold text-on-surface">Resumen IA</h4>
              </div>
              <div className="space-y-3">
                <div className="p-4 bg-surface-container-lowest rounded-xl">
                  <p className="text-xs font-bold text-primary mb-1 uppercase tracking-tight">BLOQUES ACTIVOS</p>
                  <p className="text-sm text-on-surface-variant font-medium">
                    {confirmedCount} bloque{confirmedCount !== 1 ? 's' : ''} confirmado{confirmedCount !== 1 ? 's' : ''} en tu agenda de hoy.
                  </p>
                </div>
                <div className="p-4 bg-surface-container-lowest rounded-xl">
                  <p className="text-xs font-bold text-secondary mb-1 uppercase tracking-tight">SUGERENCIAS</p>
                  <p className="text-sm text-on-surface-variant font-medium">
                    {suggestionCount > 0
                      ? `${suggestionCount} sugerencia${suggestionCount !== 1 ? 's' : ''} pendiente${suggestionCount !== 1 ? 's' : ''} de aceptar.`
                      : 'Sin sugerencias pendientes.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Focus mode tip */}
            <div className="bg-gradient-to-br from-secondary/10 to-primary/5 p-5 rounded-[24px] border border-primary/10">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="material-symbols-outlined text-primary text-[16px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  tips_and_updates
                </span>
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
                  Patrón · Time Blocking
                </span>
              </div>
              <p className="text-xs text-on-surface-variant font-medium leading-relaxed">
                Divide tu día en bloques dedicados. Los estudios muestran que el trabajo en bloques
                aumenta la productividad hasta un <span className="text-on-surface font-bold">80%</span> frente a las listas de tareas convencionales.
              </p>
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

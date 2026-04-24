import { useState, useEffect, useRef, useMemo } from 'react'
import { pushModal, popModal } from '../utils/modalStack'

// Wizard conversacional para crear una reunión semanal fija. El usuario entra
// por el chip del empty state del planner y avanza en 4 pasos (nombre → día y
// hora → duración → preview). Genera 12 ocurrencias semanales a partir de la
// próxima instancia del weekday elegido (no hoy, aunque hoy coincida — la
// primera reunión "empieza la próxima semana").
//
// No existe un modelo de recurrencia en la app; expandimos a N eventos
// individuales vía onCreate, que cada uno los inyecta con onAddEvent. Esto
// mantiene todo el resto del sistema (Mi Día, export ICS, recordatorios) sin
// cambios, al costo de 12 filas en vez de 1 RRULE. Aceptable para una feature
// de onboarding que seguramente genera pocas reuniones totales.

const DAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
]

const DURATIONS = [
  { min: 15, label: '15 min' },
  { min: 30, label: '30 min' },
  { min: 45, label: '45 min' },
  { min: 60, label: '1 h' },
  { min: 90, label: '1 h 30' },
  { min: 120, label: '2 h' },
]

const REPEAT_COUNT = 12

function format12(h, m) {
  const period = h < 12 ? 'AM' : 'PM'
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hh}:${String(m).padStart(2, '0')} ${period}`
}

function addMinutes(h, m, minutes) {
  const total = h * 60 + m + minutes
  return [Math.floor(total / 60) % 24, total % 60]
}

// Próxima fecha con el weekday dado, excluyendo hoy. "Empieza la próxima
// semana" es la promesa que hacemos al usuario en la preview.
function nextWeekday(weekday) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const today = d.getDay()
  let diff = (weekday - today + 7) % 7
  if (diff === 0) diff = 7
  d.setDate(d.getDate() + diff)
  return d
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function RecurringMeetingSheet({ onCreate, onCancel }) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [weekday, setWeekday] = useState(1)
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)
  const [duration, setDuration] = useState(30)
  const nameInputRef = useRef(null)

  // Auto-focus al entrar en el paso de nombre. En iOS PWA requiere un pequeño
  // delay para que el teclado no se abra mientras la animación de entrada
  // todavía está corriendo.
  useEffect(() => {
    if (step === 1) {
      const t = setTimeout(() => nameInputRef.current?.focus(), 120)
      return () => clearTimeout(t)
    }
  }, [step])

  // Registro como modal activo para ocultar flotantes (Nova pill, FABs)
  // mientras el wizard de recurrente esté abierto.
  useEffect(() => {
    pushModal()
    return () => popModal()
  }, [])

  const dayLabel = DAYS.find(d => d.value === weekday)?.label || 'Lunes'
  const [endH, endM] = addMinutes(hour, minute, duration)
  const timeRange = `${format12(hour, minute)} - ${format12(endH, endM)}`
  const durationLabel = DURATIONS.find(d => d.min === duration)?.label || `${duration} min`

  const firstDate = useMemo(() => nextWeekday(weekday), [weekday])

  function goNext() { setStep(s => Math.min(4, s + 1)) }
  function goBack() {
    if (step === 1) onCancel()
    else setStep(s => s - 1)
  }

  function handleCreate() {
    const base = nextWeekday(weekday)
    const events = []
    for (let i = 0; i < REPEAT_COUNT; i++) {
      const d = new Date(base)
      d.setDate(base.getDate() + i * 7)
      events.push({
        title: name.trim() || 'Reunión',
        time: timeRange,
        date: toISO(d),
        section: 'focus',
        icon: 'event_repeat',
        dotColor: 'bg-secondary-container',
      })
    }
    onCreate({ events, summary: `${name.trim() || 'Reunión'} · ${dayLabel} ${format12(hour, minute)}` })
  }

  const canAdvance = step === 1 ? name.trim().length > 0 : true

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />

      <div
        className="relative w-full max-w-lg max-h-[92dvh] overflow-y-auto bg-surface rounded-t-[32px] px-6 pt-5 shadow-2xl z-10"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2.5rem)' }}
      >
        <div className="w-10 h-1 bg-outline-variant rounded-full mx-auto mb-5" />

        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-md shadow-blue-200">
            <span
              className="material-symbols-outlined text-[17px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              event_repeat
            </span>
          </div>
          <div>
            <h2 className="font-headline font-extrabold text-[17px] text-on-surface leading-tight">
              Reunión semanal fija
            </h2>
            <p className="text-[11.5px] text-outline">Paso {step} de 4</p>
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <p className="font-nova text-[14.5px] text-on-surface">
              Vamos a crear una reunión semanal fija. ¿Cómo se llama la reunión?
            </p>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canAdvance) goNext() }}
              placeholder="Ej: Stand-up del equipo"
              className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-[14px] text-on-surface outline-none focus:border-primary"
              maxLength={80}
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="font-nova text-[14.5px] text-on-surface">
              ¿Qué día de la semana y a qué hora quieres hacerla?
            </p>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-outline">
                Día
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {DAYS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setWeekday(d.value)}
                    className={`rounded-lg px-2 py-2 text-[12px] font-medium transition-colors ${
                      weekday === d.value
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container-low border border-outline-variant/30'
                    }`}
                  >
                    {d.label.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-outline">
                Hora de inicio
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={hour}
                  onChange={(e) => setHour(parseInt(e.target.value, 10))}
                  className="flex-1 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-3 text-[14px] text-on-surface outline-none focus:border-primary"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {format12(h, 0).split(' ')[0]} {h < 12 ? 'AM' : 'PM'}
                    </option>
                  ))}
                </select>
                <span className="text-on-surface">:</span>
                <select
                  value={minute}
                  onChange={(e) => setMinute(parseInt(e.target.value, 10))}
                  className="flex-1 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-3 text-[14px] text-on-surface outline-none focus:border-primary"
                >
                  {[0, 15, 30, 45].map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="font-nova text-[14.5px] text-on-surface">
              ¿Cuánto dura?
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.min}
                  onClick={() => setDuration(d.min)}
                  className={`rounded-xl px-3 py-3 text-[13px] font-medium transition-colors ${
                    duration === d.min
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container-low border border-outline-variant/30'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <p className="font-nova text-[14.5px] text-on-surface">
              Así queda tu reunión. ¿La creamos?
            </p>
            <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">event_repeat</span>
                <p className="text-[15px] font-semibold text-on-surface truncate">
                  {name.trim() || 'Reunión'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-[12.5px] text-outline">
                <span className="material-symbols-outlined text-[15px]">event</span>
                <span>Todos los {dayLabel.toLowerCase()}</span>
              </div>
              <div className="flex items-center gap-2 text-[12.5px] text-outline">
                <span className="material-symbols-outlined text-[15px]">schedule</span>
                <span>{timeRange} · {durationLabel}</span>
              </div>
              <div className="flex items-center gap-2 text-[12.5px] text-outline">
                <span className="material-symbols-outlined text-[15px]">play_arrow</span>
                <span>
                  Empieza {dayLabel.toLowerCase()} {firstDate.getDate()} · {REPEAT_COUNT} repeticiones
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-2">
          {step < 4 ? (
            <>
              <button
                onClick={goBack}
                className="rounded-full px-4 py-2.5 text-[13px] font-medium text-outline transition-colors hover:bg-surface-container-low"
              >
                {step === 1 ? 'Cancelar' : 'Atrás'}
              </button>
              <button
                onClick={goNext}
                disabled={!canAdvance}
                className="flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-[13px] font-semibold text-on-primary transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continuar
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </>
          ) : (
            // Paso 4: Cancelar / Editar / Crear, tal como pidió el spec. Editar
            // vuelve al primer paso con los campos ya rellenos (el estado no
            // se resetea) para que el usuario ajuste sin perder nada.
            <>
              <button
                onClick={onCancel}
                className="rounded-full px-4 py-2.5 text-[13px] font-medium text-outline transition-colors hover:bg-surface-container-low"
              >
                Cancelar
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep(1)}
                  className="rounded-full px-4 py-2.5 text-[13px] font-medium text-on-surface transition-colors hover:bg-surface-container-low"
                >
                  Editar
                </button>
                <button
                  onClick={handleCreate}
                  className="flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-[13px] font-semibold text-on-primary transition-all active:scale-95"
                >
                  <span className="material-symbols-outlined text-[16px]">check</span>
                  Crear
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

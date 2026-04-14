/**
 * ProfileSetupCard
 *
 * Tarjeta inline de onboarding — aparece UNA sola vez en Mi Día.
 * 2 preguntas rápidas (cronobio + rol) sin formulario, solo botones.
 */

import { useState } from 'react'

const CHRONOTYPES = [
  { id: 'morning',   emoji: '🌅', label: 'Mañana',   sub: '6 AM – 12 PM' },
  { id: 'afternoon', emoji: '☀️', label: 'Tarde',    sub: '1 PM – 6 PM'  },
  { id: 'night',     emoji: '🌙', label: 'Noche',    sub: '7 PM – 11 PM' },
]

const ROLES = [
  { id: 'student',   icon: 'menu_book',  label: 'Estudiante'       },
  { id: 'worker',    icon: 'work',       label: 'Trabajo / Oficina' },
  { id: 'freelance', icon: 'laptop_mac', label: 'Freelance'        },
  { id: 'other',     icon: 'person',     label: 'Otro'             },
]

export default function ProfileSetupCard({ onSave, onSnooze }) {
  const [chronotype, setChronotype] = useState(null)
  const [role, setRole]             = useState(null)

  const canSave = chronotype && role

  return (
    <div className="mx-6 mb-6 p-5 rounded-[24px] bg-gradient-to-br from-primary/8 to-secondary/5 border border-primary/15 shadow-sm">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
            <span
              className="material-symbols-outlined text-primary text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              auto_awesome
            </span>
          </div>
          <div>
            <p className="font-extrabold text-on-surface text-sm leading-tight">Personaliza tu experiencia</p>
            <p className="text-xs text-outline font-medium mt-0.5">2 preguntas · 15 segundos</p>
          </div>
        </div>
        <button
          onClick={onSnooze}
          className="text-outline hover:text-on-surface transition-colors mt-0.5"
          aria-label="Ahora no"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Pregunta 1: Cronobio */}
      <div className="mb-5">
        <p className="text-xs font-bold text-on-surface uppercase tracking-wider mb-3">
          ¿Cuándo rindes mejor?
        </p>
        <div className="grid grid-cols-3 gap-2">
          {CHRONOTYPES.map(({ id, emoji, label, sub }) => {
            const selected = chronotype === id
            return (
              <button
                key={id}
                onClick={() => setChronotype(id)}
                className={`flex flex-col items-center gap-1 py-3 px-2 rounded-2xl border-2 transition-all active:scale-95 ${
                  selected
                    ? 'border-primary bg-primary text-white shadow-md shadow-primary/20'
                    : 'border-outline/15 bg-surface-container-lowest text-on-surface hover:border-primary/30'
                }`}
              >
                <span className="text-xl leading-none">{emoji}</span>
                <span className="font-bold text-xs leading-tight">{label}</span>
                <span className={`text-[10px] font-medium leading-tight ${selected ? 'text-white/70' : 'text-outline'}`}>
                  {sub}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Pregunta 2: Rol */}
      <div className="mb-5">
        <p className="text-xs font-bold text-on-surface uppercase tracking-wider mb-3">
          ¿Qué describes mejor lo que haces?
        </p>
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map(({ id, icon, label }) => {
            const selected = role === id
            return (
              <button
                key={id}
                onClick={() => setRole(id)}
                className={`flex items-center gap-2.5 px-3.5 py-3 rounded-2xl border-2 transition-all active:scale-95 ${
                  selected
                    ? 'border-primary bg-primary text-white shadow-md shadow-primary/20'
                    : 'border-outline/15 bg-surface-container-lowest text-on-surface hover:border-primary/30'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[18px] flex-shrink-0 ${selected ? 'text-white' : 'text-primary'}`}
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  {icon}
                </span>
                <span className="font-semibold text-xs leading-tight text-left">{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <button
        onClick={() => canSave && onSave({ chronotype, role })}
        disabled={!canSave}
        className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-30 active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-[18px]">check</span>
        Listo — personalizar mi app
      </button>
    </div>
  )
}

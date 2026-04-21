import { motion } from 'framer-motion'

export default function BottomNavBar({ activeView, onNavigate }) {
  const navItems = [
    { id: 'planner',  icon: 'view_day',       label: 'Mi Día'     },
    { id: 'calendar', icon: 'calendar_month', label: 'Calendario' },
    { id: 'tasks',    icon: 'task_alt',        label: 'Tareas'     },
    { id: 'settings', icon: 'settings',        label: 'Ajustes'    },
  ]

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed left-1/2 -translate-x-1/2 w-[92%] rounded-[24px] z-50 flex justify-around items-center px-4 py-3 bg-slate-50/70 backdrop-blur-2xl shadow-[0_12px_32px_rgba(0,0,0,0.06)]"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
    >
      {navItems.map(({ id, icon, label }) => {
        const isActive = activeView === id
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2 font-['Inter'] text-[11px] font-semibold transition-colors duration-300 ${
              isActive ? 'text-blue-600' : 'text-slate-400 hover:text-blue-500'
            }`}
          >
            <span
              className="material-symbols-outlined"
              aria-hidden="true"
              style={isActive ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : {}}
            >
              {icon}
            </span>
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

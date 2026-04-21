const navItems = [
  { id: 'planner',  icon: 'view_day',       label: 'Mi Día'     },
  { id: 'calendar', icon: 'calendar_month', label: 'Calendario' },
  { id: 'tasks',    icon: 'task_alt',       label: 'Tareas'     },
  { id: 'settings', icon: 'settings',       label: 'Ajustes'    },
]

export default function DesktopSideBar({ activeView, onNavigate }) {
  return (
    <aside className="fixed top-16 left-0 bottom-0 w-[72px] bg-white border-r border-slate-200 z-30 flex flex-col items-center py-4 gap-1">
      {navItems.map(({ id, icon, label }) => {
        const isActive = activeView === id
        const handleClick = () => onNavigate(id)
        return (
          <button
            key={id}
            type="button"
            onClick={handleClick}
            title={label}
            className={`w-12 h-12 flex flex-col items-center justify-center rounded-xl transition-colors group ${
              isActive ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:text-primary hover:bg-slate-50'
            }`}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
          >
            <span
              className="material-symbols-outlined text-[22px]"
              style={isActive ? { fontVariationSettings: "'FILL' 1, 'wght' 500" } : {}}
            >
              {icon}
            </span>
            <span className="text-[9px] font-semibold mt-0.5 leading-none">{label}</span>
          </button>
        )
      })}
    </aside>
  )
}

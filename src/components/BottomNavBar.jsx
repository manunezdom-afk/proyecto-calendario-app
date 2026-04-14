export default function BottomNavBar({ activeView, onNavigate }) {
  const navItems = [
    { id: 'planner', icon: 'calendar_today', label: 'Planificador' },
    { id: 'calendar', icon: 'calendar_month', label: 'Calendario' },
    { id: 'assistant', icon: 'auto_awesome', label: 'Asistente' },
    { id: 'tasks', icon: 'checklist', label: 'Tareas' },
  ]

  return (
    <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] rounded-[24px] z-50 flex justify-around items-center px-4 py-3 bg-slate-50/70 backdrop-blur-2xl shadow-[0_12px_32px_rgba(0,0,0,0.06)]">
      {navItems.map(({ id, icon, label }) => {
        const isActive = activeView === id
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`flex flex-col items-center gap-1 font-['Inter'] text-[11px] font-semibold tracking-wide transition-colors active:scale-95 duration-300 ${
              isActive ? 'text-blue-600' : 'text-slate-400 hover:text-blue-500'
            }`}
          >
            <span
              className="material-symbols-outlined"
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

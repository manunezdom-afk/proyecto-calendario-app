import { motion, LayoutGroup } from 'framer-motion'

const navItems = [
  { id: 'planner',  icon: 'view_day',       label: 'Mi Día'     },
  { id: 'calendar', icon: 'calendar_month', label: 'Calendario' },
  { id: 'tasks',    icon: 'task_alt',       label: 'Tareas'     },
  { id: 'settings', icon: 'settings',       label: 'Ajustes'    },
]

// Sidebar responsive:
//   - lg (1024-1279): rail compacto de 72px con iconos + micro-label.
//   - xl (1280+):     sidebar expandida 248px con logo, nav con labels
//                     grandes, botón "Nuevo" destacado y contador de bandeja.
// Mobile (< lg) no monta el componente (App.jsx ya gate'a con isDesktop).
export default function DesktopSideBar({
  activeView,
  onNavigate,
  onNew,
  inboxCount = 0,
  onInboxClick,
}) {
  return (
    <aside className="fixed top-0 left-0 bottom-0 w-[72px] xl:w-[248px] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-[55] flex flex-col">
      {/* Header con logo — siempre visible; la sidebar "posee" el logo en
          desktop y el TopAppBar lo oculta en xl para no duplicar. En lg
          (72px) se renderiza solo el icono. */}
      <div
        className="flex items-center gap-2 px-5 h-16 border-b border-slate-100 dark:border-slate-800 flex-shrink-0 justify-center xl:justify-start"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <span
          className="material-symbols-outlined text-primary text-[26px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          brightness_high
        </span>
        <span className="hidden xl:inline text-xl font-extrabold text-slate-900 dark:text-slate-100 font-headline tracking-tight">
          Focus
        </span>
      </div>

      {/* Botón "Nuevo" destacado — solo xl */}
      {onNew && (
        <div className="hidden xl:block px-4 pt-4 pb-2 flex-shrink-0">
          <button
            type="button"
            onClick={onNew}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-primary text-white font-bold text-[14px] shadow-[0_6px_16px_rgba(59,130,246,0.25)] hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              add
            </span>
            Nuevo
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-3 xl:py-2 px-2 xl:px-3 flex flex-col gap-1">
        <LayoutGroup id="desktop-sidebar">
          {navItems.map(({ id, icon, label }) => {
            const isActive = activeView === id
            const handleClick = () => onNavigate(id)
            return (
              <button
                key={id}
                type="button"
                onClick={handleClick}
                title={label}
                className={`relative flex items-center rounded-xl transition-colors group
                  w-12 h-12 flex-col justify-center self-center
                  xl:w-full xl:h-11 xl:flex-row xl:justify-start xl:gap-3 xl:self-auto xl:px-3
                  ${isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-slate-400 dark:text-slate-500 hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <motion.span
                    layoutId="desktop-sidebar-accent"
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-primary xl:hidden"
                    transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                    aria-hidden="true"
                  />
                )}
                <span
                  className="material-symbols-outlined text-[22px] xl:text-[22px]"
                  style={isActive ? { fontVariationSettings: "'FILL' 1, 'wght' 500" } : {}}
                >
                  {icon}
                </span>
                <span className="text-[9px] font-semibold mt-0.5 leading-none xl:hidden">{label}</span>
                <span className="hidden xl:inline text-[14px] font-semibold">{label}</span>
              </button>
            )
          })}
        </LayoutGroup>

        {/* Bandeja con contador — solo xl, bajo los items de nav */}
        {onInboxClick && (
          <button
            type="button"
            onClick={onInboxClick}
            className="hidden xl:flex items-center gap-3 w-full h-11 rounded-xl px-3 text-slate-400 dark:text-slate-500 hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors mt-1"
            aria-label="Bandeja de Nova"
          >
            <span className="material-symbols-outlined text-[22px]" style={inboxCount > 0 ? { fontVariationSettings: "'FILL' 1" } : {}}>
              inbox
            </span>
            <span className="text-[14px] font-semibold flex-1 text-left">Bandeja</span>
            {inboxCount > 0 && (
              <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[10px] font-black flex items-center justify-center leading-none">
                {inboxCount > 9 ? '9+' : inboxCount}
              </span>
            )}
          </button>
        )}
      </nav>
    </aside>
  )
}

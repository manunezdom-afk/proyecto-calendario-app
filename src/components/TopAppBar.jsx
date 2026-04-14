export default function TopAppBar({
  showBack = false,
  onBack,
  onBellClick,
  unreadCount = 0,
  onToggleDark,
  isDark = false,
}) {
  return (
    <nav className="sticky top-0 z-50 bg-slate-50/70 dark:bg-slate-900/70 backdrop-blur-lg flex justify-between items-center w-full px-6 py-4">
      {/* Left: back button OR logo */}
      <div className="flex items-center gap-3">
        {showBack ? (
          <button
            onClick={onBack}
            className="hover:opacity-80 transition-opacity active:scale-90 duration-300"
          >
            <span className="material-symbols-outlined text-on-surface">arrow_back</span>
          </button>
        ) : null}
        <div className="flex items-center gap-1.5">
          <span
            className="material-symbols-outlined text-primary text-[22px]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            brightness_high
          </span>
          <span className="text-lg font-extrabold text-slate-900 dark:text-slate-100 tracking-tight font-headline">
            Focus
          </span>
        </div>
      </div>

      {/* Right: dark mode toggle + bell */}
      <div className="flex items-center gap-1">
        {onToggleDark && (
          <button
            onClick={onToggleDark}
            aria-label={isDark ? 'Activar modo claro' : 'Activar modo oscuro'}
            className="w-10 h-10 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-300 hover:opacity-80 transition-opacity active:scale-90 duration-300"
          >
            <span className="material-symbols-outlined text-[22px]">
              {isDark ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
        )}

        <button
          onClick={onBellClick}
          className="relative w-10 h-10 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-300 hover:opacity-80 transition-opacity active:scale-90 duration-300"
          aria-label="Notificaciones"
        >
          <span
            className={`material-symbols-outlined text-[22px] ${unreadCount > 0 ? 'text-primary' : ''}`}
            style={unreadCount > 0 ? { fontVariationSettings: "'FILL' 1" } : {}}
          >
            notifications
          </span>
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary text-white text-[9px] font-black flex items-center justify-center leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </nav>
  )
}

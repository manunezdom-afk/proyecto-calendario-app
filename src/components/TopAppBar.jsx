import { useAuth } from '../context/AuthContext'

export default function TopAppBar({
  showBack = false,
  onBack,
  onBellClick,
  unreadCount = 0,
  onShareClick,
  onInboxClick,
  inboxCount = 0,
}) {
  const { user, setAuthModal } = useAuth()

  return (
    <nav
      className="sticky top-0 z-50 bg-slate-50/70 dark:bg-slate-900/70 backdrop-blur-lg flex justify-between items-center w-full px-4 lg:px-6 pb-4"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
    >
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
          <span className="text-lg font-extrabold text-slate-900 dark:text-slate-100 font-headline">
            Focus
          </span>
        </div>
      </div>

      {/* Right: account + share + bell */}
      <div className="flex items-center gap-1 lg:gap-2">
        <button
          onClick={() => setAuthModal(true)}
          aria-label={user ? 'Tu cuenta' : 'Iniciar sesión'}
          title={user ? user.email : 'Iniciar sesión'}
          className="h-10 flex items-center gap-1.5 px-2 lg:px-3 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 duration-200"
        >
          <span
            className={`material-symbols-outlined text-[22px] ${user ? 'text-primary' : 'text-slate-400'}`}
            style={user ? { fontVariationSettings: "'FILL' 1" } : {}}
          >
            {user ? 'account_circle' : 'login'}
          </span>
          <span className="hidden lg:inline text-[13px] font-semibold text-slate-600 dark:text-slate-300">
            {user ? 'Cuenta' : 'Iniciar sesión'}
          </span>
        </button>

        {onShareClick && (
          <button
            onClick={onShareClick}
            aria-label="Importar / Exportar calendario"
            title="Importar / Exportar"
            className="h-10 flex items-center gap-1.5 px-2 lg:px-3 rounded-full text-slate-400 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 duration-200"
          >
            <span className="material-symbols-outlined text-[22px]">ios_share</span>
            <span className="hidden lg:inline text-[13px] font-semibold text-slate-600 dark:text-slate-300">Importar</span>
          </button>
        )}

        {onInboxClick && (
          <button
            onClick={onInboxClick}
            aria-label="Bandeja de Nova"
            title="Bandeja de Nova"
            className="relative h-10 flex items-center gap-1.5 px-2 lg:px-3 rounded-full text-slate-400 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 duration-200"
          >
            <span
              className={`material-symbols-outlined text-[22px] ${inboxCount > 0 ? 'text-primary' : ''}`}
              style={inboxCount > 0 ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              inbox
            </span>
            <span className="hidden lg:inline text-[13px] font-semibold text-slate-600 dark:text-slate-300">Bandeja</span>
            {inboxCount > 0 && (
              <span className="absolute top-1 right-1 lg:right-2 w-4 h-4 rounded-full bg-primary text-white text-[9px] font-black flex items-center justify-center leading-none">
                {inboxCount > 9 ? '9+' : inboxCount}
              </span>
            )}
          </button>
        )}

        <button
          onClick={onBellClick}
          aria-label="Notificaciones"
          title="Notificaciones"
          className="relative h-10 flex items-center gap-1.5 px-2 lg:px-3 rounded-full text-slate-400 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 duration-200"
        >
          <span
            className={`material-symbols-outlined text-[22px] ${unreadCount > 0 ? 'text-primary' : ''}`}
            style={unreadCount > 0 ? { fontVariationSettings: "'FILL' 1" } : {}}
          >
            notifications
          </span>
          <span className="hidden lg:inline text-[13px] font-semibold text-slate-600 dark:text-slate-300">Notificaciones</span>
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 lg:right-2 w-4 h-4 rounded-full bg-primary text-white text-[9px] font-black flex items-center justify-center leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </nav>
  )
}

import { useAuth } from '../context/AuthContext'

// TopAppBar responsive:
//   - mobile (<lg): barra clásica con logo "Focus" a la izquierda y acciones
//     a la derecha (cuenta, importar, bandeja, notificaciones). No cambia.
//   - lg+ (desktop): el sidebar pasa a ser el dueño del logo. Aquí el topbar
//     se convierte en command bar: buscador visible estilo ⌘K, botón
//     primario "Nuevo" y acciones secundarias más chicas.
export default function TopAppBar({
  showBack = false,
  onBack,
  onBellClick,
  unreadCount = 0,
  onShareClick,
  onInboxClick,
  inboxCount = 0,
  onSearchClick,
  onNewClick,
  isDesktop = false,
}) {
  const { user, setAuthModal } = useAuth()

  return (
    <nav
      className="sticky top-0 z-50 bg-slate-50/70 dark:bg-slate-900/70 backdrop-blur-lg flex justify-between items-center w-full px-4 lg:pl-[88px] lg:pr-6 xl:pl-[264px] pb-4 gap-3"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
    >
      {/* Left: back button OR logo (logo solo en mobile; en desktop lo pinta el sidebar) */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {showBack ? (
          <button
            onClick={onBack}
            aria-label="Volver"
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-90 duration-300"
          >
            <span className="material-symbols-outlined text-on-surface">arrow_back</span>
          </button>
        ) : null}
        <div className="flex items-center gap-1.5 lg:hidden">
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

      {/* Center: command bar — solo desktop. Parece un input real; al click
          abre el command palette (⌘K). No llevamos el estado del texto acá
          para no duplicar — el filtrado vive dentro del palette. */}
      {isDesktop && onSearchClick && (
        <button
          type="button"
          onClick={onSearchClick}
          className="hidden lg:flex flex-1 max-w-xl min-w-0 items-center gap-2.5 h-10 px-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-500 transition-colors text-left"
          aria-label="Buscar o pedirle algo a Nova (⌘K)"
        >
          <span className="material-symbols-outlined text-[18px] text-slate-400">search</span>
          <span className="text-[13px] font-medium truncate flex-1">
            Buscar o pedirle algo a Nova…
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900 text-slate-400 font-semibold flex-shrink-0">
            ⌘K
          </span>
        </button>
      )}

      {/* Right: acciones. En desktop: botón primario "Nuevo" + secundarias
          pequeñas (icon-only). En mobile: cuenta + importar + bandeja +
          bell como antes. */}
      <div className="flex items-center gap-1 lg:gap-1.5 flex-shrink-0">
        {/* Desktop: botón primario Nuevo */}
        {isDesktop && onNewClick && (
          <button
            onClick={onNewClick}
            aria-label="Nuevo evento"
            className="hidden lg:flex h-10 items-center gap-1.5 px-3.5 rounded-xl bg-primary text-white font-semibold text-[13px] shadow-[0_6px_14px_rgba(59,130,246,0.22)] hover:bg-primary/90 active:scale-95 transition-all"
          >
            <span
              className="material-symbols-outlined text-[18px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              add
            </span>
            Nuevo
          </button>
        )}

        {/* Cuenta — mobile muestra label colapsable; desktop solo icono */}
        <button
          onClick={() => setAuthModal(true)}
          aria-label={user ? 'Tu cuenta' : 'Iniciar sesión'}
          title={user ? user.email : 'Iniciar sesión'}
          className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 lg:h-10 lg:w-10 flex items-center justify-center gap-1.5 px-2.5 lg:px-0 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 duration-200"
        >
          <span
            className={`material-symbols-outlined text-[22px] lg:text-[20px] ${user ? 'text-primary' : 'text-slate-400'}`}
            style={user ? { fontVariationSettings: "'FILL' 1" } : {}}
          >
            {user ? 'account_circle' : 'login'}
          </span>
        </button>

        {onShareClick && (
          <button
            onClick={onShareClick}
            aria-label="Importar / Exportar calendario"
            title="Importar / Exportar"
            className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 lg:h-10 lg:w-10 flex items-center justify-center gap-1.5 px-2.5 lg:px-0 rounded-full text-slate-400 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 duration-200"
          >
            <span className="material-symbols-outlined text-[22px] lg:text-[20px]">ios_share</span>
          </button>
        )}

        {/* Bandeja — en desktop ya está en el sidebar pero la dejamos en
            topbar también para que el contador sea visible desde cualquier
            vista sin tener que mirar a la izquierda. */}
        {onInboxClick && (
          <button
            onClick={onInboxClick}
            aria-label="Bandeja de Nova"
            title="Bandeja de Nova"
            className="relative min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 lg:h-10 lg:w-10 flex items-center justify-center gap-1.5 px-2.5 lg:px-0 rounded-full text-slate-400 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 duration-200"
          >
            <span
              className={`material-symbols-outlined text-[22px] lg:text-[20px] ${inboxCount > 0 ? 'text-primary' : ''}`}
              style={inboxCount > 0 ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              inbox
            </span>
            {inboxCount > 0 && (
              <span className="absolute top-1 right-1 lg:top-0.5 lg:right-0.5 w-4 h-4 rounded-full bg-primary text-white text-[9px] font-black flex items-center justify-center leading-none">
                {inboxCount > 9 ? '9+' : inboxCount}
              </span>
            )}
          </button>
        )}

        <button
          onClick={onBellClick}
          aria-label="Notificaciones"
          title="Notificaciones"
          className="relative min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 lg:h-10 lg:w-10 flex items-center justify-center gap-1.5 px-2.5 lg:px-0 rounded-full text-slate-400 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 duration-200"
        >
          <span
            className={`material-symbols-outlined text-[22px] lg:text-[20px] ${unreadCount > 0 ? 'text-primary' : ''}`}
            style={unreadCount > 0 ? { fontVariationSettings: "'FILL' 1" } : {}}
          >
            notifications
          </span>
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 lg:top-0.5 lg:right-0.5 w-4 h-4 rounded-full bg-primary text-white text-[9px] font-black flex items-center justify-center leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </nav>
  )
}

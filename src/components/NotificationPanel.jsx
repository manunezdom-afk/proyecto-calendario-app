// Relative time helper
function relativeTime(ts) {
  const diff = Date.now() - ts
  const min  = Math.floor(diff / 60_000)
  const hr   = Math.floor(diff / 3_600_000)
  if (min < 1)  return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  if (hr < 24)  return `hace ${hr} h`
  const d = new Date(ts)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

// Group entries into sections
function groupEntries(log) {
  const now       = Date.now()
  const oneHour   = 3_600_000
  const oneDay    = 86_400_000
  const todayStart = new Date().setHours(0, 0, 0, 0)

  const now_   = log.filter((n) => now - n.timestamp < oneHour)
  const today  = log.filter((n) => now - n.timestamp >= oneHour && n.timestamp >= todayStart)
  const older  = log.filter((n) => n.timestamp < todayStart)
  return [
    { label: 'Ahora', entries: now_ },
    { label: 'Hoy',   entries: today },
    { label: 'Antes', entries: older },
  ].filter((g) => g.entries.length > 0)
}

export default function NotificationPanel({ isOpen, onClose, notifLog, onMarkAllRead, onDismiss }) {
  if (!isOpen) return null

  const groups    = groupEntries(notifLog)
  const hasUnread = notifLog.some((n) => !n.read)

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[55] bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-[56] w-full max-w-sm bg-surface dark:bg-slate-900 shadow-2xl flex flex-col"
        style={{ animation: 'slideInRight 0.28s cubic-bezier(0.34,1.2,0.64,1) both' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 pb-5 border-b border-outline-variant/15"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="material-symbols-outlined text-primary text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              notifications
            </span>
            <h2 className="font-headline font-bold text-lg text-on-surface dark:text-slate-100">
              Notificaciones
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {hasUnread && (
              <button
                onClick={onMarkAllRead}
                className="text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
              >
                Marcar leídas
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Cerrar notificaciones"
              className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full text-outline hover:bg-surface-container-low transition-colors active:scale-95"
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto hide-scrollbar">
          {notifLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 h-full text-center px-6 py-10">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <span
                  className="material-symbols-outlined text-primary text-[26px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  notifications_active
                </span>
              </div>
              <p className="font-bold text-on-surface dark:text-slate-300">
                Todo tranquilo por aquí
              </p>
              <p className="text-sm text-outline font-medium leading-relaxed max-w-[260px]">
                Te avisaremos 10 minutos antes de cada evento. Si pierdes alguno, también queda registrado.
              </p>
              <div className="mt-2 w-full max-w-[260px] rounded-xl bg-surface-container-low/60 p-3 text-left">
                <p className="text-[11px] font-bold uppercase tracking-wide text-outline/80 mb-1.5">
                  Qué verás aquí
                </p>
                <ul className="space-y-1.5 text-[12.5px] text-on-surface-variant">
                  <li className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-[14px] mt-0.5 text-primary">schedule</span>
                    Recordatorios antes de cada evento
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-[14px] mt-0.5 text-primary">auto_awesome</span>
                    Sugerencias de Nova
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-[14px] mt-0.5 text-primary">check_circle</span>
                    Confirmaciones de cambios
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="py-2">
              {groups.map(({ label, entries }) => (
                <div key={label}>
                  <p className="text-[10px] font-bold text-outline px-6 py-3">
                    {label}
                  </p>
                  {entries.map((n) => (
                    <div
                      key={n.id}
                      className={`flex items-start gap-3 px-5 py-3.5 hover:bg-surface-container-low dark:hover:bg-slate-800 transition-colors ${
                        !n.read ? 'bg-primary/3' : ''
                      }`}
                    >
                      {/* Unread dot */}
                      <div className="flex-shrink-0 mt-1.5">
                        {!n.read ? (
                          <div className="w-2 h-2 rounded-full bg-primary" />
                        ) : (
                          <div className="w-2 h-2" />
                        )}
                      </div>

                      {/* Icon */}
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span
                          className="material-symbols-outlined text-primary text-[18px]"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          {n.icon || 'event'}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-snug ${!n.read ? 'font-bold text-on-surface dark:text-slate-100' : 'font-semibold text-on-surface-variant dark:text-slate-400'}`}>
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-xs text-outline font-medium mt-0.5">{n.body}</p>
                        )}
                        <p className="text-[10px] text-outline/60 font-semibold mt-1">
                          {relativeTime(n.timestamp)}
                        </p>
                      </div>

                      {/* Dismiss */}
                      <button
                        onClick={() => onDismiss(n.id)}
                        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-outline/50 hover:text-error hover:bg-error/10 transition-all active:scale-90"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

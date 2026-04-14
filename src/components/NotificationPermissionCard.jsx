export default function NotificationPermissionCard({ onAllow, onDismiss }) {
  return (
    <div className="mx-6 mt-3 mb-1 p-4 rounded-[20px] bg-primary/5 border border-primary/15 flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span
          className="material-symbols-outlined text-primary text-[22px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          notifications
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-headline font-bold text-on-surface text-sm mb-0.5">
          ¿Activar recordatorios?
        </p>
        <p className="text-xs text-on-surface-variant font-medium leading-relaxed mb-3">
          Focus puede avisarte antes de que empieces tus eventos. Sin interrupciones innecesarias.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={onDismiss}
            className="text-xs font-semibold text-outline hover:text-on-surface transition-colors px-3 py-1.5"
          >
            Ahora no
          </button>
          <button
            onClick={onAllow}
            className="text-xs font-bold text-white bg-primary rounded-full px-4 py-1.5 shadow-sm shadow-primary/20 active:scale-95 transition-all"
          >
            Activar
          </button>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-outline hover:text-on-surface transition-colors mt-0.5"
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>
  )
}

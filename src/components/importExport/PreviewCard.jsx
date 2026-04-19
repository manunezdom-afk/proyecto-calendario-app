// Tarjeta compacta de preview usada por los tabs de import (ICS, texto, foto).
// Antes vivía inline en ImportExportSheet.jsx.
export default function PreviewCard({ ev, onRemove }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-surface-container-lowest rounded-xl border border-outline-variant/20">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <span
          className="material-symbols-outlined text-primary text-[18px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
          aria-hidden="true"
        >
          {ev.icon || 'event'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-on-surface text-sm truncate">{ev.title}</p>
        <p className="text-xs text-outline mt-0.5">
          {[ev.date, ev.time].filter(Boolean).join(' · ') || 'Sin horario'}
        </p>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(ev.id)}
          aria-label="Descartar evento"
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-outline hover:text-error transition-colors"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">close</span>
        </button>
      )}
    </div>
  )
}

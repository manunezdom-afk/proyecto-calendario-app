import { useState } from 'react'
import { downloadICS, eventsToICS } from '../../utils/icsExport'
import { googleCalendarUrl } from '../../utils/googleCalendarUrl'

// Tab Exportar: filtros (rango + categorías) → botones Google Calendar uno-a-uno
// o archivo .ics (con copia al clipboard). Antes era parte de ImportExportSheet.jsx.
export default function ExportTab({ events }) {
  const [copied, setCopied] = useState(false)
  const [rangePreset, setRangePreset] = useState('all') // all, today, week, month
  const [selectedSections, setSelectedSections] = useState(new Set())

  // Categorías únicas presentes en los eventos
  const allSections = Array.from(
    new Set((events || []).map((e) => e.section).filter(Boolean))
  )

  function inRange(ev) {
    if (rangePreset === 'all') return true
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const evDate = ev.date ? new Date(ev.date) : today
    if (rangePreset === 'today') return evDate.toDateString() === today.toDateString()
    if (rangePreset === 'week') {
      const end = new Date(today); end.setDate(today.getDate() + 7)
      return evDate >= today && evDate <= end
    }
    if (rangePreset === 'month') {
      const end = new Date(today); end.setDate(today.getDate() + 30)
      return evDate >= today && evDate <= end
    }
    return true
  }

  function inSection(ev) {
    if (selectedSections.size === 0) return true
    return selectedSections.has(ev.section)
  }

  const filteredEvents = (events || []).filter((e) => inRange(e) && inSection(e))

  function toggleSection(section) {
    setSelectedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(eventsToICS(filteredEvents))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="space-y-5">
      {/* ── Filtros ─────────────────────────────────────────────────────── */}
      <div className="p-4 bg-surface-container-lowest rounded-2xl border border-outline-variant/20 space-y-3">
        <p className="text-[11px] font-bold text-on-surface uppercase tracking-wider">Qué exportar</p>

        <div>
          <p className="text-[11px] text-outline mb-1.5">Rango</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all', label: 'Todo' },
              { id: 'today', label: 'Hoy' },
              { id: 'week', label: 'Próx. 7 días' },
              { id: 'month', label: 'Próx. 30 días' },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setRangePreset(id)}
                className={`px-3 py-1.5 rounded-full text-[11.5px] font-semibold transition-all ${
                  rangePreset === id
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-white text-on-surface-variant border border-outline-variant/30 hover:border-primary/40'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {allSections.length > 1 && (
          <div>
            <p className="text-[11px] text-outline mb-1.5">
              Categorías {selectedSections.size > 0 && `(${selectedSections.size} seleccionadas)`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {allSections.map((section) => {
                const sel = selectedSections.has(section)
                return (
                  <button
                    key={section}
                    onClick={() => toggleSection(section)}
                    className={`px-3 py-1.5 rounded-full text-[11.5px] font-semibold transition-all ${
                      sel
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-white text-on-surface-variant border border-outline-variant/30 hover:border-primary/40'
                    }`}
                  >
                    {section}
                  </button>
                )
              })}
              {selectedSections.size > 0 && (
                <button
                  onClick={() => setSelectedSections(new Set())}
                  className="px-3 py-1.5 rounded-full text-[11.5px] font-semibold text-outline hover:text-on-surface"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>
        )}

        <p className="text-[11px] text-outline pt-0.5">
          <b className="text-on-surface">{filteredEvents.length}</b> de {events.length} evento{events.length !== 1 ? 's' : ''} seleccionado{filteredEvents.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* ── Opción 1: Google Calendar directo ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">1</span>
          <p className="text-xs font-bold text-on-surface uppercase tracking-wider">Google Calendar — un clic por evento</p>
        </div>
        <p className="text-xs text-on-surface-variant pl-7">Sin descargar nada. Se abre directamente en Google Calendar con la hora y fecha correctas.</p>

        {filteredEvents.length === 0 ? (
          <p className="text-xs text-outline pl-7 italic">No hay eventos para exportar con los filtros actuales.</p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pl-7">
            {filteredEvents.map((ev) => (
              <div key={ev.id} className="flex items-center gap-3 p-3 bg-surface-container-lowest rounded-xl border border-outline-variant/20">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-on-surface text-sm truncate">{ev.title}</p>
                  <p className="text-[11px] text-outline mt-0.5">
                    {[ev.date, ev.time].filter(Boolean).join(' · ') || 'Sin horario'}
                  </p>
                </div>
                <a
                  href={googleCalendarUrl(ev)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 text-[11px] font-bold hover:bg-blue-100 active:scale-95 transition-all whitespace-nowrap"
                >
                  + Google Cal
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-outline-variant/20" />

      {/* ── Opción 2: Archivo .ics (Apple, Outlook, etc.) ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">2</span>
          <p className="text-xs font-bold text-on-surface uppercase tracking-wider">Archivo .ics — Apple Calendar · Outlook · otros</p>
        </div>
        <p className="text-xs text-on-surface-variant pl-7">
          Descarga el archivo y ábrelo en tu app de calendario. Los horarios se exportan en UTC para que aparezcan a la hora correcta en cualquier zona horaria.
        </p>

        <div className="pl-7 space-y-2">
          <button
            onClick={() => { downloadICS(filteredEvents) }}
            disabled={filteredEvents.length === 0}
            className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-30 active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">ios_share</span>
            Descargar {filteredEvents.length} evento{filteredEvents.length !== 1 ? 's' : ''} (.ics)
          </button>

          <button
            onClick={handleCopy}
            disabled={filteredEvents.length === 0}
            className="w-full py-3 rounded-2xl bg-surface-container-low text-on-surface font-semibold flex items-center justify-center gap-2 disabled:opacity-30 text-sm active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{copied ? 'check_circle' : 'content_copy'}</span>
            {copied ? '¡Copiado!' : 'Copiar como texto ICS'}
          </button>
        </div>

        <div className="pl-7 space-y-2">
          {[
            { icon: 'apple', label: 'Apple Calendar', desc: 'Toca el .ics desde Archivos o Mail → se importa solo' },
            { icon: 'language', label: 'Google Calendar (alternativa)', desc: 'calendar.google.com → Configuración ⚙ → Importar → sube el .ics' },
            { icon: 'mail', label: 'Outlook', desc: 'Doble clic en el .ics → "Abrir con Outlook"' },
          ].map(({ icon, label, desc }) => (
            <div key={label} className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
              <span aria-hidden="true" className="material-symbols-outlined text-outline text-[18px] mt-0.5">{icon}</span>
              <div>
                <p className="text-sm font-bold text-on-surface">{label}</p>
                <p className="text-xs text-outline font-medium mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

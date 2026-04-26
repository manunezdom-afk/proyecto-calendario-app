import { useState, useRef, useEffect, useCallback } from 'react'
import { downloadICS }        from '../utils/icsExport'
import { parseICS }           from '../utils/icsImport'
import { parseEvent }         from '../utils/parseEvent'
import { googleCalendarUrl }  from '../utils/googleCalendarUrl'
import { apiFetch, apiUrl }    from '../lib/apiClient'
import { supabase }           from '../lib/supabase'
import { pushModal, popModal } from '../utils/modalStack'

// Tres tabs claras, sin jerga. Antes había 5 ("Por texto" y "Foto" eran
// métodos de import disfrazados de tabs, "Suscripción" sonaba a billing).
// Ahora los 3 métodos de import (foto/texto/archivo) viven dentro de una
// única tab "Importar" con un selector horizontal.
const TABS = [
  { id: 'import', label: 'Importar',    icon: 'download'  },
  { id: 'export', label: 'Exportar',    icon: 'ios_share' },
  { id: 'sync',   label: 'Sincronizar', icon: 'sync'      },
]

// Compat con callers que abren la sheet en una tab vieja por initialTab.
const TAB_ALIASES = {
  subscribe: 'sync',
  text:      'import',
  photo:     'import',
}

// Si initialTab es 'text' o 'photo', preseleccionamos ese método dentro
// de la tab Importar para que el deep-link siga funcionando.
const INITIAL_IMPORT_METHOD_FROM_LEGACY_TAB = {
  text:  'text',
  photo: 'photo',
}

// ── Small preview card for an event to be imported ──────────────────────────
function PreviewCard({ ev, onRemove }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-surface-container-lowest rounded-xl border border-outline-variant/20">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <span
          className="material-symbols-outlined text-primary text-[18px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
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
          onClick={() => onRemove(ev.id)}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-outline hover:text-error transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      )}
    </div>
  )
}

// ── Export tab ────────────────────────────────────────────────────────────────
function ExportTab({ events }) {
  const [copied, setCopied] = useState(false)

  // ── Filtros ─────────────────────────────────────────────────────────────
  const [rangePreset, setRangePreset] = useState('all') // all, today, week, month
  const [selectedSections, setSelectedSections] = useState(new Set())

  // Categorías únicas presentes en los eventos
  const allSections = Array.from(
    new Set((events || []).map(e => e.section).filter(Boolean))
  )

  function inRange(ev) {
    if (rangePreset === 'all') return true
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const evDate = ev.date ? new Date(ev.date) : today
    if (rangePreset === 'today') {
      return evDate.toDateString() === today.toDateString()
    }
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

  // Orden cronológico ascendente (fecha → hora). Eventos sin fecha al final.
  function eventSortKey(ev) {
    const d = ev.date ? String(ev.date) : '9999-12-31'
    const t = ev.time ? String(ev.time).split('-')[0].trim() : '99:99'
    return `${d}T${t}`
  }

  const filteredEvents = (events || [])
    .filter(e => inRange(e) && inSection(e))
    .slice()
    .sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)))

  function toggleSection(section) {
    setSelectedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  async function handleCopy() {
    const { eventsToICS } = await import('../utils/icsExport')
    try {
      await navigator.clipboard.writeText(eventsToICS(filteredEvents))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {}
  }

  return (
    <div className="space-y-5">

      {/* ── Filtros ─────────────────────────────────────────────────────── */}
      <div className="p-4 bg-surface-container-lowest rounded-2xl border border-outline-variant/20 space-y-3">
        <p className="text-[11px] font-bold text-on-surface">Qué exportar</p>

        {/* Rango de fechas */}
        <div>
          <p className="text-[11px] text-outline mb-1.5">Rango</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all',   label: 'Todo' },
              { id: 'today', label: 'Hoy' },
              { id: 'week',  label: 'Próx. 7 días' },
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

        {/* Categorías */}
        {allSections.length > 1 && (
          <div>
            <p className="text-[11px] text-outline mb-1.5">
              Categorías {selectedSections.size > 0 && `(${selectedSections.size} seleccionadas)`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {allSections.map(section => {
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

        {/* Resumen */}
        <p className="text-[11px] text-outline pt-0.5">
          <b className="text-on-surface">{filteredEvents.length}</b> de {events.length} evento{events.length !== 1 ? 's' : ''} seleccionado{filteredEvents.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* ── Opción A · Google Calendar directo ── */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-bold text-on-surface">Abrir en Google Calendar</p>
          <p className="text-[12px] text-outline mt-0.5 leading-relaxed">
            Sin descargas. Cada evento se abre con un clic y se guarda directamente en tu Google Calendar.
          </p>
        </div>

        {filteredEvents.length === 0 ? (
          <p className="text-xs text-outline italic">Aún no tienes eventos para exportar.</p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto">
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

      {/* ── Opción B · Descargar archivo (Apple, Outlook, otros) ── */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-bold text-on-surface">Descargar para otra app</p>
          <p className="text-[12px] text-outline mt-0.5 leading-relaxed">
            Apple Calendar, Outlook u otras. Los horarios se ajustan automáticamente a tu zona horaria.
          </p>
        </div>

        <div className="space-y-2">
          {filteredEvents.length === 0 ? (
            <button
              disabled
              className="w-full py-3.5 rounded-2xl bg-surface-container-low text-outline font-semibold flex items-center justify-center gap-2 text-sm cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[18px]">block</span>
              Aún no tienes eventos para exportar
            </button>
          ) : (
            <button
              onClick={() => { downloadICS(filteredEvents) }}
              className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
            >
              <span className="material-symbols-outlined text-[20px]">ios_share</span>
              Descargar {filteredEvents.length} evento{filteredEvents.length !== 1 ? 's' : ''}
            </button>
          )}

          <button
            onClick={handleCopy}
            disabled={filteredEvents.length === 0}
            className="w-full py-3 rounded-2xl bg-surface-container-low text-on-surface font-semibold flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed text-sm active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">{copied ? 'check_circle' : 'content_copy'}</span>
            {copied ? '¡Copiado!' : 'Copiar al portapapeles'}
          </button>
        </div>

        {/* Cómo abrirlo en cada app — guía rápida sin jerga */}
        <details className="group">
          <summary className="text-[12px] font-semibold text-outline cursor-pointer hover:text-on-surface flex items-center gap-1 list-none">
            <span className="material-symbols-outlined text-[16px] transition-transform group-open:rotate-90">chevron_right</span>
            ¿Cómo lo abro en mi app?
          </summary>
          <div className="space-y-2 mt-2.5">
            {[
              { icon: 'phone_iphone', label: 'iPhone / Mac (Apple Calendar)', desc: 'Toca el archivo descargado desde Archivos o Mail. Se importa solo.' },
              { icon: 'language',     label: 'Google Calendar',                desc: 'calendar.google.com → Configuración → Importar → sube el archivo.' },
              { icon: 'mail',         label: 'Outlook',                        desc: 'Doble clic en el archivo y elige "Abrir con Outlook".' },
            ].map(({ icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
                <span className="material-symbols-outlined text-outline text-[18px] mt-0.5">{icon}</span>
                <div>
                  <p className="text-sm font-bold text-on-surface">{label}</p>
                  <p className="text-xs text-outline font-medium mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>

    </div>
  )
}

// ── Subscribe tab (live calendar feed) ────────────────────────────────────────
function SubscribeTab() {
  const [feeds, setFeeds]     = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('Focus')
  const [copied, setCopied]   = useState(null)
  const [authed, setAuthed]   = useState(false)
  const [error, setError]     = useState('')

  async function getToken() {
    if (!supabase) return null
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || null
  }

  const loadFeeds = useCallback(async () => {
    setLoading(true)
    setError('')
    const token = await getToken()
    if (!token) {
      setAuthed(false)
      setLoading(false)
      return
    }
    setAuthed(true)
    try {
      const res = await apiFetch('/api/calendar-feeds', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = await res.json()
      setFeeds(data.feeds || [])
    } catch (err) {
      setError(String(err.message || err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFeeds() }, [loadFeeds])

  async function handleCreate() {
    setCreating(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Necesitas iniciar sesión')
      const res = await apiFetch('/api/calendar-feeds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ label: newLabel.trim() || 'Focus' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `status ${res.status}`)
      await loadFeeds()
    } catch (err) {
      setError(String(err.message || err))
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(token) {
    if (!confirm('¿Revocar este feed? Las apps suscritas dejarán de recibir actualizaciones.')) return
    try {
      const jwt = await getToken()
      await apiFetch('/api/calendar-feeds', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ token }),
      })
      await loadFeeds()
    } catch {}
  }

  function feedUrl(token) {
    const url = apiUrl(`/api/ics-feed?token=${token}`)
    if (/^https?:\/\//i.test(url)) return url
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}${url}`
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied(null), 2000)
    } catch {}
  }

  function qrUrl(url) {
    // Usamos un servicio público de QR — no requiere dependencias
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`
  }

  // No está logueado
  if (!authed && !loading) {
    return (
      <div className="p-6 bg-surface-container-lowest rounded-2xl border border-outline-variant/20 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <span className="material-symbols-outlined text-primary text-[26px]">account_circle</span>
        </div>
        <div>
          <p className="font-bold text-on-surface text-sm">Inicia sesión para crear feeds</p>
          <p className="text-xs text-outline mt-1.5 leading-snug">
            La suscripción en vivo necesita una cuenta para asociar tu calendario a un URL privado.
            Puedes seguir usando la exportación clásica (archivo .ics) sin cuenta.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500/10 to-violet-500/10 border border-blue-500/20 space-y-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>rss_feed</span>
          <p className="text-[13px] font-bold text-on-surface">Sincronización automática</p>
        </div>
        <p className="text-[12px] text-on-surface-variant leading-snug">
          Genera un URL privado y suscribe tu Google Calendar / Apple Calendar a él.
          <b> Cada cambio que hagas en Focus se reflejará solo en tus otros calendarios</b>, sin re-exportar nada.
        </p>
      </div>

      {/* Crear nuevo feed */}
      {feeds.length === 0 && (
        <div className="space-y-3 p-4 bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
          <p className="text-[12px] font-bold text-on-surface">Crear tu primer feed</p>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Nombre del feed (ej. Focus Personal)"
            className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 bg-white text-sm focus:outline-none focus:border-primary"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full py-3 rounded-2xl bg-primary text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-40 active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">add_link</span>
            {creating ? 'Generando…' : 'Generar URL de suscripción'}
          </button>
        </div>
      )}

      {/* Lista de feeds */}
      {loading && (
        <p className="text-[12px] text-outline text-center py-4">Cargando feeds…</p>
      )}

      {!loading && feeds.map((f) => {
        const url = feedUrl(f.token)
        return (
          <div key={f.token} className="space-y-3 p-4 bg-white rounded-2xl border border-outline-variant/20 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-on-surface truncate">{f.label || 'Focus'}</p>
                <p className="text-[11px] text-outline mt-0.5">
                  Creado {new Date(f.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                  {f.last_read_at ? ` · última lectura ${new Date(f.last_read_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ' · aún sin lecturas'}
                </p>
              </div>
              <button
                onClick={() => handleDelete(f.token)}
                title="Revocar feed"
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-outline hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>

            {/* URL + copiar */}
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-100 text-[10.5px] text-slate-700 truncate">
                {url}
              </code>
              <button
                onClick={() => copyUrl(url)}
                className="flex-shrink-0 px-3 py-2 rounded-lg bg-primary text-white text-[11px] font-bold hover:brightness-110 active:scale-95 transition-all whitespace-nowrap"
              >
                {copied === url ? '¡Copiado!' : 'Copiar'}
              </button>
            </div>

            {/* QR para mobile */}
            <details className="group">
              <summary className="text-[11.5px] font-semibold text-primary cursor-pointer list-none flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] group-open:rotate-90 transition-transform">chevron_right</span>
                Ver código QR para escanear en otro dispositivo
              </summary>
              <div className="mt-3 flex justify-center p-3 bg-white rounded-xl border border-outline-variant/20">
                <img src={qrUrl(url)} alt="QR del feed" width={220} height={220} className="rounded-lg" />
              </div>
            </details>

            {/* Instrucciones por app */}
            <div className="pt-1 space-y-2">
              <p className="text-[11px] font-bold text-on-surface">Cómo suscribirse</p>
              {[
                { label: 'Google Calendar', desc: 'calendar.google.com → ⚙ Configuración → "Agregar calendario" → "A partir de URL" → pegar el URL' },
                { label: 'Apple Calendar (iPhone)', desc: 'Ajustes → Calendario → Cuentas → Añadir cuenta → Otras → Añadir calendario suscrito → pegar URL' },
                { label: 'Apple Calendar (Mac)', desc: 'Archivo → Nueva suscripción a calendario → pegar URL' },
                { label: 'Outlook', desc: 'Configuración → Calendario → Calendarios compartidos → "Suscribirse desde la web" → pegar URL' },
              ].map(({ label, desc }) => (
                <div key={label} className="p-2.5 bg-surface-container-lowest rounded-lg">
                  <p className="text-[11.5px] font-bold text-on-surface">{label}</p>
                  <p className="text-[10.5px] text-outline mt-0.5 leading-snug">{desc}</p>
                </div>
              ))}
            </div>

            <p className="text-[10.5px] text-outline leading-snug pt-1">
              💡 Los calendarios se actualizan cada 1-24 h según la app. Si revocas este feed, todos los calendarios suscritos dejan de ver tus eventos.
            </p>
          </div>
        )
      })}

      {!loading && feeds.length > 0 && (
        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full py-2.5 rounded-xl border border-outline-variant/30 text-primary text-[13px] font-semibold flex items-center justify-center gap-1.5 hover:bg-primary/5 transition-colors disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          {creating ? 'Generando…' : 'Crear otro feed'}
        </button>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[11.5px]">
          Error: {error}
        </div>
      )}
    </div>
  )
}

// ── Import ICS tab ────────────────────────────────────────────────────────────
function ImportICSTab({ onImport }) {
  const fileRef = useRef(null)
  const [preview, setPreview]   = useState([])
  const [error, setError]       = useState('')
  const [imported, setImported] = useState(false)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setImported(false)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = parseICS(ev.target.result)
        if (parsed.length === 0) {
          setError('No se encontraron eventos en el archivo. ¿Es un archivo .ics válido?')
        } else {
          setPreview(parsed)
        }
      } catch (_) {
        setError('No se pudo leer el archivo. Asegúrate de que sea un .ics válido.')
      }
    }
    reader.readAsText(file)
  }

  function removeFromPreview(id) {
    setPreview((prev) => prev.filter((e) => e.id !== id))
  }

  function handleConfirm() {
    preview.forEach((ev) => onImport(ev))
    setImported(true)
    setPreview([])
    if (fileRef.current) fileRef.current.value = ''
    console.log(`[Focus] 📥 Imported ${preview.length} events from ICS`)
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-on-surface-variant font-medium leading-relaxed">
        Importa un archivo <span className="font-bold text-on-surface">.ics</span> de Apple Calendar,
        Google Calendar, Outlook u otra app. Podrás revisar los eventos antes de confirmar.
      </p>

      {/* File picker */}
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full py-5 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 flex flex-col items-center gap-2 hover:bg-primary/8 active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-primary text-4xl">upload_file</span>
        <span className="font-bold text-primary text-sm">Seleccionar archivo .ics</span>
        <span className="text-xs text-outline font-medium">o arrastra aquí</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".ics,text/calendar"
        onChange={handleFile}
        className="hidden"
      />

      {/* Cómo exportar instrucciones */}
      {preview.length === 0 && !error && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-outline">Cómo obtener el .ics</p>
          {[
            { icon: 'phone_iphone', label: 'iPhone / Mac', desc: 'Apple Calendar → selecciona un calendario → Archivo → Exportar → .ics' },
            { icon: 'language',     label: 'Google Calendar', desc: 'calendar.google.com → Configuración → Exportar calendarios' },
          ].map(({ icon, label, desc }) => (
            <div key={label} className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
              <span className="material-symbols-outlined text-outline text-[18px] mt-0.5">{icon}</span>
              <div>
                <p className="text-xs font-bold text-on-surface">{label}</p>
                <p className="text-xs text-outline font-medium mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-error/10 rounded-xl border border-error/20">
          <p className="text-sm text-error font-semibold">{error}</p>
        </div>
      )}

      {/* Success */}
      {imported && (
        <div className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex items-center gap-3">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-sm font-bold text-primary">Eventos importados correctamente</p>
        </div>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-on-surface">
              {preview.length} evento{preview.length !== 1 ? 's' : ''} encontrado{preview.length !== 1 ? 's' : ''}
            </p>
            <span className="text-xs text-outline font-medium">Toca × para descartar</span>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto hide-scrollbar">
            {preview.map((ev) => (
              <PreviewCard key={ev.id} ev={ev} onRemove={removeFromPreview} />
            ))}
          </div>
          <button
            onClick={handleConfirm}
            className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">download</span>
            Importar {preview.length} evento{preview.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Batch text tab ────────────────────────────────────────────────────────────
function TextTab({ onImport }) {
  const [text, setText]       = useState('')
  const [preview, setPreview] = useState([])
  const [imported, setImported] = useState(false)

  function handleParse() {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    const parsed = lines.map((line) => {
      const result = parseEvent(line)
      return {
        id:          `evt-txt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        title:       result.title,
        time:        result.time,
        description: result.date !== 'Hoy' ? result.date : '',
        section:     result.section,
        featured:    false,
        icon:        result.icon,
        dotColor:    result.dotColor,
        date:        null,
      }
    })
    setPreview(parsed)
    setImported(false)
  }

  function removeFromPreview(id) {
    setPreview((prev) => prev.filter((e) => e.id !== id))
  }

  function handleConfirm() {
    preview.forEach((ev) => onImport(ev))
    setImported(true)
    setPreview([])
    setText('')
    console.log(`[Focus] 📥 Imported ${preview.length} events from text`)
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-on-surface-variant font-medium leading-relaxed">
        Escribe o pega varios eventos, <span className="font-bold text-on-surface">uno por línea</span>.
        El asistente los reconoce automáticamente.
      </p>

      {/* Example */}
      <div className="bg-surface-container-low rounded-xl p-3 space-y-1 text-xs text-outline font-mono">
        <p>gym lunes a las 7 de la mañana</p>
        <p>reunión de equipo martes a las 10</p>
        <p>cena con familia el viernes a las 8</p>
        <p>dentista mañana a las 3 de la tarde</p>
      </div>

      {/* Textarea */}
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setPreview([]); setImported(false) }}
        placeholder={'gym lunes a las 7\nreunión martes a las 10\ncena viernes a las 8'}
        rows={5}
        className="w-full bg-surface-container-low rounded-xl p-4 text-sm font-medium text-on-surface placeholder:text-outline/40 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
      />

      <button
        onClick={handleParse}
        disabled={!text.trim()}
        className="w-full py-3.5 rounded-2xl bg-surface-container-high text-on-surface font-bold flex items-center justify-center gap-2 disabled:opacity-30 active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
        Analizar con IA
      </button>

      {/* Success */}
      {imported && (
        <div className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex items-center gap-3">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-sm font-bold text-primary">Eventos añadidos al calendario</p>
        </div>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-bold text-on-surface">
            Vista previa — {preview.length} evento{preview.length !== 1 ? 's' : ''}
          </p>
          <div className="space-y-2 max-h-56 overflow-y-auto hide-scrollbar">
            {preview.map((ev) => (
              <PreviewCard key={ev.id} ev={ev} onRemove={removeFromPreview} />
            ))}
          </div>
          <button
            onClick={handleConfirm}
            className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">add_circle</span>
            Añadir {preview.length} evento{preview.length !== 1 ? 's' : ''} al calendario
          </button>
        </div>
      )}
    </div>
  )
}

// ── Photo tab ─────────────────────────────────────────────────────────────────
function PhotoTab({ onImport }) {
  const [photos, setPhotos]   = useState([])
  const [preview, setPreview] = useState([])
  const [analyzing, setAnalyzing] = useState(false)
  const [imported, setImported]   = useState(false)
  const [error, setError]         = useState('')
  const fileRef = useRef(null)

  function handlePhotos(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setPhotos((prev) => [...prev, ...files.map((f) => ({ url: URL.createObjectURL(f), file: f }))])
    setPreview([])
    setImported(false)
    setError('')
    e.target.value = ''
  }

  function removePhoto(idx) {
    setPhotos((prev) => { URL.revokeObjectURL(prev[idx].url); return prev.filter((_, i) => i !== idx) })
    setPreview([])
    setError('')
  }

  function resizeToBase64(file, maxPx = 1120) {
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        const ratio = Math.min(maxPx / img.width, maxPx / img.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * ratio)
        canvas.height = Math.round(img.height * ratio)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' })
      }
      img.src = url
    })
  }

  function aiToAppEvent({ title = 'Evento', date = null, time = null, endTime = null }) {
    let displayTime = '', h24 = null
    if (time) {
      const [h, m] = time.split(':').map(Number)
      h24 = h
      const period = h >= 12 ? 'PM' : 'AM'
      const h12 = h % 12 === 0 ? 12 : h % 12
      displayTime = `${h12}:${String(m).padStart(2, '0')} ${period}`
    }
    const section = h24 !== null && h24 >= 14 ? 'evening' : 'focus'
    const t = (title || '').toLowerCase()
    let icon = 'event'
    if (/futbol|gym|yoga|correr|nadar|pilates|deporte|ejercicio/.test(t)) icon = 'fitness_center'
    else if (/reunion|meeting|llamada|call|sincro|junta/.test(t))         icon = 'groups'
    else if (/almuerzo|comida|cena|desayuno|cafe|restaurante/.test(t))    icon = 'restaurant'
    else if (/estudio|clase|tarea|examen|facultad|universidad/.test(t))   icon = 'menu_book'
    else if (/trabajo|proyecto|presentacion|oficina/.test(t))             icon = 'work'
    else if (/medico|doctor|cita|dentista|hospital/.test(t))              icon = 'local_hospital'
    else if (/compras|supermercado|tienda/.test(t))                       icon = 'shopping_cart'
    else if (/cumpleanos|fiesta|celebracion/.test(t))                     icon = 'cake'
    else if (/viaje|vuelo|aeropuerto/.test(t))                            icon = 'flight'
    return {
      id: `evt-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim(), time: displayTime, date, section, featured: false, icon,
      dotColor: section === 'evening' ? 'bg-secondary-container' : '',
      description: endTime ? `Hasta las ${endTime}` : '',
    }
  }

  async function handleAnalyze() {
    if (!photos.length) return
    setAnalyzing(true)
    setError('')
    setPreview([])

    try {
      const images = await Promise.all(photos.map((p) => resizeToBase64(p.file)))

      let res
      try {
        res = await apiFetch('/api/analyze-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images }),
        })
      } catch {
        setError('No se pudo conectar con el servidor. Verifica tu conexión a internet.')
        return
      }

      let data
      try {
        data = await res.json()
      } catch {
        setError(`Error del servidor (${res.status}). El deploy puede estar en curso — espera un minuto y reintenta.`)
        return
      }

      if (res.status === 429) {
        setError('Demasiadas solicitudes. Espera un momento e intenta de nuevo.')
        return
      }

      if (!res.ok || data.error) {
        const detail = data.detail ? ` (${data.detail})` : ''
        setError(`Error al analizar: ${data.error ?? res.status}${detail}. Intenta de nuevo.`)
        return
      }

      if (!data.events || data.events.length === 0) {
        setError('No se detectaron eventos. Asegúrate de que las fotos muestren horarios o fechas visibles.')
        return
      }

      setPreview(data.events.map(aiToAppEvent))
    } catch (err) {
      setError(`Error inesperado: ${err?.message ?? 'desconocido'}`)
    } finally {
      setAnalyzing(false)
    }
  }

  function removeFromPreview(id) {
    setPreview((prev) => prev.filter((e) => e.id !== id))
  }

  function handleConfirm() {
    preview.forEach((ev) => onImport(ev))
    setImported(true)
    setPreview([])
    setPhotos([])
  }

  // ── Pantalla principal: subir fotos + analizar ─────────────────────────────
  return (
    <div className="space-y-5">

      <div className="px-1">
        <p className="text-sm text-on-surface-variant font-medium">
          Sube fotos — la IA las lee y extrae todos los eventos.
        </p>
      </div>

      {/* Upload zone */}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={analyzing}
        className="w-full py-6 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 flex flex-col items-center gap-2 hover:bg-primary/8 active:scale-[0.98] transition-all disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-primary text-5xl" style={{ fontVariationSettings: "'FILL' 1" }}>
          add_photo_alternate
        </span>
        <span className="font-bold text-primary">
          {photos.length === 0 ? 'Seleccionar fotos' : `Añadir más (${photos.length} seleccionada${photos.length !== 1 ? 's' : ''})`}
        </span>
        <span className="text-xs text-outline font-medium">JPG, PNG · Varias a la vez</span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" multiple onChange={handlePhotos} className="hidden" />

      {/* Thumbnails */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map(({ url }, idx) => (
            <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-surface-container-low">
              <img src={url} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => removePhoto(idx)}
                disabled={analyzing}
                className="absolute top-1 right-1 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center disabled:opacity-0"
              >
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-error/10 rounded-xl border border-error/20">
          <p className="text-sm text-error font-semibold">{error}</p>
        </div>
      )}

      {/* Analyze button */}
      {photos.length > 0 && !analyzing && preview.length === 0 && !imported && (
        <button
          onClick={handleAnalyze}
          className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
        >
          <span className="material-symbols-outlined text-[22px]">auto_awesome</span>
          Analizar {photos.length} foto{photos.length !== 1 ? 's' : ''} con IA
        </button>
      )}

      {/* Loading */}
      {analyzing && (
        <div className="py-10 flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          <div className="text-center">
            <p className="text-sm font-bold text-on-surface">Analizando fotos...</p>
            <p className="text-xs text-outline font-medium mt-1">La IA está leyendo tu horario</p>
          </div>
        </div>
      )}

      {/* Success */}
      {imported && (
        <div className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-sm font-bold text-primary">Eventos añadidos al calendario</p>
        </div>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-on-surface">
              {preview.length} evento{preview.length !== 1 ? 's' : ''} detectado{preview.length !== 1 ? 's' : ''}
            </p>
            <span className="text-xs text-outline font-medium">Toca × para descartar</span>
          </div>
          <div className="space-y-2 max-h-52 overflow-y-auto hide-scrollbar">
            {preview.map((ev) => (
              <PreviewCard key={ev.id} ev={ev} onRemove={removeFromPreview} />
            ))}
          </div>
          <button
            onClick={handleConfirm}
            className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">add_circle</span>
            Añadir {preview.length} evento{preview.length !== 1 ? 's' : ''} al calendario
          </button>
        </div>
      )}
    </div>
  )
}

// ── Import tab — method picker + delegación al método elegido ───────────────
// Antes había 3 tabs separadas (Importar / Por texto / Foto) que confundían al
// usuario: los 3 son métodos del MISMO objetivo (traer eventos a Focus).
// Acá los muestro como un selector horizontal de 3 opciones, y debajo el flujo
// del método elegido. Cero navegación nueva: el cambio es inline.
const IMPORT_METHODS = [
  { id: 'photo', label: 'Foto',    icon: 'photo_camera', desc: 'Captura tu agenda en papel o un screenshot.' },
  { id: 'text',  label: 'Texto',   icon: 'edit_note',    desc: 'Pega un email, mensaje o cualquier texto con horarios.' },
  { id: 'file',  label: 'Archivo', icon: 'folder_zip',   desc: 'Sube un archivo de calendario desde Google, Apple u Outlook.' },
]

function ImportTab({ onImport, initialMethod = 'photo' }) {
  const [method, setMethod] = useState(initialMethod)
  const activeMeta = IMPORT_METHODS.find((m) => m.id === method) || IMPORT_METHODS[0]

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-bold text-on-surface mb-2">¿Cómo quieres traer tus eventos?</p>
        <div className="grid grid-cols-3 gap-2">
          {IMPORT_METHODS.map((m) => {
            const active = m.id === method
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                className={`flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-2xl border transition-all ${
                  active
                    ? 'bg-primary/10 border-primary/40 text-primary ring-1 ring-primary/30'
                    : 'bg-surface-container-lowest border-outline-variant/25 text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                <span
                  className="material-symbols-outlined text-[22px]"
                  style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {m.icon}
                </span>
                <span className="text-[11.5px] font-bold">{m.label}</span>
              </button>
            )
          })}
        </div>
        <p className="text-[11.5px] text-outline mt-2.5 leading-relaxed">{activeMeta.desc}</p>
      </div>

      {method === 'photo' && <PhotoTab onImport={onImport} />}
      {method === 'text'  && <TextTab onImport={onImport} />}
      {method === 'file'  && <ImportICSTab onImport={onImport} />}
    </div>
  )
}

// ── Main sheet ────────────────────────────────────────────────────────────────
function normalizeInitialTab(initialTab) {
  return TAB_ALIASES[initialTab] || initialTab || 'import'
}

export default function ImportExportSheet({ isOpen, onClose, events, onImportEvent, initialTab = 'import' }) {
  const [activeTab, setActiveTab] = useState(() => normalizeInitialTab(initialTab))
  const [importInitialMethod, setImportInitialMethod] = useState(
    () => INITIAL_IMPORT_METHOD_FROM_LEGACY_TAB[initialTab] || 'photo',
  )

  // Reset to initialTab each time the sheet opens — respeta el deep-link aun
  // cuando initialTab sea legacy ('text'/'photo'/'subscribe').
  useEffect(() => {
    if (!isOpen) return
    setActiveTab(normalizeInitialTab(initialTab))
    setImportInitialMethod(INITIAL_IMPORT_METHOD_FROM_LEGACY_TAB[initialTab] || 'photo')
  }, [isOpen, initialTab])

  useEffect(() => {
    if (!isOpen) return
    pushModal()
    return () => popModal()
  }, [isOpen])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet slides up from bottom */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[56] max-h-[90dvh] flex flex-col bg-surface dark:bg-slate-900 rounded-t-[28px] shadow-2xl"
        style={{ animation: 'slideUp 0.3s cubic-bezier(0.34,1.2,0.64,1) both' }}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-outline-variant rounded-full mx-auto mt-4 mb-2 flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 flex-shrink-0">
          <h2 className="font-headline font-extrabold text-xl text-on-surface dark:text-slate-100">
            Importar / Exportar
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-outline hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1.5 px-6 pb-3 flex-shrink-0 overflow-x-auto hide-scrollbar">
          {TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                activeTab === id
                  ? 'bg-primary text-white shadow-md shadow-primary/20'
                  : 'bg-surface-container-low text-outline hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto hide-scrollbar px-6 pb-10">
          {activeTab === 'import' && (
            <ImportTab onImport={onImportEvent} initialMethod={importInitialMethod} />
          )}
          {activeTab === 'export' && <ExportTab events={events} />}
          {activeTab === 'sync'   && <SubscribeTab />}
        </div>
      </div>
    </>
  )
}

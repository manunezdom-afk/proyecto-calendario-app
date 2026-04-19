import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Tab "Suscripción": genera y lista URLs privadas (token) para que Google
// Calendar / Apple / Outlook se suscriban al feed ICS en vivo. Requiere auth.
export default function SubscribeTab() {
  const [feeds, setFeeds] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('Focus')
  const [copied, setCopied] = useState(null)
  const [authed, setAuthed] = useState(false)
  const [error, setError] = useState('')

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
      const res = await fetch('/api/calendar-feeds', {
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
      const res = await fetch('/api/calendar-feeds', {
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
      await fetch('/api/calendar-feeds', {
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
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}/api/ics-feed?token=${token}`
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied(null), 2000)
    } catch {}
  }

  function qrUrl(url) {
    // Servicio público — evita agregar una dependencia de QR al bundle.
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`
  }

  if (!authed && !loading) {
    return (
      <div className="p-6 bg-surface-container-lowest rounded-2xl border border-outline-variant/20 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <span aria-hidden="true" className="material-symbols-outlined text-primary text-[26px]">account_circle</span>
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
      <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500/10 to-violet-500/10 border border-blue-500/20 space-y-2">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-primary text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>rss_feed</span>
          <p className="text-[13px] font-bold text-on-surface">Sincronización automática</p>
        </div>
        <p className="text-[12px] text-on-surface-variant leading-snug">
          Genera un URL privado y suscribe tu Google Calendar / Apple Calendar a él.
          <b> Cada cambio que hagas en Focus se reflejará solo en tus otros calendarios</b>, sin re-exportar nada.
        </p>
      </div>

      {feeds.length === 0 && (
        <div className="space-y-3 p-4 bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
          <p className="text-[12px] font-bold text-on-surface uppercase tracking-wider">Crear tu primer feed</p>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Nombre del feed (ej. Focus Personal)"
            aria-label="Nombre del feed"
            className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 bg-white text-sm focus:outline-none focus:border-primary"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full py-3 rounded-2xl bg-primary text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-40 active:scale-[0.98] transition-all"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">add_link</span>
            {creating ? 'Generando…' : 'Generar URL de suscripción'}
          </button>
        </div>
      )}

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
                aria-label="Revocar feed"
                title="Revocar feed"
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-outline hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>

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

            <details className="group">
              <summary className="text-[11.5px] font-semibold text-primary cursor-pointer list-none flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[14px] group-open:rotate-90 transition-transform">chevron_right</span>
                Ver código QR para escanear en otro dispositivo
              </summary>
              <div className="mt-3 flex justify-center p-3 bg-white rounded-xl border border-outline-variant/20">
                <img src={qrUrl(url)} alt="Código QR del feed" width={220} height={220} className="rounded-lg" />
              </div>
            </details>

            <div className="pt-1 space-y-2">
              <p className="text-[11px] font-bold text-on-surface uppercase tracking-wider">Cómo suscribirse</p>
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
              💡 Los calendarios se actualizan cada 1-24 h según la app. Si revocás este feed, todos los calendarios suscritos dejan de ver tus eventos.
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
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add</span>
          {creating ? 'Generando…' : 'Crear otro feed'}
        </button>
      )}

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[11.5px]">
          Error: {error}
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/apiClient'
import {
  getPushStatus,
  forceResubscribe,
  checkSubscriptionHealth,
  sendTestPush,
} from '../lib/pushSubscription'
import {
  getNativePushStatus,
  isNativePushSupported,
  registerNativePush,
} from '../lib/nativePush'
import PermissionsSection from '../components/PermissionsSection'
import { useAppPreferences } from '../hooks/useAppPreferences'
import { NOVA_PERSONALITIES } from '../utils/novaPersonality'
import { isIOS, isAndroid } from '../lib/permissions'
import { supabase } from '../lib/supabase'

// Copy contextual por plataforma para "dónde habilitar el permiso".
// El usuario ve "Ajustes de Android" en Android, "Ajustes del iPhone" en iOS,
// "ajustes del navegador" en desktop — no una instrucción genérica de iPhone.
function blockedPermissionMsg() {
  if (isIOS()) return 'Permiso de notificaciones bloqueado. Habilítalo en Ajustes del iPhone → Focus.'
  if (isAndroid()) return 'Permiso de notificaciones bloqueado. Habilítalo en Ajustes de Android → Apps → Focus → Notificaciones.'
  return 'Permiso de notificaciones bloqueado. Habilítalo en los ajustes del sitio del navegador.'
}

function SectionCard({ title, children }) {
  return (
    <section className="bg-white rounded-[20px] border border-slate-100 shadow-sm overflow-hidden">
      <p className="px-5 pt-4 pb-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {title}
      </p>
      {children}
    </section>
  )
}

function Row({ icon, label, sub, children, onClick, danger = false }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-5 py-3.5 border-t border-slate-50 first:border-t-0 transition-colors ${
        onClick
          ? danger
            ? 'hover:bg-red-50 active:bg-red-100'
            : 'hover:bg-slate-50 active:bg-slate-100'
          : ''
      }`}
    >
      <span
        className={`material-symbols-outlined text-[20px] flex-shrink-0 ${danger ? 'text-red-400' : 'text-slate-400'}`}
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0 text-left">
        <p className={`text-[13.5px] font-semibold leading-tight truncate ${danger ? 'text-red-500' : 'text-slate-800'}`}>
          {label}
        </p>
        {sub && <p className="text-[11.5px] text-slate-400 mt-0.5 leading-tight truncate">{sub}</p>}
      </div>
      {children}
    </Tag>
  )
}

// PushDiagnostic — 3 acciones separadas, cada una con su propio estado.
// Diseñado para NO colgarse: todos los helpers de pushSubscription.js usan
// withTimeout por dentro, y cada handler está envuelto en try/finally para que
// el flag de loading siempre se limpie aunque falle todo.
//
//   · Verificar       → diagnóstico puro (NO re-suscribe). Lee estado local y
//                        lo confronta con el backend.
//   · Reconectar      → descarta la sub actual y crea una nueva (último recurso
//                        cuando APNs/browser la invalidó en silencio).
//   · Enviar prueba   → pide al backend que dispare una push real a todas las
//                        suscripciones del user. Valida end-to-end incluyendo
//                        VAPID, red y SW.
function PushDiagnostic() {
  const [status, setStatus] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const busy = verifying || reconnecting || testing

  function msgForTimeout(label) {
    if (/sw_/.test(label)) return 'El service worker no respondió. Cierra y vuelve a abrir la app.'
    if (/backend|health|test/.test(label)) return 'No se pudo contactar al servidor. Revisa la conexión y reintenta.'
    return 'La operación tardó demasiado. Reintenta en unos segundos.'
  }

  async function handleVerify() {
    if (busy) return
    setVerifying(true)
    setStatus(null)
    try {
      if (isNativePushSupported()) {
        const s = await getNativePushStatus()
        if (s.error) {
          setStatus({ ok: false, msg: 'No se pudo leer el estado nativo de notificaciones. Cierra y vuelve a abrir la app.' })
          return
        }
        if (s.permission === 'denied') {
          setStatus({ ok: false, msg: blockedPermissionMsg() })
          return
        }
        if (s.permission !== 'granted') {
          setStatus({ ok: false, msg: 'Permiso aún no concedido. Activa las notificaciones desde el banner al crear un evento.' })
          return
        }
        if (!s.subscribed) {
          setStatus({ ok: false, msg: 'No hay token nativo registrado. Usa "Reconectar notificaciones" abajo para crearlo.' })
          return
        }
        const h = await checkSubscriptionHealth({ nativeToken: s.token })
        if (!h?.ok) {
          if (h?.reason === 'no_session') {
            setStatus({ ok: false, msg: 'No hay sesión activa. Inicia sesión para que el servidor pueda enviarte notificaciones.' })
          } else {
            setStatus({ ok: false, msg: 'No se pudo verificar con el servidor. Revisa la conexión y reintenta.' })
          }
          return
        }
        if (h.nativeTokenCount === 0 || h.currentNativePresent === false) {
          setStatus({ ok: false, msg: 'El servidor no tiene el token de esta app. Usa "Reconectar notificaciones" abajo.' })
          return
        }
        setStatus({ ok: true, msg: '✅ Todo OK. Permiso activo, token nativo y servidor conectados.' })
        return
      }

      const s = await getPushStatus()
      if (s.error) {
        setStatus({ ok: false, msg: msgForTimeout(s.error) })
        return
      }
      if (!s.supported) {
        const hint = isIOS()
          ? 'En iPhone hay que instalar la PWA en la pantalla de inicio.'
          : 'Tu navegador no soporta Web Push.'
        setStatus({ ok: false, msg: `Este dispositivo no soporta notificaciones push. ${hint}` })
        return
      }
      if (s.permission === 'denied') {
        setStatus({ ok: false, msg: blockedPermissionMsg() })
        return
      }
      if (s.permission !== 'granted') {
        setStatus({ ok: false, msg: 'Permiso aún no concedido. Activa las notificaciones desde el banner al crear un evento.' })
        return
      }
      if (!s.subscribed) {
        setStatus({ ok: false, msg: 'No hay suscripción local. Usa "Reconectar notificaciones" abajo para crear una.' })
        return
      }
      const h = await checkSubscriptionHealth()
      if (!h?.ok) {
        if (h?.reason === 'no_session') {
          setStatus({ ok: false, msg: 'No hay sesión activa. Inicia sesión para que el servidor pueda enviarte notificaciones.' })
        } else if (/timeout/i.test(h?.reason || '') || /timeout/i.test(h?.error || '')) {
          setStatus({ ok: false, msg: 'No se pudo contactar al servidor. Revisa la conexión y reintenta.' })
        } else if (h?.reason === 'network_error') {
          setStatus({ ok: false, msg: 'No se pudo contactar al servidor. Revisa la conexión y reintenta.' })
        } else {
          setStatus({ ok: false, msg: `No se pudo verificar con el servidor: ${h?.reason || 'error desconocido'}` })
        }
        return
      }
      if (h.subscriptionCount === 0 || h.currentPresent === false) {
        setStatus({ ok: false, msg: 'El servidor no tiene tu suscripción. Probablemente APNs la invalidó. Usa "Reconectar notificaciones" abajo.' })
        return
      }
      setStatus({ ok: true, msg: '✅ Todo OK. Permiso activo, suscripción local y el servidor la tiene registrada.' })
    } catch (e) {
      const m = String(e?.message || e)
      if (/timeout/i.test(m)) {
        setStatus({ ok: false, msg: 'La verificación tardó demasiado. Reintenta en unos segundos.' })
      } else {
        setStatus({ ok: false, msg: `Error inesperado: ${m}` })
      }
    } finally {
      setVerifying(false)
    }
  }

  async function handleReconnect() {
    if (busy) return
    setReconnecting(true)
    setStatus(null)
    try {
      const r = isNativePushSupported()
        ? await registerNativePush({ prompt: true })
        : await forceResubscribe()
      if (r.ok && r.reason !== 'saved_locally_no_session') {
        setStatus({ ok: true, msg: '✅ Reconectado. Nueva suscripción guardada en el servidor.' })
        return
      }
      if (r.reason === 'saved_locally_no_session') {
        setStatus({ ok: false, msg: 'Suscripción creada pero sin sesión para guardar en el servidor. Inicia sesión y reintenta.' })
      } else if (r.reason === 'permission_denied') {
        setStatus({ ok: false, msg: blockedPermissionMsg() })
      } else if (r.reason === 'no_vapid_key') {
        setStatus({ ok: false, msg: 'Falta configurar VITE_VAPID_PUBLIC_KEY en Vercel.' })
      } else if (r.reason === 'native_registration_timeout') {
        setStatus({ ok: false, msg: 'El registro nativo tardó demasiado. Cierra y vuelve a abrir la app, luego reintenta.' })
      } else if (r.reason === 'unsupported') {
        setStatus({ ok: false, msg: 'Este dispositivo no soporta notificaciones push.' })
      } else if (/timeout/i.test(String(r.reason || r.error || ''))) {
        setStatus({ ok: false, msg: msgForTimeout(String(r.reason || r.error || '')) })
      } else {
        setStatus({ ok: false, msg: `No se pudo reconectar: ${r.reason}${r.error ? ` — ${r.error}` : ''}` })
      }
    } catch (e) {
      setStatus({ ok: false, msg: `Error inesperado: ${e?.message || e}` })
    } finally {
      setReconnecting(false)
    }
  }

  async function handleTest() {
    if (busy) return
    setTesting(true)
    setStatus(null)
    try {
      const r = await sendTestPush()
      if (r.ok) {
        setStatus({ ok: true, msg: `✅ Notificación de prueba enviada (${r.sent}/${r.subscriptions}). Debería aparecer en segundos.` })
        return
      }
      const reason = r.reason || ''
      if (reason === 'no_session' || reason === 'unauthorized') {
        setStatus({ ok: false, msg: 'No hay sesión activa. Inicia sesión para poder enviar notificaciones.' })
      } else if (reason === 'no_subscriptions_for_user') {
        setStatus({ ok: false, msg: 'El servidor no tiene ninguna suscripción para tu cuenta. Usa "Reconectar notificaciones" primero.' })
      } else if (reason === 'vapid_not_configured') {
        setStatus({ ok: false, msg: 'Faltan las VAPID keys en Vercel (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).' })
      } else if (reason === 'apns_not_configured') {
        setStatus({ ok: false, msg: 'Faltan las credenciales APNs en Vercel (APNS_TEAM_ID / APNS_KEY_ID / APNS_PRIVATE_KEY).' })
      } else if (reason === 'no_delivery') {
        setStatus({ ok: false, msg: 'El servidor aceptó la prueba pero ninguna push llegó a entregarse. Probablemente la suscripción está caduca — usa "Reconectar".' })
      } else if (reason === 'unsupported') {
        setStatus({ ok: false, msg: 'Este dispositivo no soporta notificaciones push.' })
      } else if (/timeout/i.test(reason)) {
        setStatus({ ok: false, msg: 'El servidor tardó demasiado. Reintenta en unos segundos.' })
      } else {
        setStatus({ ok: false, msg: `No se pudo enviar la prueba: ${reason}` })
      }
    } catch (e) {
      setStatus({ ok: false, msg: `Error inesperado: ${e?.message || e}` })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div
      className="px-5 py-4 border-t border-slate-50 space-y-3"
      role="group"
      aria-label="Diagnóstico avanzado de notificaciones push"
    >
      <button
        type="button"
        onClick={handleVerify}
        disabled={busy}
        aria-label="Verificar notificaciones push"
        className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-[13px] font-semibold disabled:opacity-50 active:scale-95 transition-transform"
      >
        {verifying ? 'Verificando…' : 'Verificar notificaciones push'}
      </button>
      <button
        type="button"
        onClick={handleReconnect}
        disabled={busy}
        aria-label="Reconectar notificaciones push"
        className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 text-[13px] font-semibold disabled:opacity-50 active:scale-95 transition-all hover:bg-slate-50"
        title="Crea una suscripción nueva y descarta la actual. Útil si las notificaciones dejaron de llegar."
      >
        {reconnecting ? 'Reconectando…' : 'Reconectar notificaciones'}
      </button>
      <button
        type="button"
        onClick={handleTest}
        disabled={busy}
        aria-label="Enviar notificación push de prueba"
        className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 text-[13px] font-semibold disabled:opacity-50 active:scale-95 transition-all hover:bg-slate-50"
        title="Pide al servidor que envíe una push real a todas tus suscripciones. Valida que el flow completo funciona."
      >
        {testing ? 'Enviando…' : 'Enviar notificación de prueba'}
      </button>
      {status && (
        <p className={`text-[12.5px] leading-snug font-medium rounded-xl px-3 py-2.5 ${
          status.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
        }`} role="status" aria-live="polite">
          {status.msg}
        </p>
      )}
    </div>
  )
}

// Refleja el estado real de push en lugar del check verde estático.
// Estados:
//   · active           → permiso OK + sub local + backend confirma y última
//                        entrega exitosa (o aún sin datos)
//   · disconnected     → permiso OK pero backend no tiene la sub (o tuvo pero
//                        la borró por 410). Síntoma: nunca llegarán notifs.
//                        Distinto de `inactive`: el usuario cree que dijo sí.
//   · inactive         → permiso en 'default' — aún no decidió
//   · blocked          → permiso 'denied' en el SO
//   · unsupported      → dispositivo no tiene Push API
// Además expone la última entrega reportada por el backend (si la migración
// Genera labels "00:00" "01:00" ... "23:00" para los selects de quiet hours.
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${String(h).padStart(2, '0')}:00`,
}))

// QuietHoursRow — permite al usuario fijar una ventana "no molestar" (en
// hora local). Se escribe en user_profiles.quiet_start/quiet_end y el cron
// la respeta antes de disparar cada push. Quedan avisos inminentes (≤ 5
// min) igual, por diseño: algo que empieza ahora no debería dormir.
function QuietHoursRow() {
  const { user } = useAuth()
  const [start, setStart] = useState(null)
  const [end, setEnd] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user?.id || !supabase) { setLoaded(true); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('quiet_start, quiet_end')
          .eq('id', user.id)
          .maybeSingle()
        if (cancelled) return
        if (!error && data) {
          setStart(Number.isInteger(data.quiet_start) ? data.quiet_start : null)
          setEnd(Number.isInteger(data.quiet_end) ? data.quiet_end : null)
        }
      } catch {} finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  const enabled = start != null && end != null

  async function persist(nextStart, nextEnd) {
    if (!user?.id || !supabase) return
    setSaving(true)
    try {
      await supabase
        .from('user_profiles')
        .upsert(
          { id: user.id, quiet_start: nextStart, quiet_end: nextEnd },
          { onConflict: 'id' },
        )
    } catch {} finally {
      setSaving(false)
    }
  }

  function toggle() {
    if (enabled) {
      setStart(null); setEnd(null); persist(null, null)
    } else {
      // Default razonable: 22:00 a 07:00 (cruza medianoche).
      setStart(22); setEnd(7); persist(22, 7)
    }
  }

  function updateStart(v) {
    const n = Number(v)
    setStart(n)
    if (end != null) persist(n, end)
  }

  function updateEnd(v) {
    const n = Number(v)
    setEnd(n)
    if (start != null) persist(start, n)
  }

  if (!user) {
    return (
      <div className="flex items-start gap-3 px-5 py-3 border-t border-slate-50">
        <span className="material-symbols-outlined text-slate-400 text-[18px] mt-0.5">bedtime</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-600">No molestar</p>
          <p className="text-[11.5px] text-slate-400 leading-snug">
            Inicia sesión para configurar tu ventana de silencio.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-slate-50">
      <button
        type="button"
        onClick={toggle}
        disabled={saving || !loaded}
        className="w-full flex items-start gap-3 px-5 py-3 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-60"
      >
        <span
          className={`material-symbols-outlined text-[18px] mt-0.5 ${enabled ? 'text-primary' : 'text-slate-400'}`}
          style={{ fontVariationSettings: enabled ? "'FILL' 1" : "'FILL' 0" }}
        >
          bedtime
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-700">No molestar</p>
          <p className="text-[11.5px] text-slate-400 leading-snug">
            {enabled
              ? 'Focus silencia los avisos en esta ventana. Lo inminente (≤ 5 min) sigue llegando.'
              : 'Activa una ventana de silencio para que los recordatorios no te interrumpan de noche.'}
          </p>
        </div>
        <span className={`flex-shrink-0 mt-1 w-9 h-5 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-slate-200'}`}>
          <span className={`block w-4 h-4 rounded-full bg-white shadow-sm mt-0.5 transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
        </span>
      </button>
      {enabled && (
        <div className="flex items-center gap-2 px-5 pb-4 pt-1">
          <select
            value={start}
            onChange={(e) => updateStart(e.target.value)}
            disabled={saving}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {HOUR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>Desde {o.label}</option>
            ))}
          </select>
          <select
            value={end}
            onChange={(e) => updateEnd(e.target.value)}
            disabled={saving}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {HOUR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>Hasta {o.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

// 005 está aplicada) para que el usuario vea "última notif enviada".
function RemindersRow() {
  const [state, setState] = useState('checking')
  const [lastDelivery, setLastDelivery] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        if (isNativePushSupported()) {
          const s = await getNativePushStatus()
          if (cancelled) return
          if (!s.supported) { setState('unsupported'); return }
          if (s.permission === 'denied') { setState('blocked'); return }
          if (s.permission !== 'granted') { setState('inactive'); return }
          if (!s.subscribed) { setState('disconnected'); return }
          const h = await checkSubscriptionHealth({ nativeToken: s.token }).catch(() => null)
          if (cancelled) return
          if (h?.ok) {
            if (h.lastDelivery) setLastDelivery(h.lastDelivery)
            if (h.nativeTokenCount === 0 || h.currentNativePresent === false) {
              setState('disconnected')
            } else {
              setState('active')
            }
          } else {
            setState('active')
          }
          return
        }

        const s = await getPushStatus()
        if (cancelled) return
        if (!s.supported) { setState('unsupported'); return }
        if (s.permission === 'denied') { setState('blocked'); return }
        if (s.permission !== 'granted') { setState('inactive'); return }
        if (!s.subscribed) { setState('disconnected'); return }
        // Tenemos sub local — confirmamos con backend y pedimos última entrega
        const h = await checkSubscriptionHealth().catch(() => null)
        if (cancelled) return
        if (h?.ok) {
          if (h.lastDelivery) setLastDelivery(h.lastDelivery)
          if (h.subscriptionCount === 0 || h.currentPresent === false) {
            setState('disconnected')
          } else {
            setState('active')
          }
        } else {
          // no se pudo verificar con backend — damos beneficio de la duda
          setState('active')
        }
      } catch {
        if (!cancelled) setState('inactive')
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  const baseCopy = {
    checking:     { sub: 'Verificando estado…',                                          icon: 'check_circle',      color: 'text-slate-300' },
    active:       { sub: 'Focus adapta cada aviso al tipo de evento y respeta tus tiempos personalizados', icon: 'check_circle', color: 'text-emerald-400' },
    disconnected: { sub: 'Permiso OK pero la conexión al servidor se cortó — usa "Reconectar" abajo', icon: 'sync_problem', color: 'text-amber-400' },
    inactive:     { sub: 'No están activas — actívalas desde el banner al crear un evento', icon: 'error',           color: 'text-amber-400' },
    blocked:      { sub: 'Permiso bloqueado — reactívalo desde los ajustes del sistema', icon: 'block',             color: 'text-red-400' },
    unsupported:  { sub: 'Este dispositivo no soporta notificaciones push',              icon: 'do_not_disturb_on', color: 'text-slate-300' },
  }[state]

  // Si tenemos lastDelivery, enriquecemos el sub con la última entrega real
  // ("Última notif enviada: hace 3h — 'En 10 min: Reunión'"). Fuente de
  // verdad: backend. Si falló, lo decimos.
  let sub = baseCopy.sub
  if (state === 'active' && lastDelivery) {
    const ago = timeAgo(lastDelivery.sentAt)
    if (lastDelivery.status === 'delivered') {
      sub = `Última notificación enviada ${ago}${lastDelivery.title ? ` · "${lastDelivery.title}"` : ''}`
    } else if (lastDelivery.status === 'gone') {
      sub = `La última sub de este dispositivo expiró ${ago} — reconecta abajo`
    } else if (lastDelivery.status === 'failed') {
      sub = `El último intento falló ${ago} (${lastDelivery.statusCode || 'error'}) — reintenta abajo`
    }
  }

  return (
    <Row icon="notifications" label="Notificaciones inteligentes" sub={sub}>
      <span className={`material-symbols-outlined text-[16px] ${baseCopy.color}`}>
        {baseCopy.icon}
      </span>
    </Row>
  )
}

// KairosLinkSection — vincular la cuenta con la app hermana Kairos.
//
// Flujo: el usuario copia su focusCode y lo pega en Kairos → Ajustes
// → Vincular Focus. A partir de ese momento los eventos creados en
// Kairos llegan al inbox de Focus como sugerencias para que Nova las
// proponga. Si pega el código de Kairos en el campo "Pegar código",
// guardamos esa referencia para mostrarla aquí (es solo informativo:
// el flujo real lo activa el envío de eventos desde Kairos).
function KairosLinkSection() {
  const { user } = useAuth()
  const [focusCode, setFocusCode] = useState(null)
  const [kairosCode, setKairosCode] = useState(null)
  const [linkedAt, setLinkedAt] = useState(null)
  const [pasteValue, setPasteValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const fetchLink = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/kairos/link', { method: 'GET' })
      if (!res.ok) throw new Error('fetch_failed')
      const data = await res.json()
      setFocusCode(data.focusCode)
      setKairosCode(data.kairosCode)
      setLinkedAt(data.linkedAt)
    } catch {
      setError('No pudimos cargar tu código. Reintenta en un momento.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { fetchLink() }, [fetchLink])

  async function handleCopy() {
    if (!focusCode) return
    try {
      await navigator.clipboard.writeText(focusCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Si clipboard API no está disponible, no hacemos nada — el usuario
      // puede copiar manualmente del input visible.
    }
  }

  async function handleLink(e) {
    e?.preventDefault?.()
    const cleaned = pasteValue.trim().toUpperCase().replace(/\s+/g, '')
    if (cleaned.length < 4) {
      setError('El código debe tener al menos 4 caracteres.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/kairos/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kairosCode: cleaned }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'link_failed')
      }
      const data = await res.json()
      setKairosCode(data.kairosCode)
      setLinkedAt(data.linkedAt)
      setPasteValue('')
    } catch (err) {
      setError(err.message === 'invalid_code'
        ? 'Ese código no parece válido.'
        : 'No pudimos vincular. Reintenta.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegenerate() {
    if (!confirm('¿Generar un código nuevo? El anterior dejará de funcionar.')) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/kairos/link', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: false }),
      })
      if (!res.ok) throw new Error('regenerate_failed')
      const data = await res.json()
      setFocusCode(data.focusCode)
      setKairosCode(data.kairosCode)
      setLinkedAt(data.linkedAt)
    } catch {
      setError('No pudimos regenerar el código. Reintenta.')
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
    return (
      <SectionCard title="Vincular con Kairos">
        <div className="px-5 py-5">
          <p className="text-[13px] text-slate-500 leading-relaxed">
            Inicia sesión en Focus para vincular tu cuenta con Kairos y recibir
            ahí los eventos que crees desde la app hermana.
          </p>
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard title="Vincular con Kairos">
      <div className="px-5 py-5 space-y-5 border-t border-slate-50 first:border-t-0">
        <p className="text-[13px] text-slate-500 leading-relaxed">
          Conecta Focus con Kairos. Los eventos que crees en Kairos llegarán
          aquí como propuestas de Nova para que decidas si los agendas.
        </p>

        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-2">
            Tu código de Focus
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="material-symbols-outlined text-[18px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                key
              </span>
              <span className="font-mono tracking-[0.18em] text-[15px] font-semibold text-slate-800 select-all">
                {focusCode || '······'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!focusCode || loading}
              className="rounded-xl px-3 py-2.5 text-[12px] font-semibold text-primary border border-primary/20 hover:bg-primary/5 active:scale-[0.97] transition-all disabled:opacity-40"
            >
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-slate-400 leading-snug">
            Pégalo en Kairos → Ajustes → Vincular Focus. Cualquiera con el
            código puede mandarte propuestas, así que regenera si lo filtras.
          </p>
        </div>

        <form onSubmit={handleLink}>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-2">
            Pegar el código de Kairos
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={pasteValue}
              onChange={(e) => { setPasteValue(e.target.value); setError(null) }}
              placeholder="Ej. THW33R"
              maxLength={32}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 font-mono tracking-[0.16em] text-[14px] text-slate-800 placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-300 focus:outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={loading || !pasteValue.trim()}
              className="rounded-xl px-4 py-2.5 text-[12.5px] font-semibold text-white bg-primary active:scale-[0.97] transition-transform disabled:opacity-40"
            >
              Vincular
            </button>
          </div>
          {kairosCode && (
            <p className="mt-2 text-[11.5px] text-emerald-600 font-medium">
              Vinculado a Kairos · {kairosCode}
              {linkedAt && <span className="text-slate-400 font-normal"> · {timeAgo(linkedAt)}</span>}
            </p>
          )}
          {error && (
            <p className="mt-2 text-[11.5px] text-red-500">
              {error}
            </p>
          )}
        </form>

        <button
          type="button"
          onClick={handleRegenerate}
          disabled={loading}
          className="text-[11.5px] font-medium text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-40"
        >
          Generar un código nuevo
        </button>
      </div>
    </SectionCard>
  )
}

function timeAgo(iso) {
  if (!iso) return 'hace un rato'
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 0) return 'recién'
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'hace instantes'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'ayer' : `hace ${days} días`
}

const DURATION_BEHAVIOR_OPTIONS = [
  { value: 'ask',        label: 'Preguntar cada vez',       sub: 'Muestra chips de duración antes de guardar' },
  { value: 'default30',  label: '30 minutos por defecto',   sub: 'Asume 30 min sin preguntar cuando no es claro' },
  { value: 'none',       label: 'Sin hora de término',      sub: 'Guarda solo la hora de inicio' },
]

export default function SettingsView({ onOpenImport, onOpenMemory, onOpenNovaKnows, memoriesCount = 0 }) {
  const { user, setAuthModal, signOut } = useAuth()
  const { prefs, setPreference } = useAppPreferences()
  const currentBehavior = DURATION_BEHAVIOR_OPTIONS.find(
    (o) => o.value === prefs.defaultDurationBehavior,
  ) ?? DURATION_BEHAVIOR_OPTIONS[0]
  const [durationPickerOpen, setDurationPickerOpen] = useState(false)

  const currentPersonality = NOVA_PERSONALITIES.find(
    (p) => p.id === prefs.novaPersonality,
  ) ?? NOVA_PERSONALITIES[0]
  const [personalityPickerOpen, setPersonalityPickerOpen] = useState(false)

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 py-6 space-y-6 pb-40">

      {/* Título */}
      <div className="px-1 mb-2">
        <h1 className="text-2xl font-extrabold text-slate-900">Ajustes</h1>
      </div>

      {/* ── Perfil ──────────────────────────────────────────────────────── */}
      <SectionCard title="Tu perfil">
        {/* Estado de cuenta — muestra el email si hay sesión, o invita a crear cuenta.
            Es el único entry point al login desde Ajustes (antes había dos). */}
        <Row
          icon={user ? 'account_circle' : 'login'}
          label={user ? user.email : 'Iniciar sesión'}
          sub={user ? 'Sesión activa · datos en la nube' : 'Sin cuenta — tus datos solo viven en este dispositivo'}
          onClick={() => setAuthModal(true)}
        >
          <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
        </Row>

        {/* Nota sobre aprendizaje automático */}
        <div className="px-5 py-3 border-t border-slate-50 flex items-start gap-2.5">
          <span
            className="material-symbols-outlined text-primary text-[18px] flex-shrink-0 mt-0.5"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            auto_awesome
          </span>
          <p className="text-[12px] text-slate-500 leading-snug">
            Focus aprende tus patrones solo — cuándo completas tareas, qué
            sugerencias aceptas, qué días rindes más. Revisa lo que Nova va
            entendiendo en <b>Nova IA → Lo que Nova sabe de ti</b>.
          </p>
        </div>
      </SectionCard>

      {/* ── Nova IA ──────────────────────────────────────────────────────── */}
      <SectionCard title="Nova IA">
        <Row
          icon="auto_awesome"
          label="Acción directa con Deshacer"
          sub="Nova crea al momento y deja un botón de Deshacer tras cada cambio"
        >
          <div className="w-10 h-6 rounded-full bg-primary flex items-center justify-end px-1 flex-shrink-0">
            <div className="w-4 h-4 rounded-full bg-white shadow-sm" />
          </div>
        </Row>
        <Row
          icon="insights"
          label="Lo que Nova sabe de ti"
          sub="Patrones que aprendió de tu uso — días fuertes, tipos rechazados, categorías"
          onClick={onOpenNovaKnows}
        >
          <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
        </Row>
        <Row
          icon="psychology"
          label="Memorias de Nova"
          sub={memoriesCount > 0
            ? `${memoriesCount} ${memoriesCount === 1 ? 'memoria guardada' : 'memorias guardadas'} — relaciones, metas, contextos`
            : 'Datos explícitos que te pido recordar (relaciones, metas, contextos)'}
          onClick={onOpenMemory}
        >
          {memoriesCount > 0 && (
            <span className="text-[11px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 min-w-[22px] text-center">
              {memoriesCount}
            </span>
          )}
          <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
        </Row>
        <Row
          icon="tune"
          label="Personalidad de Nova"
          sub={currentPersonality.description}
          onClick={() => setPersonalityPickerOpen((v) => !v)}
        >
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[12px] font-semibold text-slate-500">{currentPersonality.label}</span>
            <span className="material-symbols-outlined text-[16px] text-slate-300">
              {personalityPickerOpen ? 'expand_less' : 'chevron_right'}
            </span>
          </div>
        </Row>
        {personalityPickerOpen && (
          <div className="border-t border-slate-50 bg-slate-50/40">
            {NOVA_PERSONALITIES.map((opt) => {
              const selected = prefs.novaPersonality === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    setPreference('novaPersonality', opt.id)
                    setPersonalityPickerOpen(false)
                  }}
                  className={`w-full flex items-start gap-3 px-5 py-3 text-left border-t border-slate-100 first:border-t-0 transition-colors hover:bg-white active:bg-slate-100 ${selected ? 'bg-white' : ''}`}
                >
                  <span
                    className={`material-symbols-outlined text-[18px] mt-0.5 flex-shrink-0 ${selected ? 'text-primary' : 'text-slate-300'}`}
                    style={{ fontVariationSettings: selected ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {selected ? 'radio_button_checked' : 'radio_button_unchecked'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-semibold leading-tight ${selected ? 'text-slate-800' : 'text-slate-600'}`}>
                      {opt.label}
                    </p>
                    <p className="text-[11.5px] text-slate-400 mt-0.5 leading-tight">{opt.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Eventos ──────────────────────────────────────────────────────── */}
      {/* Comportamiento por defecto al crear un evento sin duración explícita.
          "Preguntar" es el default — muestra chips de duración en QuickAdd y
          obliga a Nova a confirmar si no puede inferir con seguridad. Las
          otras opciones silencian esa fricción a cambio de asumir algo. */}
      <SectionCard title="Eventos">
        <Row
          icon="schedule"
          label="Duración al crear eventos"
          sub={currentBehavior.sub}
          onClick={() => setDurationPickerOpen((v) => !v)}
        >
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[12px] font-semibold text-slate-500">{currentBehavior.label}</span>
            <span className="material-symbols-outlined text-[16px] text-slate-300">
              {durationPickerOpen ? 'expand_less' : 'chevron_right'}
            </span>
          </div>
        </Row>
        {durationPickerOpen && (
          <div className="border-t border-slate-50 bg-slate-50/40">
            {DURATION_BEHAVIOR_OPTIONS.map((opt) => {
              const selected = prefs.defaultDurationBehavior === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    setPreference('defaultDurationBehavior', opt.value)
                    setDurationPickerOpen(false)
                  }}
                  className={`w-full flex items-start gap-3 px-5 py-3 text-left border-t border-slate-100 first:border-t-0 transition-colors hover:bg-white active:bg-slate-100 ${selected ? 'bg-white' : ''}`}
                >
                  <span
                    className={`material-symbols-outlined text-[18px] mt-0.5 flex-shrink-0 ${selected ? 'text-primary' : 'text-slate-300'}`}
                    style={{ fontVariationSettings: selected ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {selected ? 'radio_button_checked' : 'radio_button_unchecked'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-semibold leading-tight ${selected ? 'text-slate-800' : 'text-slate-600'}`}>
                      {opt.label}
                    </p>
                    <p className="text-[11.5px] text-slate-400 mt-0.5 leading-tight">{opt.sub}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Permisos ─────────────────────────────────────────────────────── */}
      {/* Micrófono, cámara y notificaciones en un solo lugar. Útil sobre todo
          en Safari/iPhone, donde los permisos bloqueados solo se reactivan
          desde Ajustes del sistema y el usuario necesita una guía clara. */}
      <PermissionsSection />

      {/* ── Notificaciones ───────────────────────────────────────────────── */}
      {/* El estado de concesión ya lo maneja PermissionsSection. Aquí
          mantenemos el diagnóstico avanzado de push (VAPID, suscripción en
          el servidor, etc.) para desbloquear casos donde el permiso está
          concedido pero la entrega de push falla. */}
      <SectionCard title="Notificaciones">
        <RemindersRow />
        <QuietHoursRow />
        <PushDiagnostic />
      </SectionCard>

      {/* ── Vincular con Kairos ──────────────────────────────────────────── */}
      <KairosLinkSection />

      {/* ── Datos ────────────────────────────────────────────────────────── */}
      <SectionCard title="Datos">
        <Row
          icon="upload_file"
          label="Importar / Exportar calendario"
          sub="Importa desde Google Calendar, exporta a .ics"
          onClick={onOpenImport}
        >
          <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
        </Row>
      </SectionCard>

      {/* ── Cerrar sesión (solo si hay sesión activa) ───────────────────── */}
      {user && (
        <SectionCard title="Cuenta">
          <Row
            icon="logout"
            label="Cerrar sesión"
            sub={user.email}
            onClick={signOut}
            danger
          />
        </SectionCard>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <p className="text-center text-[11px] text-slate-300 pt-2">
        Focus · Calendario con IA
      </p>
    </div>
  )
}

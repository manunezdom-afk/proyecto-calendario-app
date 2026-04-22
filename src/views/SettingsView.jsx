import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  getPushStatus,
  subscribeToPush,
  forceResubscribe,
  checkSubscriptionHealth,
} from '../lib/pushSubscription'
import PermissionsSection from '../components/PermissionsSection'
import { useAppPreferences } from '../hooks/useAppPreferences'
import { isIOS, isAndroid } from '../lib/permissions'

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
      <p className="px-5 pt-4 pb-2 text-[11px] font-bold text-slate-400">
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

function PushDiagnostic() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  async function runTest() {
    setLoading(true)
    setStatus(null)
    try {
      const s = await getPushStatus()
      if (!s.supported) { setStatus({ ok: false, msg: 'Este dispositivo no soporta notificaciones push.' }); return }
      if (s.permission === 'denied') { setStatus({ ok: false, msg: blockedPermissionMsg() }); return }
      if (s.permission !== 'granted') { setStatus({ ok: false, msg: 'Permiso no concedido. Activa las notificaciones desde la pantalla principal.' }); return }

      // Primero chequeamos la salud con el backend para dar diagnóstico fiel
      // antes de subir otra vez una suscripción que podría estar muerta.
      const h = await checkSubscriptionHealth()
      if (h?.ok && s.subscribed && (h.subscriptionCount === 0 || h.currentPresent === false)) {
        setStatus({
          ok: false,
          msg: 'El servidor no tiene tu suscripción. Probablemente APNs la invalidó. Usa "Reconectar notificaciones" abajo para crear una nueva.',
        })
        return
      }

      if (s.subscribed) {
        const r = await subscribeToPush()
        if (r.ok && r.reason !== 'saved_locally_no_session') {
          setStatus({ ok: true, msg: '✅ Suscripción activa y guardada en el servidor. Las notificaciones deberían llegar.' })
        } else if (r.reason === 'saved_locally_no_session') {
          setStatus({ ok: false, msg: 'Suscripción creada pero no se pudo guardar — no hay sesión activa. Cierra sesión y vuelve a entrar.' })
        } else {
          setStatus({ ok: false, msg: `Error al guardar: ${r.reason} ${r.error || ''}` })
        }
      } else {
        const r = await subscribeToPush()
        if (r.ok && r.reason !== 'saved_locally_no_session') {
          setStatus({ ok: true, msg: '✅ Suscripción creada y guardada. Las notificaciones van a funcionar.' })
        } else if (r.reason === 'saved_locally_no_session') {
          setStatus({ ok: false, msg: 'Creada localmente pero sin sesión para guardar en el servidor. Cierra sesión y vuelve a entrar.' })
        } else if (r.reason === 'no_vapid_key') {
          setStatus({ ok: false, msg: 'Falta configurar VITE_VAPID_PUBLIC_KEY en Vercel.' })
        } else if (r.reason === 'subscribe_failed') {
          const plat = isIOS() ? 'iOS' : (isAndroid() ? 'Android' : 'El navegador')
          setStatus({ ok: false, msg: `${plat} rechazó la suscripción: ${r.error}` })
        } else {
          setStatus({ ok: false, msg: `Error: ${r.reason} — ${r.error || ''}` })
        }
      }
    } catch (e) {
      setStatus({ ok: false, msg: `Error inesperado: ${e.message}` })
    } finally {
      setLoading(false)
    }
  }

  // Último recurso para cuando APNs invalidó la suscripción sin avisar:
  // desuscribir localmente y volver a subscribir con endpoint fresco. Útil
  // también después de reinstalar la PWA o cambiar de cuenta.
  async function reconnect() {
    setReconnecting(true)
    setStatus(null)
    try {
      const r = await forceResubscribe()
      if (r.ok && r.reason !== 'saved_locally_no_session') {
        setStatus({ ok: true, msg: '✅ Reconectado. Nueva suscripción guardada en el servidor.' })
      } else if (r.reason === 'permission_denied') {
        setStatus({ ok: false, msg: 'Permiso de notificaciones denegado. Actívalo en Ajustes del sistema y vuelve a intentar.' })
      } else {
        setStatus({ ok: false, msg: `No se pudo reconectar: ${r.reason}${r.error ? ` — ${r.error}` : ''}` })
      }
    } catch (e) {
      setStatus({ ok: false, msg: `Error inesperado: ${e.message}` })
    } finally {
      setReconnecting(false)
    }
  }

  return (
    <div className="px-5 py-4 border-t border-slate-50 space-y-3">
      <button
        onClick={runTest}
        disabled={loading || reconnecting}
        className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-[13px] font-semibold disabled:opacity-50 active:scale-95 transition-transform"
      >
        {loading ? 'Verificando…' : 'Verificar notificaciones push'}
      </button>
      <button
        onClick={reconnect}
        disabled={loading || reconnecting}
        className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 text-[13px] font-semibold disabled:opacity-50 active:scale-95 transition-all hover:bg-slate-50"
        title="Crea una suscripción nueva y descarta la actual. Útil si las notificaciones dejaron de llegar."
      >
        {reconnecting ? 'Reconectando…' : 'Reconectar notificaciones'}
      </button>
      {status && (
        <p className={`text-[12.5px] leading-snug font-medium rounded-xl px-3 py-2.5 ${
          status.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
        }`}>
          {status.msg}
        </p>
      )}
    </div>
  )
}

const DURATION_BEHAVIOR_OPTIONS = [
  { value: 'ask',        label: 'Preguntar cada vez',       sub: 'Muestra chips de duración antes de guardar' },
  { value: 'default30',  label: '30 minutos por defecto',   sub: 'Asume 30 min sin preguntar cuando no es claro' },
  { value: 'none',       label: 'Sin hora de término',      sub: 'Guarda solo la hora de inicio' },
]

export default function SettingsView({ onOpenImport, onOpenMemory, onOpenNovaKnows }) {
  const { user, setAuthModal, signOut } = useAuth()
  const { prefs, setPreference } = useAppPreferences()
  const currentBehavior = DURATION_BEHAVIOR_OPTIONS.find(
    (o) => o.value === prefs.defaultDurationBehavior,
  ) ?? DURATION_BEHAVIOR_OPTIONS[0]
  const [durationPickerOpen, setDurationPickerOpen] = useState(false)

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 py-6 space-y-4 pb-40">

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
          label="Modo propuesta"
          sub="Nova sugiere cambios — tú apruebas o rechazas cada uno"
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
          sub="Datos explícitos que te pedí recordar (relaciones, metas, contextos)"
          onClick={onOpenMemory}
        >
          <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
        </Row>
        <Row
          icon="tune"
          label="Personalidad de Nova"
          sub="Asistente enfocada en productividad"
        >
          <span className="text-[12px] font-semibold text-slate-400">Focus</span>
        </Row>
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
        <Row
          icon="notifications"
          label="Recordatorios de eventos"
          sub="Recibes un aviso 10, 30 y 60 min antes de cada evento"
        >
          <span className="material-symbols-outlined text-[16px] text-emerald-400">check_circle</span>
        </Row>
        <PushDiagnostic />
      </SectionCard>

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

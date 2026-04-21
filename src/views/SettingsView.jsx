import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getPushStatus, subscribeToPush } from '../lib/pushSubscription'

function SectionCard({ title, children }) {
  return (
    <section className="bg-white rounded-[20px] border border-slate-100 shadow-sm overflow-hidden">
      <p className="px-5 pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
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
        <p className={`text-[13.5px] font-semibold leading-tight ${danger ? 'text-red-500' : 'text-slate-800'}`}>
          {label}
        </p>
        {sub && <p className="text-[11.5px] text-slate-400 mt-0.5 leading-tight">{sub}</p>}
      </div>
      {children}
    </Tag>
  )
}

function PushDiagnostic() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  async function runTest() {
    setLoading(true)
    setStatus(null)
    try {
      const s = await getPushStatus()
      if (!s.supported) { setStatus({ ok: false, msg: 'Este dispositivo no soporta notificaciones push.' }); return }
      if (s.permission === 'denied') { setStatus({ ok: false, msg: 'Permiso de notificaciones bloqueado. Habilitalo en Ajustes del iPhone → Focus.' }); return }
      if (s.permission !== 'granted') { setStatus({ ok: false, msg: 'Permiso no concedido. Activá las notificaciones desde la pantalla principal.' }); return }

      if (s.subscribed) {
        // Ya hay suscripción — intentamos subirla al backend igual por si no estaba guardada
        const r = await subscribeToPush()
        if (r.ok && r.reason !== 'saved_locally_no_session') {
          setStatus({ ok: true, msg: '✅ Suscripción activa y guardada en el servidor. Las notificaciones deberían llegar.' })
        } else if (r.reason === 'saved_locally_no_session') {
          setStatus({ ok: false, msg: 'Suscripción creada pero no se pudo guardar — no hay sesión activa. Cerrá sesión y volvé a entrar.' })
        } else {
          setStatus({ ok: false, msg: `Error al guardar: ${r.reason} ${r.error || ''}` })
        }
      } else {
        const r = await subscribeToPush()
        if (r.ok && r.reason !== 'saved_locally_no_session') {
          setStatus({ ok: true, msg: '✅ Suscripción creada y guardada. Las notificaciones van a funcionar.' })
        } else if (r.reason === 'saved_locally_no_session') {
          setStatus({ ok: false, msg: 'Creada localmente pero sin sesión para guardar en el servidor. Cerrá sesión y volvé a entrar.' })
        } else if (r.reason === 'no_vapid_key') {
          setStatus({ ok: false, msg: 'Falta configurar VITE_VAPID_PUBLIC_KEY en Vercel.' })
        } else if (r.reason === 'subscribe_failed') {
          setStatus({ ok: false, msg: `iOS rechazó la suscripción: ${r.error}` })
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

  return (
    <div className="px-5 py-4 border-t border-slate-50 space-y-3">
      <button
        onClick={runTest}
        disabled={loading}
        className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-[13px] font-semibold disabled:opacity-50 active:scale-95 transition-transform"
      >
        {loading ? 'Verificando…' : 'Verificar notificaciones push'}
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

export default function SettingsView({ onOpenImport, onOpenMemory, onOpenNovaKnows }) {
  const { user, setAuthModal, signOut } = useAuth()

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 py-6 space-y-4 pb-32">

      {/* Título */}
      <div className="px-1 mb-2">
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Ajustes</h1>
      </div>

      {/* ── Perfil ──────────────────────────────────────────────────────── */}
      <SectionCard title="Tu perfil">
        {/* Cuenta */}
        <Row
          icon={user ? 'account_circle' : 'person_off'}
          label={user ? user.email : 'Modo invitado'}
          sub={user ? 'Sesión activa · datos en la nube' : 'Inicia sesión para sincronizar en todos tus dispositivos'}
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
          sub="Patrones que aprendió de tu uso — pico real, días fuertes, tipos rechazados"
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

      {/* ── Notificaciones ───────────────────────────────────────────────── */}
      <SectionCard title="Notificaciones">
        <Row
          icon="notifications"
          label="Recordatorios de eventos"
          sub="Recibís un aviso 10, 30 y 60 min antes de cada evento"
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

      {/* ── Cuenta ───────────────────────────────────────────────────────── */}
      <SectionCard title="Cuenta">
        {user ? (
          <Row
            icon="logout"
            label="Cerrar sesión"
            sub={user.email}
            onClick={signOut}
            danger
          />
        ) : (
          <Row
            icon="login"
            label="Iniciar sesión"
            sub="Sincroniza tus datos en todos tus dispositivos"
            onClick={() => setAuthModal(true)}
          />
        )}

      </SectionCard>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <p className="text-center text-[11px] text-slate-300 pt-2">
        Focus · Calendario con IA
      </p>
    </div>
  )
}

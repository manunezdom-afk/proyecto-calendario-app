import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth }        from '../context/AuthContext'
import { useUserProfile } from '../hooks/useUserProfile'

const CHRONOTYPES = [
  { id: 'morning',   emoji: '🌅', label: 'Mañana',  sub: '6–12 AM' },
  { id: 'afternoon', emoji: '☀️',  label: 'Tarde',   sub: '1–6 PM'  },
  { id: 'night',     emoji: '🌙', label: 'Noche',   sub: '7–11 PM' },
]

const ROLES = [
  { id: 'student',   icon: 'menu_book',  label: 'Estudiante'        },
  { id: 'worker',    icon: 'work',       label: 'Trabajo / Oficina' },
  { id: 'freelance', icon: 'laptop_mac', label: 'Freelance'         },
  { id: 'other',     icon: 'person',     label: 'Otro'              },
]

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

export default function SettingsView({ onOpenImport, onOpenMemory, onOpenNovaKnows }) {
  const { user, setAuthModal, signOut } = useAuth()
  const { profile, saveProfile }        = useUserProfile()

  const [chronotype, setChronotype] = useState(profile.chronotype)
  const [role, setRole]             = useState(profile.role)
  const [saved, setSaved]           = useState(false)

  function handleSave() {
    if (!chronotype || !role) return
    saveProfile({ chronotype, role })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const profileDirty =
    chronotype !== profile.chronotype || role !== profile.role

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

        {/* Cronotype */}
        <div className="px-5 py-4 border-t border-slate-50">
          <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-3">
            ¿Cuándo rindes mejor?
          </p>
          <div className="grid grid-cols-3 gap-2">
            {CHRONOTYPES.map(({ id, emoji, label, sub }) => {
              const sel = chronotype === id
              return (
                <button
                  key={id}
                  onClick={() => setChronotype(id)}
                  className={`flex flex-col items-center gap-1 py-3 px-2 rounded-2xl border-2 transition-all active:scale-95 text-center ${
                    sel
                      ? 'border-primary bg-primary text-white shadow-md shadow-primary/20'
                      : 'border-slate-100 bg-slate-50 text-slate-700 hover:border-primary/30'
                  }`}
                >
                  <span className="text-xl leading-none">{emoji}</span>
                  <span className="font-bold text-xs leading-tight">{label}</span>
                  <span className={`text-[10px] font-medium leading-tight ${sel ? 'text-white/70' : 'text-slate-400'}`}>
                    {sub}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Rol */}
        <div className="px-5 pb-4 border-t border-slate-50">
          <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-3 pt-4">
            Tu rol
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map(({ id, icon, label }) => {
              const sel = role === id
              return (
                <button
                  key={id}
                  onClick={() => setRole(id)}
                  className={`flex items-center gap-2.5 px-3.5 py-3 rounded-2xl border-2 transition-all active:scale-95 ${
                    sel
                      ? 'border-primary bg-primary text-white shadow-md shadow-primary/20'
                      : 'border-slate-100 bg-slate-50 text-slate-700 hover:border-primary/30'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[18px] flex-shrink-0 ${sel ? 'text-white' : 'text-primary'}`}
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    {icon}
                  </span>
                  <span className="font-semibold text-xs leading-tight text-left">{label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Guardar perfil */}
        {profileDirty && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-5 pb-5"
          >
            <button
              onClick={handleSave}
              className="w-full py-3 rounded-2xl bg-primary text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">
                {saved ? 'check_circle' : 'save'}
              </span>
              {saved ? '¡Guardado!' : 'Guardar cambios'}
            </button>
          </motion.div>
        )}
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

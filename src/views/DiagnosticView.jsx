import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// ── Muestra exactamente qué está llegando al runtime del cliente ────────────
// Útil para debuggear por qué "Supabase no configurado" aparece. No expone
// valores secretos completos — solo prefijos/sufijos para confirmar presencia.

function mask(value) {
  if (!value) return null
  const s = String(value)
  if (s.length < 14) return `${s.slice(0, 3)}…${s.slice(-2)}`
  return `${s.slice(0, 8)}…${s.slice(-6)} (${s.length} chars)`
}

function Row({ label, value, ok, hint }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-slate-100">
      <span
        className={`material-symbols-outlined text-[20px] mt-0.5 flex-shrink-0 ${
          ok ? 'text-emerald-500' : 'text-red-500'
        }`}
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {ok ? 'check_circle' : 'error'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold text-slate-900">{label}</p>
        <code className="block text-[11px] text-slate-600 mt-0.5 break-all font-mono">
          {value != null ? value : '— no configurado —'}
        </code>
        {hint && <p className="text-[11px] text-slate-400 mt-1 leading-snug">{hint}</p>}
      </div>
    </div>
  )
}

export default function DiagnosticView({ onBack }) {
  const { user, loading } = useAuth()
  const [test, setTest] = useState(null)
  const [testing, setTesting] = useState(false)

  const vapidPub = import.meta.env.VITE_VAPID_PUBLIC_KEY
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  const runTest = useCallback(async () => {
    setTesting(true)
    setTest(null)
    try {
      if (!supabase) {
        setTest({ ok: false, step: 'client', detail: 'supabase client is null (env vars missing)' })
        return
      }
      const { data, error } = await supabase.auth.getSession()
      if (error) {
        setTest({ ok: false, step: 'getSession', detail: error.message })
        return
      }
      setTest({
        ok: true,
        step: 'getSession',
        detail: data?.session ? `Usuario autenticado: ${data.session.user.email}` : 'Sin sesión activa (normal si no iniciaste sesión)',
      })
    } catch (err) {
      setTest({ ok: false, step: 'exception', detail: String(err) })
    } finally {
      setTesting(false)
    }
  }, [])

  useEffect(() => { runTest() }, [runTest])

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 py-6 space-y-4 pb-32">
      <div className="px-1">
        {onBack && (
          <button
            onClick={onBack}
            className="text-[13px] text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1 mb-3"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Volver
          </button>
        )}
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight font-headline">
          Diagnóstico
        </h1>
        <p className="text-[13px] text-slate-500 mt-1 leading-snug">
          Verificación del runtime. Útil para debuggear si algo no funciona.
        </p>
      </div>

      {/* ── Build-time env vars ───────────────────────────────────────── */}
      <section className="space-y-2.5">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-1">
          Variables del build
        </p>
        <Row
          label="VITE_SUPABASE_URL"
          value={supabaseUrl}
          ok={!!supabaseUrl}
          hint="Debería empezar con https:// y terminar en .supabase.co"
        />
        <Row
          label="VITE_SUPABASE_ANON_KEY"
          value={mask(supabaseKey)}
          ok={!!supabaseKey}
          hint="Si es muy corta (<40 chars), probablemente se cortó al copiar"
        />
        <Row
          label="VITE_VAPID_PUBLIC_KEY"
          value={mask(vapidPub)}
          ok={!!vapidPub}
          hint="Opcional — solo si quieres push notifications"
        />
      </section>

      {/* ── Runtime ───────────────────────────────────────────────────── */}
      <section className="space-y-2.5 pt-2">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-1">
          Cliente Supabase
        </p>
        <Row
          label="Cliente inicializado"
          value={supabase ? 'Sí — supabase client creado' : 'No — faltan env vars'}
          ok={!!supabase}
        />
        <Row
          label="Sesión de usuario"
          value={user ? `Logueado como ${user.email}` : (loading ? 'Cargando…' : 'Sin sesión')}
          ok={!!user || loading}
          hint={!user && !loading ? 'Normal si aún no iniciaste sesión' : null}
        />
        <Row
          label="Test de conexión"
          value={
            testing
              ? 'Probando…'
              : test
                ? `${test.step}: ${test.detail}`
                : '—'
          }
          ok={!!test?.ok || testing}
        />
        <button
          onClick={runTest}
          disabled={testing}
          className="w-full mt-2 py-2.5 rounded-xl border border-slate-200 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
        >
          Reintentar test
        </button>
      </section>

      {/* ── Network info ─────────────────────────────────────────────── */}
      <section className="space-y-2.5 pt-2">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-1">
          Entorno del navegador
        </p>
        <Row
          label="Host"
          value={typeof window !== 'undefined' ? window.location.host : '—'}
          ok={true}
        />
        <Row
          label="Online"
          value={typeof navigator !== 'undefined' ? (navigator.onLine ? 'Sí' : 'No — offline') : '—'}
          ok={typeof navigator !== 'undefined' ? navigator.onLine : true}
        />
        <Row
          label="Service Worker"
          value={
            typeof navigator !== 'undefined' && 'serviceWorker' in navigator
              ? 'Soportado'
              : 'No soportado'
          }
          ok={typeof navigator !== 'undefined' && 'serviceWorker' in navigator}
        />
        <Row
          label="Notification API"
          value={
            typeof Notification !== 'undefined'
              ? `Permission: ${Notification.permission}`
              : 'No soportado'
          }
          ok={typeof Notification !== 'undefined'}
        />
      </section>

      {/* ── Debug tips ───────────────────────────────────────────────── */}
      <section className="pt-3 space-y-2">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-1">
          Si algo dice "No configurado"
        </p>
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-900 leading-relaxed space-y-1.5">
          <p>1. Verifica que la env var esté en Vercel → Settings → Environment Variables (los 3 ambientes marcados).</p>
          <p>2. Redeploy SIN caché: Deployments → último → ⋯ → Redeploy → <b>desmarca "Use existing Build Cache"</b>.</p>
          <p>3. Hard refresh del navegador (Ctrl+Shift+R) o ventana incógnito.</p>
          <p>4. Si el valor se ve cortado aquí (ej. solo 20-30 chars), se truncó al copiar. Vuelve a pegarlo completo.</p>
        </div>
      </section>
    </div>
  )
}

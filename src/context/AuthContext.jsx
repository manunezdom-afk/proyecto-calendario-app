import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { dataService } from '../services/dataService'
import { setSignalsUserId, flushSignalsQueue } from '../services/signalsService'
import { fetchBehavior } from '../services/behaviorAnalysis'
import { flushPendingSubscription, subscribeToPush, getPushStatus } from '../lib/pushSubscription'

// withAuthTimeout — blindaje genérico para promesas de auth/pairing. Rechaza
// con Error(label) si la promesa no resuelve en `ms`. Lo usamos en getSession,
// fetch y verifyOtp para evitar que un stall de red deje la UI en "Generando
// QR seguro…" para siempre.
function withAuthTimeout(promise, ms, label = 'timeout') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms)
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [authModal, setAuthModal] = useState(false)

  useEffect(() => {
    if (!supabase) { setLoading(false); return }

    // Sincroniza colas que pueden haber quedado pendientes entre sesiones:
    // escrituras offline, señales, suscripción push y modelo de behavior.
    // Se llama tanto al SIGNED_IN de un login nuevo como al hidratar una
    // sesión ya existente (getSession). Antes sólo corría en SIGNED_IN,
    // así que al abrir la app con sesión persistida las cosas quedaban
    // en la cola hasta que el usuario interactuara con la red.
    async function syncOnSession(u, { freshLogin }) {
      try {
        if (freshLogin) {
          // Al login nuevo limpiamos las claves globales (sin userId) para
          // que cualquier caché residual de una sesión anterior no se
          // muestre como datos del usuario recién entrado.
          dataService.clearGlobalCache()
        }
        await dataService.flushQueue()
        await flushSignalsQueue()
        await fetchBehavior(u.id).catch(() => {})
        await flushPendingSubscription().catch(() => {})
        const s = await getPushStatus()
        if (s.supported && s.permission === 'granted' && !s.subscribed) {
          await subscribeToPush().catch(() => {})
        }
      } catch (err) {
        console.warn('[Focus] session sync falló:', err)
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const current = session?.user ?? null
      setUser(current)
      setSignalsUserId(current?.id ?? null)
      if (current) {
        fetchBehavior(current.id).catch(() => {})
        // Sesión ya existente al abrir la app: sincronizar colas.
        syncOnSession(current, { freshLogin: false })
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const newUser = session?.user ?? null
        setUser(newUser)
        setSignalsUserId(newUser?.id ?? null)
        if (event === 'SIGNED_IN' && newUser) {
          await syncOnSession(newUser, { freshLogin: true })
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // Sync cola offline al recuperar red
  useEffect(() => {
    const handleOnline = () => {
      if (user) dataService.flushQueue()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [user])

  const signInWithEmail = useCallback(async (email) => {
    if (!supabase) throw new Error('Supabase no configurado')
    // Flujo OTP-only: código numérico por email (largo según config Supabase). NO pasamos
    // emailRedirectTo para que Supabase no inyecte un magic-link en el
    // correo — así el usuario nunca sale de la app. La redirect de
    // cualquier link embebido usa el Site URL del proyecto (usefocus.me).
    const clean = String(email || '').trim().toLowerCase()
    const { error } = await supabase.auth.signInWithOtp({
      email: clean,
      options: { shouldCreateUser: true },
    })
    if (error) throw error
  }, [])

  const verifyOtp = useCallback(async (email, token) => {
    if (!supabase) throw new Error('Supabase no configurado')
    const cleanEmail = String(email || '').trim().toLowerCase()
    // 10 dígitos de margen: Supabase puede estar configurado a 6 u 8.
    // Truncar a 6 acá invalidaba códigos de 8 dígitos antes de enviarlos.
    const cleanToken = String(token || '').replace(/\D/g, '').slice(0, 10)
    // La validación de longitud vive en el UI (AuthModal). Acá solo pasamos
    // a Supabase el valor limpio — si viniera corto, Supabase retorna su
    // propio error de token inválido, que humanizeAuthError ya mapea.
    const { data, error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'email',
    })
    if (error) throw error
    return data?.user || null
  }, [])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
    setUser(null)
    // Limpiamos cualquier OTP pendiente: si quedó un code en sessionStorage
    // de una sesión anterior, al reabrir el login veríamos el paso 'code'
    // apuntando a un email que ya no corresponde. Limpiamos también el
    // cooldown por email para no heredarlo en el próximo login.
    try {
      sessionStorage.removeItem('focus_auth_pending')
      sessionStorage.removeItem('focus_auth_resend_until')
      sessionStorage.removeItem('focus_device_pairing')
    } catch {}
    // Borramos las claves globales (sin userId) de caché local. Los datos del
    // usuario que siguieron en estado React al salir ya no se persisten al
    // cierre y no pueden aparecer como "tareas pendientes" en el próximo login.
    dataService.clearGlobalCache()
  }, [])

  // ── Device pairing ─────────────────────────────────────────────────────────
  // El dispositivo ya logueado genera un pairing pre-aprobado y muestra un QR
  // con el user_code. El dispositivo nuevo escanea (o tipea) el code y lo
  // canjea por un token_hash que usa para abrir sesión. Sin emails.

  const startDevicePairing = useCallback(async () => {
    if (!supabase) {
      const err = new Error('supabase_not_configured')
      err.reason = 'supabase_not_configured'
      throw err
    }
    // getSession() puede tardar si la red está lenta — cap a 5s
    let session
    try {
      const { data } = await withAuthTimeout(supabase.auth.getSession(), 5000, 'session_timeout')
      session = data?.session
    } catch (err) {
      const e = new Error(err?.message || 'session_timeout')
      e.reason = /timeout/i.test(String(err?.message)) ? 'session_timeout' : 'session_error'
      throw e
    }
    if (!session?.access_token) {
      const err = new Error('no_session')
      err.reason = 'no_session'
      throw err
    }
    let r
    try {
      r = await withAuthTimeout(
        fetch('/api/auth/device/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          }),
        }),
        10000,
        'backend_timeout',
      )
    } catch (err) {
      const e = new Error(err?.message || 'backend_timeout')
      e.reason = /timeout/i.test(String(err?.message)) ? 'backend_timeout' : 'network_error'
      throw e
    }
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error(body?.error || 'device_start_failed')
      err.status = r.status
      err.reason = body?.error || 'backend_error'
      throw err
    }
    // Sanity check: el backend debe devolver user_code válido. Si no, dejamos
    // explícito que el payload está mal en vez de renderizar un QR vacío.
    if (typeof body?.user_code !== 'string' || body.user_code.length !== 8) {
      const err = new Error('invalid_user_code')
      err.reason = 'invalid_user_code'
      throw err
    }
    return body
  }, [])

  const claimDevicePairing = useCallback(async (userCode) => {
    let r
    try {
      r = await withAuthTimeout(
        fetch('/api/auth/device/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_code: userCode }),
        }),
        10000,
        'backend_timeout',
      )
    } catch (err) {
      const e = new Error(err?.message || 'backend_timeout')
      e.reason = /timeout/i.test(String(err?.message)) ? 'backend_timeout' : 'network_error'
      throw e
    }
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error(body?.error || 'device_claim_failed')
      err.status = r.status
      err.reason = body?.error || 'backend_error'
      err.body = body
      throw err
    }
    return body
  }, [])

  const exchangeDeviceToken = useCallback(async (tokenHash) => {
    if (!supabase) {
      const err = new Error('supabase_not_configured')
      err.reason = 'supabase_not_configured'
      throw err
    }
    try {
      const { data, error } = await withAuthTimeout(
        supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' }),
        10000,
        'verify_timeout',
      )
      if (error) {
        const e = new Error(error.message || 'verify_failed')
        e.reason = 'verify_failed'
        throw e
      }
      return data
    } catch (err) {
      if (err?.reason) throw err
      const e = new Error(err?.message || 'verify_timeout')
      e.reason = /timeout/i.test(String(err?.message)) ? 'verify_timeout' : 'verify_failed'
      throw e
    }
  }, [])

  return (
    <AuthContext.Provider value={{
      user, loading, authModal, setAuthModal,
      signInWithEmail, verifyOtp, signOut,
      startDevicePairing, claimDevicePairing, exchangeDeviceToken,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { dataService } from '../services/dataService'
import { setSignalsUserId, flushSignalsQueue } from '../services/signalsService'
import { fetchBehavior } from '../services/behaviorAnalysis'
import { flushPendingSubscription, subscribeToPush, getPushStatus } from '../lib/pushSubscription'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [authModal, setAuthModal] = useState(false)

  useEffect(() => {
    if (!supabase) { setLoading(false); return }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const current = session?.user ?? null
      setUser(current)
      setSignalsUserId(current?.id ?? null)
      if (current) fetchBehavior(current.id).catch(() => {})
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const newUser = session?.user ?? null
        setUser(newUser)
        setSignalsUserId(newUser?.id ?? null)
        if (event === 'SIGNED_IN' && newUser) {
          // Limpiamos las claves globales (sin userId) para que cualquier
          // caché residual del dispositivo — p. ej. tareas o eventos de una
          // sesión anterior — no se muestre como datos del nuevo usuario.
          // La fuente de verdad pasa a ser únicamente Supabase.
          dataService.clearGlobalCache()
          await dataService.flushQueue()
          await flushSignalsQueue()
          await fetchBehavior(newUser.id).catch(() => {})
          // Subir suscripción push pendiente (guardada localmente antes de login)
          await flushPendingSubscription().catch(() => {})
          // Si el permiso está granted pero no hay suscripción en el browser, crear una nueva
          getPushStatus().then(async s => {
            if (s.supported && s.permission === 'granted' && !s.subscribed) {
              await subscribeToPush().catch(() => {})
            }
          }).catch(() => {})
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
    // TEMP LOG: confirmar qué llega a Supabase. Remover tras validar.
    // eslint-disable-next-line no-console
    console.log('[OTP supabase]', { cleanEmail, cleanToken, len: cleanToken.length })
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
  // Vía alternativa al OTP: el dispositivo nuevo pide un code, otro dispositivo
  // ya autenticado lo aprueba, y el nuevo canjea un token_hash por una sesión
  // real de Supabase (sin enviar email).

  const startDevicePairing = useCallback(async () => {
    const r = await fetch('/api/auth/device/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      }),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error(body?.error || 'device_start_failed')
      err.status = r.status
      throw err
    }
    return body
  }, [])

  const pollDevicePairing = useCallback(async (deviceCode) => {
    const r = await fetch('/api/auth/device/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error(body?.error || 'device_poll_failed')
      err.status = r.status
      throw err
    }
    return body
  }, [])

  const approveDevicePairing = useCallback(async (userCode) => {
    if (!supabase) throw new Error('Supabase no configurado')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('no_session')
    const r = await fetch('/api/auth/device/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ user_code: userCode }),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error(body?.error || 'device_approve_failed')
      err.status = r.status
      err.body = body
      throw err
    }
    return body
  }, [])

  const exchangeDeviceToken = useCallback(async (tokenHash) => {
    if (!supabase) throw new Error('Supabase no configurado')
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    })
    if (error) throw error
    return data
  }, [])

  return (
    <AuthContext.Provider value={{
      user, loading, authModal, setAuthModal,
      signInWithEmail, verifyOtp, signOut,
      startDevicePairing, pollDevicePairing, approveDevicePairing, exchangeDeviceToken,
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

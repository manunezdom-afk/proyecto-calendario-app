import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { dataService } from '../services/dataService'
import { setSignalsUserId, flushSignalsQueue } from '../services/signalsService'
import { fetchBehavior } from '../services/behaviorAnalysis'
import { flushPendingSubscription, subscribeToPush, getPushStatus } from '../lib/pushSubscription'

const AuthContext = createContext(null)

// En iPhone PWA (standalone, anclada al inicio) un cold start reproduce una
// carrera: el webview arranca, Supabase intenta refrescar el access token y
// si la red todavía no está lista o hay un race con el reload del SW, el SDK
// emite SIGNED_OUT con session=null aunque el refresh_token siga vivo en
// storage. Tratar ese evento como un logout real (setUser(null)) vacía el
// estado de eventos/tareas y gatilla el refetch con sesión stale → RLS
// devuelve [] y sobrescribimos la caché local con vacío. Resultado que vio
// el usuario: "me cerró sesión sola y al volver a entrar no estaban mis
// eventos". Para evitarlo distinguimos el logout explícito (flag abajo) de
// los SIGNED_OUT espurios y, si no fue intencional, reintentamos hidratar
// desde storage antes de aceptar el null.
const STORAGE_KEY = 'focus-auth'

function hasStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    return !!(parsed?.refresh_token || parsed?.access_token || parsed?.currentSession)
  } catch {
    return false
  }
}

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [authModal, setAuthModal] = useState(false)
  // Marcamos cuando el logout viene del usuario (click en "cerrar sesión").
  // Cualquier SIGNED_OUT que llegue sin este flag lo tratamos como ruido del
  // SDK (refresh fallido, carrera con el SW en iOS) y no vaciamos el estado.
  const intentionalSignOutRef = useRef(false)

  useEffect(() => {
    if (!supabase) { setLoading(false); return }

    let cancelled = false

    const hydrate = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        const current = session?.user ?? null
        // Si getSession vuelve null pero todavía hay tokens en storage, muy
        // probablemente el refresh está en curso o falló por red. No
        // marcamos logout: esperamos a que onAuthStateChange emita SIGNED_IN
        // o TOKEN_REFRESHED con la sesión ya hidratada.
        if (!current && hasStoredSession()) {
          setLoading(false)
          return
        }
        setUser(current)
        setSignalsUserId(current?.id ?? null)
        if (current) fetchBehavior(current.id).catch(() => {})
      } catch {
        // Ante cualquier error transitorio no forzamos logout. La próxima
        // señal de onAuthStateChange decidirá el estado real.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    hydrate()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const newUser = session?.user ?? null

        // SIGNED_OUT no intencional con tokens aún en storage: es el race de
        // iOS PWA. Ignoramos el null y pedimos a Supabase que reintente
        // hidratar — si la sesión está viva, el siguiente evento la trae.
        if (event === 'SIGNED_OUT' && !intentionalSignOutRef.current && hasStoredSession()) {
          console.warn('[Focus] ⚠️ SIGNED_OUT espurio ignorado (token todavía en storage)')
          supabase.auth.getSession().catch(() => {})
          return
        }

        // SIGNED_IN / TOKEN_REFRESHED / INITIAL_SESSION con null y storage
        // aún presente: mismo caso, esperamos la próxima emisión.
        if (!newUser && event !== 'SIGNED_OUT' && hasStoredSession()) return

        setUser(newUser)
        setSignalsUserId(newUser?.id ?? null)

        if (event === 'SIGNED_OUT') intentionalSignOutRef.current = false

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

    // iOS PWA: cuando la app vuelve del background (visibilitychange) o el
    // webview se restaura desde bfcache (pageshow), forzamos rehidratación.
    // Sin esto, Supabase puede quedar con una sesión caducada en memoria
    // aunque el refresh_token en storage siga vivo.
    const reHydrate = () => {
      if (document.hidden) return
      supabase.auth.getSession().catch(() => {})
    }
    document.addEventListener('visibilitychange', reHydrate)
    window.addEventListener('pageshow', reHydrate)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', reHydrate)
      window.removeEventListener('pageshow', reHydrate)
    }
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
    // Marcamos el logout intencional ANTES del signOut de Supabase. El
    // listener de onAuthStateChange usa este flag para no confundir un
    // cierre real con los SIGNED_OUT espurios que dispara el SDK en iOS
    // PWA cuando falla un refresh en cold start.
    intentionalSignOutRef.current = true
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
    if (!supabase) throw new Error('Supabase no configurado')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('no_session')
    const r = await fetch('/api/auth/device/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
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

  const claimDevicePairing = useCallback(async (userCode) => {
    const r = await fetch('/api/auth/device/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_code: userCode }),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error(body?.error || 'device_claim_failed')
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

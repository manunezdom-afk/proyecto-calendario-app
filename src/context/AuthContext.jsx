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
          await dataService.migrateToCloud(newUser.id)
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
    // Flujo OTP-only: código de 6 dígitos por email. NO pasamos
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
    const cleanToken = String(token || '').replace(/\D/g, '').slice(0, 6)
    if (cleanToken.length !== 6) throw new Error('El código debe tener 6 dígitos')
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
    // apuntando a un email que ya no corresponde.
    try { sessionStorage.removeItem('focus_auth_pending') } catch {}
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, authModal, setAuthModal, signInWithEmail, verifyOtp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { dataService } from '../services/dataService'
import { setSignalsUserId, flushSignalsQueue } from '../services/signalsService'
import { fetchBehavior } from '../services/behaviorAnalysis'

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
    // Pedimos OTP + magic link. En mobile (sobre todo iOS PWA) el usuario
    // pega el código numérico; en desktop puede usar el link del email.
    // La longitud del código depende del setting OTP Length del proyecto
    // Supabase (Project Settings → Auth → OTP Length, 6-10 dígitos).
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: true,
      },
    })
    if (error) throw error
  }, [])

  const verifyOtp = useCallback(async (email, token) => {
    if (!supabase) throw new Error('Supabase no configurado')
    // Solo filtramos no-dígitos y limitamos al máximo soportado por Supabase
    // (10). Antes truncábamos a 6 de forma dura, lo cual rompía cuando el
    // proyecto estaba configurado con OTPs de 7-10 dígitos.
    const clean = String(token || '').replace(/\D/g, '').slice(0, 10)
    if (clean.length < 6) throw new Error('El código debe tener al menos 6 dígitos')
    const { data, error } = await supabase.auth.verifyOtp({
      email, token: clean, type: 'email',
    })
    if (error) throw error
    return data?.user || null
  }, [])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
    setUser(null)
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

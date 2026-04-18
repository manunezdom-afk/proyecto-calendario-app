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
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, authModal, setAuthModal, signInWithEmail, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}

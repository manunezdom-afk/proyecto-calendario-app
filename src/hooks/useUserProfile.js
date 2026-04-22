import { useState, useEffect } from 'react'
import { dataService } from '../services/dataService'
import { useAuth } from '../context/AuthContext'

function detectBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const DEFAULT_PROFILE = {
  chronotype:   null,
  role:         null,
  setupDone:    false,
  snoozedUntil: null,
  timezone:     detectBrowserTimezone(),
}

export function useUserProfile() {
  const { user } = useAuth()

  const [profile, setProfile] = useState(() => ({
    ...DEFAULT_PROFILE,
    ...(dataService.getCachedProfile(null) ?? {}),
  }))

  useEffect(() => {
    if (!user) return
    dataService.fetchProfile(user.id)
      .then(cloudProfile => {
        const browserTz = detectBrowserTimezone()
        const merged = { ...DEFAULT_PROFILE, ...(cloudProfile || {}) }
        // Si el perfil en la nube no tiene timezone o está default, actualizarlo con el del navegador.
        if (!merged.timezone || merged.timezone === 'UTC') {
          merged.timezone = browserTz
          if (browserTz && browserTz !== 'UTC') {
            dataService.upsertProfile(merged, user.id).catch(() => {})
          }
        }
        setProfile(merged)
        dataService.setCachedProfile(merged)
      })
      .catch(err => console.warn('[Focus] ⚠️ No se pudo cargar perfil de Supabase', err))
  }, [user?.id])

  useEffect(() => {
    dataService.setCachedProfile(profile)
  }, [profile])

  function saveProfile(answers) {
    const next = { ...profile, ...answers, setupDone: true, snoozedUntil: null }
    setProfile(next)
    if (user) dataService.upsertProfile(next, user.id).catch(console.warn)
  }

  function snoozeSetup() {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000
    const next = { ...profile, snoozedUntil: tomorrow }
    setProfile(next)
    if (user) dataService.upsertProfile(next, user.id).catch(console.warn)
  }

  const showSetup =
    !profile.setupDone &&
    (!profile.snoozedUntil || Date.now() > profile.snoozedUntil)

  return { profile, saveProfile, snoozeSetup, showSetup }
}

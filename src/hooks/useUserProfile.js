import { useState, useEffect } from 'react'
import { dataService } from '../services/dataService'
import { useAuth } from '../context/AuthContext'

const DEFAULT_PROFILE = {
  chronotype:   null,
  role:         null,
  peakStart:    9,
  peakEnd:      11.5,
  setupDone:    false,
  snoozedUntil: null,
}

const CHRONOTYPE_PEAKS = {
  morning:   { peakStart: 7,  peakEnd: 11 },
  afternoon: { peakStart: 13, peakEnd: 17 },
  night:     { peakStart: 19, peakEnd: 23 },
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
        if (cloudProfile) {
          const merged = { ...DEFAULT_PROFILE, ...cloudProfile }
          setProfile(merged)
          dataService.setCachedProfile(merged)
        }
      })
      .catch(err => console.warn('[Focus] ⚠️ No se pudo cargar perfil de Supabase', err))
  }, [user?.id])

  useEffect(() => {
    dataService.setCachedProfile(profile)
  }, [profile])

  function saveProfile(answers) {
    const peaks = CHRONOTYPE_PEAKS[answers.chronotype] ?? {}
    const next = { ...profile, ...answers, ...peaks, setupDone: true, snoozedUntil: null }
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

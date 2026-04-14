/**
 * useUserProfile
 *
 * Persiste el perfil del usuario en localStorage ('focus_user_profile').
 * Controla la personalización del pico de energía y las sugerencias IA.
 */

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'focus_user_profile'

const DEFAULT_PROFILE = {
  chronotype:   null,       // 'morning' | 'afternoon' | 'night'
  role:         null,       // 'student' | 'worker' | 'freelance' | 'other'
  peakStart:    9,          // hora de inicio del pico (0-23)
  peakEnd:      11.5,       // hora de fin del pico (float, 11.5 = 11:30)
  setupDone:    false,      // si ya completó el onboarding
  snoozedUntil: null,       // timestamp: no mostrar setup hasta esta fecha
}

// Cronotipo → ventana de pico de energía
const CHRONOTYPE_PEAKS = {
  morning:   { peakStart: 7,  peakEnd: 11   },
  afternoon: { peakStart: 13, peakEnd: 17   },
  night:     { peakStart: 19, peakEnd: 23   },
}

export function useUserProfile() {
  const [profile, setProfile] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return { ...DEFAULT_PROFILE, ...JSON.parse(stored) }
    } catch {}
    return { ...DEFAULT_PROFILE }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
    } catch {}
  }, [profile])

  /**
   * Guarda selecciones del onboarding y calcula el pico.
   * @param {{ chronotype: string, role: string }} answers
   */
  function saveProfile(answers) {
    const peaks = CHRONOTYPE_PEAKS[answers.chronotype] ?? {}
    setProfile((prev) => ({
      ...prev,
      ...answers,
      ...peaks,
      setupDone: true,
      snoozedUntil: null,
    }))
  }

  /** Pospone el setup card por 24 horas */
  function snoozeSetup() {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000
    setProfile((prev) => ({ ...prev, snoozedUntil: tomorrow }))
  }

  // ¿Debe mostrarse el setup card?
  const showSetup =
    !profile.setupDone &&
    (!profile.snoozedUntil || Date.now() > profile.snoozedUntil)

  return { profile, saveProfile, snoozeSetup, showSetup }
}

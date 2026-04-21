import { useEffect, useState } from 'react'
import { canInstall, onInstallAvailable, isStandalone } from '../lib/pwa'

const INSTALL_DISMISSED_KEY = 'focus_install_dismissed'
const SESSION_COUNT_KEY = 'focus_session_count'
const INSTALL_MIN_SESSIONS = 3

function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream
}

function readSessionCount() {
  try {
    const n = parseInt(localStorage.getItem(SESSION_COUNT_KEY) || '0', 10)
    return Number.isFinite(n) ? n : 0
  } catch { return 0 }
}

/**
 * useFirstRunSequence
 * Reglas:
 *  - El install card NO se muestra en la 1ra sesión. Mínimo 3 sesiones (=usos/día distintos).
 *    Razón: dejar que la app demuestre valor antes de pedir algo.
 *  - Permission de notificaciones ya NO está en el gate: se pide contextualmente
 *    cuando el usuario crea un evento con recordatorio (ver useNotifications).
 *  - Tour obsoleto: reemplazado por NovaHint contextuales. No hay modal de slides.
 */
export function useFirstRunSequence() {
  const [installReady, setInstallReady] = useState(canInstall())
  const [installDismissed, setInstallDismissed] = useState(() => {
    try { return localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true' } catch { return false }
  })
  const [sessionCount, setSessionCount] = useState(readSessionCount)

  useEffect(() => onInstallAvailable(setInstallReady), [])

  useEffect(() => {
    // Contar una sola sesión por día (primera visita del día).
    try {
      const today = new Date().toISOString().slice(0, 10)
      const lastKey = 'focus_last_session_day'
      const last = localStorage.getItem(lastKey)
      if (last !== today) {
        const next = readSessionCount() + 1
        localStorage.setItem(SESSION_COUNT_KEY, String(next))
        localStorage.setItem(lastKey, today)
        setSessionCount(next)
      }
    } catch {}
  }, [])

  const ios = isIOS()
  const standalone = isStandalone()

  const reachedThreshold = sessionCount >= INSTALL_MIN_SESSIONS
  const canShowInstall =
    !standalone &&
    !installDismissed &&
    reachedThreshold &&
    (installReady || ios)

  function dismissInstall() {
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, 'true') } catch {}
    setInstallDismissed(true)
  }

  return {
    step: canShowInstall ? 'install' : null,
    dismissInstall,
    ios,
    standalone,
    sessionCount,
  }
}

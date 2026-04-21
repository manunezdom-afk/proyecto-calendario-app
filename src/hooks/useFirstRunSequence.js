import { useEffect, useState } from 'react'
import { canInstall, onInstallAvailable, isStandalone } from '../lib/pwa'

const INSTALL_DISMISSED_KEY = 'focus_install_dismissed'
const TOUR_KEY = 'focus_tour_completed'

function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream
}

// Secuencia de gates: solo uno visible a la vez.
// Orden: install → permission → tour.
// En iOS no-standalone, permission queda bloqueada hasta que install se resuelva
// (el prompt nativo de push no funciona en Safari sin PWA instalada).
export function useFirstRunSequence({ permissionState, permissionDismissed }) {
  const [installReady, setInstallReady] = useState(canInstall())
  const [installDismissed, setInstallDismissed] = useState(() => {
    try { return localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true' } catch { return false }
  })
  const [tourDone, setTourDone] = useState(() => {
    try { return localStorage.getItem(TOUR_KEY) === '1' } catch { return false }
  })

  useEffect(() => onInstallAvailable(setInstallReady), [])

  const ios = isIOS()
  const standalone = isStandalone()

  const canShowInstall = !standalone && !installDismissed && (installReady || ios)
  const canShowPermission =
    !canShowInstall &&
    permissionState === 'default' &&
    !permissionDismissed &&
    !(ios && !standalone)
  const canShowTour = !canShowInstall && !canShowPermission && !tourDone

  const step = canShowInstall
    ? 'install'
    : canShowPermission
      ? 'permission'
      : canShowTour
        ? 'tour'
        : null

  function dismissInstall() {
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, 'true') } catch {}
    setInstallDismissed(true)
  }
  function completeTour() {
    try { localStorage.setItem(TOUR_KEY, '1') } catch {}
    setTourDone(true)
  }

  return { step, dismissInstall, completeTour, ios, standalone }
}

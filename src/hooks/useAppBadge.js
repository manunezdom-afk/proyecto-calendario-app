import { useEffect } from 'react'
import { resolveEventDate } from '../utils/resolveEventDate'
import { eventStatusAtNow } from '../utils/eventDuration'

// useAppBadge
//
// Mantiene el badge del icono de la app (PWA instalada) sincronizado con lo
// que queda por atender hoy: eventos cuya hora aún no pasó + tareas
// category='hoy' no completadas. Es la señal visible cuando la app está
// cerrada — refuerza que Focus te espera sin tener que abrirla para saberlo.
//
// Soporte: iOS 16.4+ en PWAs instaladas, Chrome/Edge en desktop, Safari
// desktop reciente. Donde la API no existe, los try/catch dejan todo en
// silencio sin romper nada.
//
// Uso desde App.jsx:
//   useAppBadge(events, tasks, Boolean(user))

export function useAppBadge(events = [], tasks = [], signedIn = true) {
  useEffect(() => {
    // Sin sesión el badge se limpia: no queremos que un usuario que cerró
    // sesión siga viendo "3" colgado del icono en otro dispositivo.
    if (!signedIn) {
      clear()
      return
    }

    const now = new Date()
    const todayISO = resolveEventDate({}) // resuelve "hoy" en local

    let pendingEvents = 0
    for (const ev of events || []) {
      if (!ev) continue
      if (resolveEventDate(ev) !== todayISO) continue
      const status = eventStatusAtNow(ev, now)
      // 'future' y 'active' cuentan; 'past' y 'undated' no mueven el badge.
      if (status === 'future' || status === 'active') pendingEvents += 1
    }

    let pendingTasks = 0
    for (const t of tasks || []) {
      if (!t) continue
      if (t.done) continue
      if (t.category !== 'hoy') continue
      pendingTasks += 1
    }

    const count = pendingEvents + pendingTasks
    set(count)
  }, [events, tasks, signedIn])

  // Limpieza al desmontar — típico en el path de logout + unmount de App.
  useEffect(() => {
    return () => { clear() }
  }, [])
}

function set(count) {
  if (typeof navigator === 'undefined') return
  try {
    if (count > 0 && typeof navigator.setAppBadge === 'function') {
      navigator.setAppBadge(count).catch(() => {})
    } else if (typeof navigator.clearAppBadge === 'function') {
      navigator.clearAppBadge().catch(() => {})
    }
  } catch {
    // Silent: API experimental en algunos browsers, no queremos romper
    // el render por un setAppBadge que falle.
  }
}

function clear() {
  if (typeof navigator === 'undefined') return
  try {
    if (typeof navigator.clearAppBadge === 'function') {
      navigator.clearAppBadge().catch(() => {})
    }
  } catch {}
}

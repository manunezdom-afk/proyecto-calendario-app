import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { NOVA_PERSONALITY_IDS, DEFAULT_NOVA_PERSONALITY } from '../utils/novaPersonality'

// useNovaPersonalitySync
//
// Keep el `novaPersonality` de useAppPreferences (localStorage) sincronizado
// con la columna `user_profiles.nova_personality` del backend. Hasta ahora
// la personalidad vivía sólo por dispositivo; el cron no podía verla para
// adaptar el tono de las push notifications y cambiar de dispositivo
// significaba re-elegirla.
//
// Este hook se monta UNA vez en App.jsx con el usuario actual. Las lecturas
// del valor las sigue haciendo useAppPreferences desde localStorage — este
// hook sólo asegura que (a) al iniciar sesión el local refleje lo guardado
// en backend, y (b) al cambiarlo desde ajustes, el backend se actualiza.

const STORAGE_KEY = 'focus_app_prefs_v1'

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_NOVA_PERSONALITY
    const parsed = JSON.parse(raw)
    const p = parsed?.novaPersonality
    return NOVA_PERSONALITY_IDS.includes(p) ? p : DEFAULT_NOVA_PERSONALITY
  } catch {
    return DEFAULT_NOVA_PERSONALITY
  }
}

function writeLocal(value) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const base = raw ? JSON.parse(raw) : {}
    if (base.novaPersonality === value) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, novaPersonality: value }))
    // Empuja un evento para que useAppPreferences en la misma pestaña
    // re-lea el valor (el StorageEvent nativo sólo dispara entre pestañas
    // distintas del mismo origen).
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
  } catch {}
}

export function useNovaPersonalitySync(user) {
  const lastSyncedRef = useRef(null)

  // (a) Hidratación: al cambiar el user (login), traemos el valor del
  // backend. Si difiere del local, backend manda.
  useEffect(() => {
    if (!user?.id || !supabase) return
    let cancelled = false

    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('nova_personality')
          .eq('id', user.id)
          .maybeSingle()
        if (cancelled || error) return
        const backend = data?.nova_personality
        if (!backend || !NOVA_PERSONALITY_IDS.includes(backend)) return
        lastSyncedRef.current = backend
        const local = readLocal()
        if (local !== backend) writeLocal(backend)
      } catch {
        // Silencioso: si el backend no responde, dejamos el local como está.
      }
    })()

    return () => { cancelled = true }
  }, [user?.id])

  // (b) Escritura al backend cuando el local cambia. Escuchamos el evento
  // de storage (que writeLocal emite en la misma pestaña y el navegador
  // emite automáticamente en otras). Debounce 400 ms — cambiar varias
  // veces rápido sólo genera un upsert.
  useEffect(() => {
    if (!user?.id || !supabase) return
    let timer = null

    async function flushToBackend() {
      const current = readLocal()
      if (current === lastSyncedRef.current) return
      try {
        const { error } = await supabase
          .from('user_profiles')
          .upsert(
            { id: user.id, nova_personality: current },
            { onConflict: 'id' },
          )
        if (!error) lastSyncedRef.current = current
      } catch {
        // Silencioso. El próximo cambio o la próxima sesión reintenta.
      }
    }

    function onStorage(e) {
      if (e?.key && e.key !== STORAGE_KEY) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(flushToBackend, 400)
    }

    window.addEventListener('storage', onStorage)
    // Barrido inicial por si el usuario cambió la personalidad ANTES de
    // que este hook montara (pre-login desde la pantalla de ajustes con
    // sesión persistida).
    onStorage({})

    return () => {
      window.removeEventListener('storage', onStorage)
      if (timer) clearTimeout(timer)
    }
  }, [user?.id])
}

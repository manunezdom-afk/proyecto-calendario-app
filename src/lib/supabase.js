import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('[Focus] Supabase env vars missing — running in offline/demo mode.')
}

// Cliente único para toda la app. Config explícita:
// - storageKey propio: evita colisión con otras instancias del SDK y los
//   warnings de Navigator LockManager al competir por la misma llave en
//   varias pestañas.
// - autoRefreshToken + persistSession: la sesión sobrevive a recargas sin
//   intervención del usuario.
// - detectSessionInUrl: necesario para el fallback de magic-link si alguna
//   vez se activa desde el dashboard.
// - realtime eventsPerSecond bajado a 5: los refetches que dispara cada
//   cambio de tabla (useEvents/useTasks) no saturan al canal.
export const supabase = url && key
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'focus-auth',
      },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null

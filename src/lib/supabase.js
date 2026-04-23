// Cliente de Supabase cargado con dynamic import para que el SDK
// (~750 KB de código fuente: auth-js + postgrest-js + realtime-js +
// storage-js + phoenix) salga del bundle eager y baje en paralelo al
// primer paint. Críticamente importante en iPhone PWA standalone: el
// parse de JS en móvil va a ~1 MB/s, y meter todo Supabase en el bundle
// principal bloqueaba el render inicial por cientos de ms.
//
// Consumidores siguen haciendo `import { supabase } from '../lib/supabase'`.
// Gracias a los live-bindings de ES modules, la reasignación interna
// propaga el cliente real una vez resuelto el import dinámico.
// Los callers que necesitan garantías (AuthContext en su mount inicial)
// esperan `supabaseReady` antes de tocar `supabase.auth.*`.

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('[Focus] Supabase env vars missing — running in offline/demo mode.')
}

export let supabase = null

export const supabaseReady = (async () => {
  if (!url || !key) return null
  try {
    const { createClient } = await import('@supabase/supabase-js')
    // Config explícita:
    // - storageKey propio: evita colisiones con otras instancias del SDK y los
    //   warnings de Navigator LockManager al competir por la misma llave.
    // - autoRefreshToken + persistSession: la sesión sobrevive a recargas.
    // - detectSessionInUrl: fallback para magic-link si se activa desde el dashboard.
    // - realtime eventsPerSecond=5: los refetches que dispara cada cambio
    //   de tabla (useEvents/useTasks) no saturan el canal.
    supabase = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'focus-auth',
      },
      realtime: { params: { eventsPerSecond: 5 } },
    })
    return supabase
  } catch (err) {
    // CRÍTICO: si el dynamic import falla (SW con caché corrupta, red
    // interrumpida, chunk missing tras un deploy), el promise NO debe
    // rechazar — si rechazara, los consumidores (AuthContext en especial)
    // que hacen `await supabaseReady` sin .catch quedarían colgados y
    // `setLoading(false)` nunca se llamaría. La app se queda eternamente
    // en el splash. Resolvemos null → la app entra en "modo offline/demo".
    // eslint-disable-next-line no-console
    console.error('[Focus] Supabase dynamic import failed:', err)
    return null
  }
})()

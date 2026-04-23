// Service Worker de Focus
// Estrategia de caché (ajustada tras medir cold start en iPhone con red lenta):
//
//   1. Documento HTML / navegación  → STALE-WHILE-REVALIDATE.
//      Antes era network-first: en iPhone PWA, con red 4G variable, el usuario
//      veía pantalla negra hasta 1200 ms esperando el HTML. Ahora servimos el
//      shell cacheado al instante y refrescamos en background. La próxima
//      navegación ya trae el HTML nuevo. Si además hubo un deploy (assets con
//      hash distinto), la app detecta update del SW y recarga una vez controlled.
//      Primer install (sin cache): caemos a network con timeout amplio (3s).
//
//   2. Assets hasheados /assets/*   → CACHE-FIRST (inmutables por hash).
//      Vite emite archivos con hash en el nombre. Cachearlos agresivamente
//      es seguro: un cambio de código => nombre de archivo nuevo.
//
//   3. Iconos, fuentes, manifest    → STALE-WHILE-REVALIDATE.
//
//   4. /api/*                       → siempre red, no se cachea.
//
// Resultado: cold start en PWA instalada ≈ 0 ms de espera de red para el HTML;
// el usuario ve el bundle (ya cacheado) parseando inmediatamente.

const VERSION = 'v18'
const SHELL_CACHE = `focus-shell-${VERSION}`
const ASSETS_CACHE = `focus-assets-${VERSION}`
const CURRENT_CACHES = [SHELL_CACHE, ASSETS_CACHE]

const OFFLINE_FALLBACK = '/index.html'
const PRECACHE_URLS = [OFFLINE_FALLBACK, '/manifest.json', '/icons/icon.svg']

// Solo se usa cuando NO hay cache (primer install). En modo SWR la red
// refresca en background sin bloquear al usuario, así que no es crítico.
const NAV_NETWORK_TIMEOUT_MS = 3000
// Timeout por URL del precache. Evita que un fetch colgado en iPhone deje
// el install del SW en loop — si una URL tarda, la saltamos y continuamos.
const PRECACHE_URL_TIMEOUT_MS = 4000

// ── Install ────────────────────────────────────────────────────────────────
// cache: 'reload' fuerza al browser a bypassear su HTTP cache y pedir la
// versión fresca desde el origen. Clave cuando se publica una nueva build:
// evita que el SW precache un index.html viejo servido por el disk cache.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          const controller = new AbortController()
          const t = setTimeout(() => controller.abort(), PRECACHE_URL_TIMEOUT_MS)
          try {
            const res = await fetch(url, { cache: 'reload', signal: controller.signal })
            if (res && res.ok) await cache.put(url, res.clone())
          } catch {
            // seguimos: si una URL falla o demora, no bloqueamos la
            // instalación. En iPhone con red lenta esto evitaba cold starts
            // con el SW atascado en install.
          } finally {
            clearTimeout(t)
          }
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

// ── Activate ───────────────────────────────────────────────────────────────
// Borramos cualquier caché de versión anterior para que no sobrevivan assets
// obsoletos. clients.claim() hace que el SW nuevo controle pestañas existentes
// desde este mismo instante (la app escucha controllerchange y recarga una vez).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => !CURRENT_CACHES.includes(k))
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
      const clients = await self.clients.matchAll({ type: 'window' })
      clients.forEach((client) =>
        client.postMessage({ type: 'SW_ACTIVATED', version: VERSION }),
      )
    })(),
  )
})

// ── Estrategias ────────────────────────────────────────────────────────────

// Stale-while-revalidate para navegación: servimos el shell cacheado al
// instante (sin esperar red) y en paralelo refrescamos la copia del cache
// para la próxima visita. Si el HTML trae un hash de assets distinto (deploy
// nuevo), el SW detecta el update por su lado y App.jsx recarga una vez
// cuando el controlador cambie. Resultado: cold start percibido ≈ 0 ms.
async function staleWhileRevalidateDocument(request) {
  const cache = await caches.open(SHELL_CACHE)
  const cached =
    (await cache.match(request)) || (await cache.match(OFFLINE_FALLBACK))

  const networkFetch = (async () => {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), NAV_NETWORK_TIMEOUT_MS)
    try {
      const res = await fetch(request, {
        signal: controller.signal,
        cache: 'no-store',
      })
      clearTimeout(t)
      if (res && res.ok) {
        cache.put(OFFLINE_FALLBACK, res.clone()).catch(() => {})
      }
      return res
    } catch {
      clearTimeout(t)
      return null
    }
  })()

  // Si hay cache, servimos YA. La red corre en background y se guarda para
  // la próxima navegación. Si no hay cache (primer install), esperamos red
  // con el timeout amplio y servimos lo que llegue, o un fallback mínimo.
  if (cached) {
    networkFetch.catch(() => {})
    return cached
  }

  const fresh = await networkFetch
  if (fresh) return fresh
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Focus</title>' +
    '<body style="background:#0a0a0f;color:#fff;font-family:system-ui;padding:24px">' +
    '<h1>Sin conexión</h1><p>No se pudo cargar Focus. Verifica tu red y vuelve a abrir.</p>' +
    '<button onclick="location.reload()" style="margin-top:12px;padding:10px 20px;border-radius:999px;' +
    'background:#7c6bff;color:#fff;border:0;font-weight:600">Reintentar</button></body>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

async function cacheFirstImmutable(request) {
  const cache = await caches.open(ASSETS_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const res = await fetch(request)
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {})
    return res
  } catch {
    return cached || Response.error()
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSETS_CACHE)
  const cached = await cache.match(request)
  const networkFetch = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone()).catch(() => {})
      return res
    })
    .catch(() => cached)
  return cached || networkFetch
}

// ── Fetch router ───────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // 1. Navegación → stale-while-revalidate (shell cacheado al instante +
  //    refresh en background). En primer install sin cache, cae a red con
  //    timeout amplio. Ver la función para el razonamiento completo.
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidateDocument(request))
    return
  }

  // 2. Assets hasheados de Vite → cache-first inmutable.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstImmutable(request))
    return
  }

  // 3. Resto de estáticos (iconos, fuentes, manifest, css suelto) → SWR.
  if (
    ['style', 'script', 'image', 'font', 'manifest'].includes(
      request.destination,
    )
  ) {
    event.respondWith(staleWhileRevalidate(request))
    return
  }
})

// Permite que la app dispare la activación del SW en waiting.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// ── Web Push ────────────────────────────────────────────────────────────────
// Al recibir un push del backend, mostramos una notificación nativa con acciones.
//
// REGLA CRÍTICA iOS: la notificación DEBE tener title y body NO vacíos. Si iOS
// recibe un push "silent" (sin texto visible) acumula un contador interno; al
// llegar a 2–3 silent pushes seguidos APNs revoca la suscripción sin aviso y
// el dispositivo deja de recibir notificaciones hasta que te resuscribas. Por
// eso aquí forzamos siempre título y body con un fallback genérico antes de
// llamar a showNotification, incluso cuando event.data no parsea o viene vacío.
self.addEventListener('push', (event) => {
  // Defaults: NUNCA strings vacíos.
  const FALLBACK_TITLE = 'Focus'
  const FALLBACK_BODY  = 'Tienes un recordatorio'

  let payload = {}
  if (event.data) {
    try {
      payload = event.data.json()
    } catch {
      const text = (event.data.text?.() || '').trim()
      payload = { title: FALLBACK_TITLE, body: text || FALLBACK_BODY }
    }
  }

  const {
    title: rawTitle,
    body: rawBody,
    url = '/',
    tag = 'focus-reminder',
    icon = '/icons/icon-192.png',
    badge = '/icons/icon-192.png',
    actions = [],
    data = {},
  } = payload

  // Forzamos strings no vacíos (evita silent push en iOS si el backend olvidó
  // llenar title o body).
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : FALLBACK_TITLE
  const body  = typeof rawBody  === 'string' && rawBody.trim()  ? rawBody  : FALLBACK_BODY

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      renotify: true,
      requireInteraction: false,
      data: { url, ...data },
      actions: actions.length > 0 ? actions : [
        { action: 'open',   title: 'Abrir' },
        { action: 'snooze', title: 'Posponer 10 min' },
      ],
    }),
  )
})

// ── Click en notificación ──────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const action = event.action
  const targetUrl = event.notification.data?.url || '/'

  // Snooze: avisar al backend que reprograme +10min.
  // Adjuntamos el endpoint de la suscripción como prueba de posesión (el
  // backend lo resuelve a user_id y snoozea SOLO la notif de ese usuario).
  if (action === 'snooze') {
    event.waitUntil(
      (async () => {
        let endpoint = null
        try {
          const sub = await self.registration.pushManager.getSubscription()
          endpoint = sub?.endpoint || null
        } catch {}
        if (!endpoint) return
        try {
          await fetch('/api/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'snooze',
              eventId: event.notification.data?.eventId,
              minutes: 10,
              endpoint,
            }),
          })
        } catch {}
      })()
    )
    return
  }

  // Default / "open": enfocar la app o abrirla
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          client.focus()
          if ('navigate' in client) client.navigate(targetUrl)
          return
        }
      }
      return self.clients.openWindow(targetUrl)
    })()
  )
})

// Renovar suscripción si el navegador la invalida (APNs/FCM rotan, iOS
// deployment de PWA, Chrome cambia de proveedor…). El SW corre aislado del
// main thread, sin acceso al JWT de Supabase, así que el POST 'subscribe'
// normal fallaba con 401 y la sub vieja quedaba huérfana en el backend. Ahora
// usamos la acción 'renew' que autentica por posesión del endpoint viejo: el
// SW manda oldEndpoint (prueba que es él) + new subscription, y el backend
// resuelve al user_id del endpoint viejo, reemplazándola.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const oldEndpoint = event.oldSubscription?.endpoint || null
      try {
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
        })
        if (!newSub) return

        if (oldEndpoint) {
          // Camino principal: renew autenticado por endpoint viejo
          await fetch('/api/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'renew',
              old_endpoint: oldEndpoint,
              subscription: newSub.toJSON(),
            }),
          })
        } else {
          // Fallback: sin oldEndpoint, la próxima vez que el cliente abra la
          // app el auto-healer (useNotifications) detecta el mismatch contra
          // /api/push?health y llama forceResubscribe() con token válido.
          // No hacemos nada aquí — intentar subscribe sin auth solo generaría
          // un 401 y ruido en logs.
        }
      } catch {}
    })()
  )
})

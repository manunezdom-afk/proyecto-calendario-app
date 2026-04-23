// Service Worker de Focus
// Estrategia de caché (rediseñada para que la PWA instalada nunca quede vieja):
//
//   1. Documento HTML / navegación  → NETWORK-FIRST con timeout corto.
//      El HTML contiene referencias a los assets hasheados de la última build,
//      así que si cacheamos HTML viejo quedamos atrapados con un bundle viejo.
//      Siempre intentamos red primero; solo caemos al shell cacheado si no hay
//      conexión o la red tarda demasiado (offline / captive portal).
//
//   2. Assets hasheados /assets/*   → CACHE-FIRST (inmutables por hash).
//      Vite emite archivos con hash en el nombre. Cachearlos agresivamente
//      es seguro: un cambio de código => nombre de archivo nuevo.
//
//   3. Iconos, fuentes, manifest    → STALE-WHILE-REVALIDATE.
//      Pintan rápido desde caché y se refrescan en segundo plano.
//
//   4. /api/*                       → siempre red, no se cachea.
//
// Con esta combinación la PWA instalada siempre recibe el HTML fresco que
// apunta a la build correcta, y conserva arranque instantáneo de los assets
// estáticos hasheados. El único costo es una request de red para el HTML al
// abrir la app, pero con timeout y fallback a caché si no hay conexión.

const VERSION = 'v15'
const SHELL_CACHE = `focus-shell-${VERSION}`
const ASSETS_CACHE = `focus-assets-${VERSION}`
const CURRENT_CACHES = [SHELL_CACHE, ASSETS_CACHE]

const OFFLINE_FALLBACK = '/index.html'
const PRECACHE_URLS = [OFFLINE_FALLBACK, '/manifest.json', '/icons/icon.svg']

// Timeout agresivo: 3500 ms dejaba al iPhone PWA viendo la pantalla de
// carga en negro durante segundos cuando el primer byte tardaba. 1200 ms
// cubre redes 4G normales y corta rápido al shell cacheado en casos malos.
const NAV_TIMEOUT_MS = 1200

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
          try {
            const res = await fetch(url, { cache: 'reload' })
            if (res && res.ok) await cache.put(url, res.clone())
          } catch {
            // seguimos: si una URL falla no bloqueamos la instalación
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

async function networkFirstForDocument(request) {
  const cache = await caches.open(SHELL_CACHE)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS)

  try {
    const res = await fetch(request, {
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeoutId)
    if (res && res.ok) {
      const copy = res.clone()
      cache.put(OFFLINE_FALLBACK, copy).catch(() => {})
    }
    return res
  } catch {
    clearTimeout(timeoutId)
    const cached =
      (await cache.match(request)) || (await cache.match(OFFLINE_FALLBACK))
    if (cached) return cached
    return new Response(
      '<h1>Sin conexión</h1><p>No se pudo cargar la app.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
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

  // 1. Navegación → network-first con fallback a shell cacheado.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstForDocument(request))
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

  // Snooze: avisar al backend que reprograme +10min
  if (action === 'snooze') {
    event.waitUntil(
      fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'snooze',
          eventId: event.notification.data?.eventId,
          minutes: 10,
        }),
      }).catch(() => {})
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

// Renovar suscripción si el navegador la invalida
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
        })
        await fetch('/api/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'subscribe', subscription: newSub.toJSON(), renewed: true }),
        })
      } catch {}
    })()
  )
})

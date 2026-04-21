// Service Worker de Focus
// Estrategia:
//   - App shell: cache-first con fallback a red (arranque instantáneo offline)
//   - Navegación: stale-while-revalidate → servimos el HTML cacheado al instante
//     y refrescamos en segundo plano. Clave en iOS PWA standalone: eliminamos
//     la ventana de pantalla blanca mientras se espera la red. Antes estaba en
//     network-first, lo que en iOS standalone producía ~9s de blanco cuando la
//     red era lenta o el Webkit de la PWA arrancaba frío.
//   - Recursos estáticos (JS/CSS/imágenes): stale-while-revalidate
//   - Llamadas a /api/: siempre red (no se cachean)

const VERSION = 'v11'
const STATIC_CACHE = `focus-static-${VERSION}`
const RUNTIME_CACHE = `focus-runtime-${VERSION}`

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' })))
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Solo procesamos mismo origen
  if (url.origin !== self.location.origin) return

  // No cachear APIs
  if (url.pathname.startsWith('/api/')) return

  // Navegación HTML → stale-while-revalidate
  // Servimos el index.html cacheado al instante (first paint inmediato incluso
  // con red lenta o caída), y revalidamos en background para la próxima apertura.
  // Cualquier ruta de la SPA cae al mismo shell (el rewrite de Vercel también).
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then((cached) => {
        const networkFetch = fetch(request)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone()
              caches.open(STATIC_CACHE).then((c) => c.put('/index.html', copy))
            }
            return res
          })
          .catch(() => cached || caches.match('/index.html'))
        return cached || networkFetch
      })
    )
    return
  }

  // Estáticos → stale-while-revalidate
  if (['style', 'script', 'image', 'font'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone()
              caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy))
            }
            return res
          })
          .catch(() => cached)
        return cached || fetchPromise
      })
    )
  }
})

// Permitir que la app fuerce la actualización
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// ── Web Push ────────────────────────────────────────────────────────────────
// Al recibir un push del backend, mostramos una notificación nativa con acciones.
self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload = {}
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Focus', body: event.data.text() || '' }
  }

  const {
    title = 'Focus',
    body = '',
    url = '/',
    tag = 'focus-reminder',
    icon = '/icons/icon-192.png',
    badge = '/icons/icon-192.png',
    actions = [],
    data = {},
  } = payload

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
      fetch('/api/push-snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        await fetch('/api/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: newSub.toJSON(), renewed: true }),
        })
      } catch {}
    })()
  )
})

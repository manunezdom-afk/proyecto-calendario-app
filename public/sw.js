// Service Worker de Focus
// Estrategia:
//   - App shell: cache-first con fallback a red (para arranque instantáneo offline)
//   - Navegación: network-first con fallback al shell cacheado
//   - Recursos estáticos (JS/CSS/imágenes): stale-while-revalidate
//   - Llamadas a /api/: siempre red (no se cachean)

const VERSION = 'v1'
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
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Solo procesamos mismo origen
  if (url.origin !== self.location.origin) return

  // No cachear APIs
  if (url.pathname.startsWith('/api/')) return

  // Navegación HTML → network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy))
          return res
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('/index.html')))
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

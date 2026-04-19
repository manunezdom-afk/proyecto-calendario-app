import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// Banner que se muestra cuando pwa.js detecta un nuevo Service Worker
// listo para activar. En iPhone con PWA instalada, la estrategia
// stale-while-revalidate del SW servía la versión vieja del JS hasta
// que el usuario hiciera una recarga manual — lo cual casi nunca pasa.
// Con este banner el usuario ve "nueva versión" y toca para recargar.
//
// Flujo:
// 1. Deploy nuevo → navegador fetches /sw.js, lo detecta actualizado.
// 2. pwa.js dispara `focus:sw-update-available`.
// 3. Este banner se muestra.
// 4. Tap → enviamos SKIP_WAITING al nuevo SW → reload → ya está activo.
export default function UpdateAvailableBanner() {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onUpdate() { setAvailable(true) }
    window.addEventListener('focus:sw-update-available', onUpdate)
    return () => window.removeEventListener('focus:sw-update-available', onUpdate)
  }, [])

  async function applyUpdate() {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      const waiting = reg?.waiting
      if (waiting) {
        waiting.postMessage({ type: 'SKIP_WAITING' })
        // Cuando el nuevo SW toma control, el browser emite controllerchange.
        // En ese momento recargamos para que la app arranque con el JS nuevo.
        let reloaded = false
        navigator.serviceWorker?.addEventListener('controllerchange', () => {
          if (reloaded) return
          reloaded = true
          window.location.reload()
        })
        // Safety net: si por algún motivo no se dispara controllerchange
        // (iOS Safari a veces es flojo), forzamos reload después de 1.5s.
        setTimeout(() => {
          if (!reloaded) {
            reloaded = true
            window.location.reload()
          }
        }, 1500)
      } else {
        // No hay waiting (caso raro) — simple reload igual trae el JS nuevo.
        window.location.reload()
      }
    } catch {
      window.location.reload()
    }
  }

  function dismiss() { setAvailable(false) }

  return (
    <AnimatePresence>
      {available && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-x-4 z-[95] md:left-auto md:right-6 md:w-[360px] mx-auto max-w-md rounded-2xl bg-slate-900 text-white shadow-2xl px-4 py-3 flex items-center gap-3"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 92px)' }}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-emerald-400">
            system_update
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold">Nueva versión disponible</p>
            <p className="text-[11.5px] text-white/60 leading-snug">
              Recarga para aplicar los cambios más recientes.
            </p>
          </div>
          <button
            type="button"
            onClick={applyUpdate}
            disabled={busy}
            className="text-[12px] font-bold bg-white text-slate-900 rounded-full px-3 py-1.5 hover:bg-white/90 active:scale-95 transition-all disabled:opacity-50"
          >
            {busy ? 'Recargando…' : 'Recargar'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Cerrar"
            className="flex-shrink-0 text-white/40 hover:text-white/80 transition-colors"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// Banner ligero que aparece cuando el navegador pierde conexión. La app
// funciona offline (cola de sync en dataService + localStorage), pero el
// usuario debe saber que sus cambios no se están guardando en la nube aún.
// Se desmonta solo cuando vuelve la conexión, tras 2s extra para confirmar.
export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  )
  const [justReconnected, setJustReconnected] = useState(false)

  useEffect(() => {
    function onOffline() { setIsOffline(true); setJustReconnected(false) }
    function onOnline() {
      setIsOffline(false)
      setJustReconnected(true)
      setTimeout(() => setJustReconnected(false), 2500)
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online',  onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          key="offline"
          role="status"
          aria-live="polite"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed top-0 inset-x-0 z-[90] bg-amber-500 text-white text-[12px] font-semibold px-3 flex items-center justify-center gap-2 shadow-md"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)', paddingBottom: '0.5rem' }}
        >
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">cloud_off</span>
          Sin conexión — tus cambios se guardarán localmente y se sincronizarán cuando vuelva.
        </motion.div>
      )}
      {!isOffline && justReconnected && (
        <motion.div
          key="reconnected"
          role="status"
          aria-live="polite"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed top-0 inset-x-0 z-[90] bg-emerald-500 text-white text-[12px] font-semibold px-3 flex items-center justify-center gap-2 shadow-md"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)', paddingBottom: '0.5rem' }}
        >
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">cloud_done</span>
          Conexión restablecida. Sincronizando cambios…
        </motion.div>
      )}
    </AnimatePresence>
  )
}

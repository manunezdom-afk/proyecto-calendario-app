import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { canInstall, onInstallAvailable, promptInstall, isStandalone } from '../lib/pwa'

const DISMISSED_KEY = 'focus_install_dismissed'

function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream
}

// ── InstallAppCard ──────────────────────────────────────────────────────────
// Card flotante que invita a instalar Focus como app.
// - En Android/Chrome/Edge: usa el evento beforeinstallprompt (instalación 1 tap)
// - En iOS Safari: muestra instrucciones (Compartir → Añadir a pantalla)
// - Se oculta si ya está instalado o si el usuario la descartó
export default function InstallAppCard() {
  const [available, setAvailable] = useState(canInstall())
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === 'true' } catch { return false }
  })
  const [iosHintOpen, setIosHintOpen] = useState(false)

  useEffect(() => onInstallAvailable(setAvailable), [])

  // No mostrar si ya está instalado o si el usuario dijo no
  if (isStandalone()) return null
  if (dismissed) return null

  const ios = isIOS()
  // En iOS no existe beforeinstallprompt pero queremos igual ofrecer el hint
  if (!available && !ios) return null

  function handleDismiss() {
    try { localStorage.setItem(DISMISSED_KEY, 'true') } catch {}
    setDismissed(true)
  }

  async function handleInstall() {
    if (ios) {
      setIosHintOpen(true)
      return
    }
    const res = await promptInstall()
    if (res.outcome === 'accepted') handleDismiss()
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 30 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        className="fixed bottom-[88px] left-4 right-4 z-[55] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur-lg lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0 lg:w-[360px]"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-violet-500 to-fuchsia-500 text-white shadow-md shadow-blue-200">
            <span
              className="material-symbols-outlined text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              install_mobile
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-slate-900">
              Instalá Focus como app
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-slate-500">
              Abrite directo desde tu pantalla, sin barra del navegador. Funciona offline.
            </p>
            <div className="mt-2.5 flex items-center gap-1.5">
              <button
                onClick={handleInstall}
                className="rounded-full bg-slate-900 px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-slate-800 active:scale-95"
              >
                {ios ? 'Cómo instalarla' : 'Instalar'}
              </button>
              <button
                onClick={handleDismiss}
                className="rounded-full px-2.5 py-1.5 text-[11.5px] font-medium text-slate-500 hover:bg-slate-100"
              >
                Ahora no
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Descartar"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
          >
            <span className="material-symbols-outlined text-[15px]">close</span>
          </button>
        </div>
      </motion.div>

      {/* Modal de instrucciones iOS */}
      <AnimatePresence>
        {iosHintOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIosHintOpen(false)}
              className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed left-1/2 top-1/2 z-[91] w-[min(92vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-2xl"
            >
              <p className="mb-4 text-center text-[16px] font-bold text-slate-900">
                Instalar Focus en iOS
              </p>
              <ol className="space-y-3 text-[13.5px] leading-relaxed text-slate-700">
                <li className="flex gap-2">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">1</span>
                  Tocá el botón <span className="material-symbols-outlined mx-0.5 align-middle text-[17px] text-blue-500">ios_share</span> Compartir en Safari.
                </li>
                <li className="flex gap-2">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">2</span>
                  Seleccioná <b>Añadir a pantalla de inicio</b>.
                </li>
                <li className="flex gap-2">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">3</span>
                  Tocá <b>Añadir</b>. Listo — Focus queda como app.
                </li>
              </ol>
              <button
                onClick={() => { setIosHintOpen(false); handleDismiss() }}
                className="mt-5 w-full rounded-full bg-slate-900 py-2.5 text-[13px] font-semibold text-white"
              >
                Entendido
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

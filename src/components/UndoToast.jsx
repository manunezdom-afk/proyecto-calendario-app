import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * Toast global de "Deshacer" — aparece tras cualquier acción reversible que
 * la app acaba de aplicar (normalmente algo que Nova creó). Dura 7 segundos
 * con barra de progreso visible para que el usuario sienta la ventana de
 * arrepentimiento. Una sola instancia: el próximo undoable reemplaza al
 * anterior (y el anterior se considera "aceptado").
 *
 * Esto cierra la brecha de confianza: el onboarding promete "cualquier cambio
 * lo puedes deshacer en un toque", y este toast es esa promesa hecha carne.
 */
const DURATION_MS = 7000

export default function UndoToast({ action, onDismiss }) {
  // `action` = { id, message, undo: () => void } | null
  // Usamos el id como key para que el re-trigger reinicie la animación.
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    if (!action) return
    setProgress(100)
    const start = Date.now()
    const iv = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.max(0, 100 - (elapsed / DURATION_MS) * 100)
      setProgress(pct)
      if (elapsed >= DURATION_MS) {
        clearInterval(iv)
        onDismiss?.()
      }
    }, 80)
    return () => clearInterval(iv)
  }, [action?.id, onDismiss])

  function handleUndo() {
    try { action?.undo?.() } catch {}
    onDismiss?.()
  }

  return (
    <AnimatePresence>
      {action && (
        <motion.div
          key={action.id}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 440, damping: 32 }}
          className="fixed left-1/2 -translate-x-1/2 z-[85] overflow-hidden rounded-2xl bg-slate-900/95 text-white shadow-[0_20px_48px_rgba(0,0,0,0.3)] backdrop-blur max-w-[min(92vw,440px)] w-max"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 6.5rem)' }}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <span
              className="material-symbols-outlined text-emerald-300 text-[20px] flex-shrink-0"
              style={{ fontVariationSettings: "'FILL' 1" }}
              aria-hidden="true"
            >
              check_circle
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-tight truncate">{action.message}</p>
            </div>
            <button
              type="button"
              onClick={handleUndo}
              className="flex items-center gap-1 text-[12px] font-bold px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex-shrink-0"
            >
              <span className="material-symbols-outlined text-[14px]">undo</span>
              Deshacer
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Cerrar"
              className="text-white/50 hover:text-white/90 transition-colors flex-shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          {/* Barra de progreso: comunica visualmente cuánto queda antes de que
              el cambio se "confirme" (ya no sea reversible desde aquí). */}
          <div className="h-[3px] bg-white/5">
            <div
              className="h-full bg-emerald-400/80 transition-[width] duration-75 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

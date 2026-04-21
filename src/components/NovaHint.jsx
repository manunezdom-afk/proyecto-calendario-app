import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import NovaOrb from './NovaOrb'

const HINT_KEY_PREFIX = 'focus_hint_'

function wasShown(id) {
  try { return localStorage.getItem(HINT_KEY_PREFIX + id) === '1' } catch { return false }
}

function markShown(id) {
  try { localStorage.setItem(HINT_KEY_PREFIX + id, '1') } catch {}
}

/**
 * NovaHint — tip contextual del asistente.
 * Aparece una sola vez por navegador (persistido en localStorage).
 * La burbuja emerge al lado del orbe con una animación suave.
 * El usuario puede descartar con tap o botón.
 *
 * Ubicación por defecto: esquina inferior derecha (sobre bottom nav).
 */
export default function NovaHint({
  id,
  children,
  trigger = true,
  delayMs = 800,
  onDismiss,
  actionLabel,
  onAction,
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!trigger) return
    if (wasShown(id)) return
    const t = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(t)
  }, [id, trigger, delayMs])

  function dismiss() {
    markShown(id)
    setVisible(false)
    onDismiss?.()
  }

  function handleAction() {
    onAction?.()
    dismiss()
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="fixed z-[60]"
          style={{
            right: 'calc(env(safe-area-inset-right, 0px) + 18px)',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 108px)',
            maxWidth: 'min(92vw, 340px)',
          }}
        >
          <div className="flex items-end gap-2">
            <div style={{ flexShrink: 0, marginBottom: 4 }}>
              <NovaOrb size={36} pulse ambient />
            </div>
            <div
              className="relative rounded-2xl rounded-bl-md border px-4 py-3 shadow-xl"
              style={{
                background: 'rgba(20, 18, 36, 0.92)',
                borderColor: 'rgba(124, 107, 255, 0.25)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                color: 'rgba(255,255,255,0.92)',
              }}
            >
              <p
                className="font-headline"
                style={{
                  fontSize: '13.5px',
                  lineHeight: 1.45,
                  letterSpacing: '-0.005em',
                  fontWeight: 500,
                }}
              >
                {children}
              </p>

              <div className="mt-2.5 flex items-center gap-2">
                {actionLabel && (
                  <button
                    onClick={handleAction}
                    className="rounded-full px-3 py-1 text-[12px] font-semibold text-white transition-transform active:scale-95"
                    style={{ background: 'var(--nova)' }}
                  >
                    {actionLabel}
                  </button>
                )}
                <button
                  onClick={dismiss}
                  className="rounded-full px-2.5 py-1 text-[12px] font-medium text-white/50 hover:text-white/80 transition-colors"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function resetHint(id) {
  try { localStorage.removeItem(HINT_KEY_PREFIX + id) } catch {}
}

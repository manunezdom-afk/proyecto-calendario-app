import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { pushModal, popModal } from '../utils/modalStack'

// ContextActionSheet
//
// Bottom sheet compacto que aparece tras un long-press en un evento o
// tarea. Things 3 / Apple Reminders usan este patrón para exponer
// 3–5 acciones rápidas sin forzar al usuario a abrir el detalle.
//
// Props:
//   open        — boolean.
//   title       — string que se muestra en el header del sheet.
//   subtitle    — opcional, en gris debajo del título (hora, fecha).
//   actions     — array de { icon, label, onClick, tone? }.
//                 tone: 'default' | 'danger'.
//   onClose     — cerrar el sheet sin acción.
//
// Se monta via portal a document.body (igual que QuickAddSheet) para no
// quedar atrapado en stacking contexts de ancestros transformados. Registra
// push/popModal para que la pastilla de Nova se esconda mientras esté
// visible.

const TONE_CLASSES = {
  default: 'text-on-surface hover:bg-surface-container-high',
  danger:  'text-error hover:bg-error/10',
}

export default function ContextActionSheet({ open, title, subtitle, actions = [], onClose }) {
  useEffect(() => {
    if (!open) return
    pushModal()
    return () => popModal()
  }, [open])

  // Cerrar con Escape en desktop.
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="ctx-wrap"
          className="fixed inset-0 z-[72] flex items-end justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            className="relative w-full max-w-lg bg-surface rounded-t-[32px] px-2 pt-3 shadow-2xl z-10"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0,  opacity: 1 }}
            exit={{    y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          >
            <div className="w-10 h-1 bg-outline-variant rounded-full mx-auto mb-3" />

            {(title || subtitle) && (
              <div className="px-4 pb-2">
                {title && <p className="text-[14px] font-bold text-on-surface truncate">{title}</p>}
                {subtitle && <p className="text-[12px] text-outline mt-0.5 truncate">{subtitle}</p>}
              </div>
            )}

            <div className="flex flex-col py-1">
              {actions.map((a, i) => {
                const toneClass = TONE_CLASSES[a.tone] || TONE_CLASSES.default
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { a.onClick?.(); onClose?.() }}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl mx-1 text-left text-[14px] font-semibold transition-colors ${toneClass}`}
                  >
                    {a.icon && (
                      <span className="material-symbols-outlined text-[20px] flex-shrink-0">
                        {a.icon}
                      </span>
                    )}
                    <span className="flex-1 min-w-0 truncate">{a.label}</span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

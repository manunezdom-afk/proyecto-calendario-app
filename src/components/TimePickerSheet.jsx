import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import WheelTimePicker, { parseTimeToHM, formatTime12, formatTime24 } from './WheelTimePicker'
import { pushModal, popModal } from '../utils/modalStack'

// Bottom sheet que envuelve el WheelTimePicker con botones de acción:
// "Sin hora" (limpia), "Cancelar" (descarta) y "Listo" (guarda).
//
// outputFormat:
//   '12h' → devuelve "8:00 PM"
//   '24h' → devuelve "20:00"
//
// Se monta por portal a document.body para escapar cualquier ancestro con
// transform (motion.div de transiciones), que de otro modo aislaría el
// z-index y dejaría el sheet debajo de la nav bar.

export default function TimePickerSheet({
  initialValue = '',
  onClose,
  onSave,
  onClear,
  outputFormat = '12h',
  title = 'Hora',
  allowClear = true,
}) {
  const [current, setCurrent] = useState(() => {
    const { h, m } = parseTimeToHM(initialValue, { h: 9, m: 0 })
    return formatTime24(h, m)
  })

  useEffect(() => {
    pushModal()
    return () => popModal()
  }, [])

  function handleDone() {
    const { h, m } = parseTimeToHM(current, { h: 9, m: 0 })
    onSave?.(outputFormat === '24h' ? formatTime24(h, m) : formatTime12(h, m))
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative w-full max-w-lg bg-surface rounded-t-[32px] px-6 pt-4 shadow-2xl z-10"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
      >
        <div className="w-10 h-1 bg-outline-variant rounded-full mx-auto mb-4" />

        <h2 className="text-center font-headline font-extrabold text-lg text-on-surface mb-3">
          {title}
        </h2>

        <WheelTimePicker
          initialValue={current}
          onChange={setCurrent}
        />

        <div className={`mt-5 grid gap-2 ${allowClear ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {allowClear && (
            <button
              type="button"
              onClick={() => { onClear?.(); onClose?.() }}
              className="py-3 rounded-2xl bg-surface-container-low text-on-surface-variant font-semibold text-[13px] active:scale-[0.98] transition-transform"
            >
              Sin hora
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="py-3 rounded-2xl bg-surface-container-low text-on-surface-variant font-semibold text-[13px] active:scale-[0.98] transition-transform"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="py-3 rounded-2xl bg-primary text-white font-bold text-[13px] shadow-lg shadow-primary/20 active:scale-[0.98] transition-transform"
          >
            Listo
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

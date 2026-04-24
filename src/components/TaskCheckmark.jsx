import { useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// TaskCheckmark
//
// Antes togglear una tarea era un icono que se reemplazaba con otro + un
// cambio de color. Cero satisfacción. Apps como Things o Apple Reminders
// celebran el check con un pop spring + un haptic tick — micro-detalle que
// hace que completar una tarea se sienta bien y no como tachar una línea.
//
// Este componente encapsula:
//   · El botón redondo con los dos estados (vacío / completo).
//   · Un spring scale sólo en la transición a "done" (pop 1 → 1.35 → 1).
//   · Un halo verde que se expande y desvanece detrás del check la primera
//     vez que queda marcado, como confirmación visual de "hecho".
//   · navigator.vibrate(8) discretos en el toggle (Android/compatible; iOS
//     Safari no expone la API y ahí queda silencioso).
//
// Uso:
//   <TaskCheckmark done={task.done} onToggle={() => toggleTask(task.id)} size={20} />

export default function TaskCheckmark({ done, onToggle, size = 20, className = '' }) {
  const wasDoneRef = useRef(done)
  const justCompleted = done && !wasDoneRef.current
  wasDoneRef.current = done

  function handleClick(e) {
    e.stopPropagation()
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(8) } catch {}
    }
    onToggle?.()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-checked={done}
      role="checkbox"
      className={`relative flex-shrink-0 inline-flex items-center justify-center active:scale-90 transition-transform ${className}`}
      style={{ width: size + 8, height: size + 8 }}
    >
      {/* Halo de celebración: se dibuja sólo cuando acaba de completarse.
          La animación dura 420 ms y luego se desmonta. */}
      <AnimatePresence>
        {justCompleted && (
          <motion.span
            key="halo"
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-emerald-400/40"
            initial={{ scale: 0.4, opacity: 0.9 }}
            animate={{ scale: 1.8, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.42, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      <motion.span
        key={done ? 'done' : 'open'}
        className={`material-symbols-outlined transition-colors ${
          done ? 'text-primary' : 'text-outline-variant'
        }`}
        style={{
          fontSize: size,
          fontVariationSettings: done ? "'FILL' 1" : "'FILL' 0",
        }}
        // Pop SÓLO cuando pasa a done. El estado "destacar abriendo" no
        // merece animación: desmarcar no debería sentirse como un evento.
        initial={false}
        animate={
          justCompleted
            ? { scale: [1, 1.35, 1] }
            : { scale: 1 }
        }
        transition={
          justCompleted
            ? { duration: 0.32, times: [0, 0.45, 1], ease: 'easeOut' }
            : { duration: 0.15 }
        }
      >
        {done ? 'check_circle' : 'radio_button_unchecked'}
      </motion.span>
    </button>
  )
}

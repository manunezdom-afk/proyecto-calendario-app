import { motion } from 'framer-motion'

/**
 * Tarjeta de consentimiento previa al primer mensaje a Nova.
 * Nombra a los proveedores de IA que reciben datos (Guideline 5.1.2(i)) y
 * enlaza la política de privacidad. El mensaje del usuario queda retenido
 * por el caller hasta que acepte; "Ahora no" lo devuelve al input.
 */
export default function AIConsentCard({ onAccept, onCancel }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 shadow-sm"
      role="alertdialog"
      aria-label="Consentimiento para usar inteligencia artificial"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-on-surface">
            Nova usa inteligencia artificial externa
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-outline">
            Para responder, tu mensaje y el contexto de tu agenda (eventos, tareas
            y memorias que guardaste) se envían a proveedores de IA:{' '}
            <strong>DeepSeek</strong> como principal y OpenAI o Anthropic para voz,
            fotos o como alternativa. No se usan para publicidad ni se venden.{' '}
            <a
              href="/privacidad"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              Más información
            </a>
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-outline hover:bg-surface-container transition-colors"
        >
          Ahora no
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="rounded-full bg-primary px-3.5 py-1.5 text-[12px] font-bold text-white shadow-sm shadow-primary/20"
        >
          Aceptar y enviar
        </button>
      </div>
    </motion.div>
  )
}

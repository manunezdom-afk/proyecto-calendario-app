import { useMemo, useRef } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion'

const SWIPE_THRESHOLD = 96
const HAPTIC_APPROVE  = 12
const HAPTIC_REJECT   = 8

function haptic(ms) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(ms) } catch {}
  }
}

function formatTimeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'ahora'
  const min = Math.floor(sec / 60)
  if (min < 60) return `hace ${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `hace ${hr} h`
  const d = Math.floor(hr / 24)
  return `hace ${d} d`
}

// ── Tarjeta individual ──────────────────────────────────────────────────────
function SuggestionCard({ suggestion, onApprove, onReject }) {
  const isPending = suggestion.status === 'pending'
  const isApproved = suggestion.status === 'approved'
  const isRejected = suggestion.status === 'rejected'

  const statusChip = isApproved
    ? { label: 'Aprobada', className: 'bg-emerald-50 text-emerald-600' }
    : isRejected
    ? { label: 'Rechazada', className: 'bg-slate-100 text-slate-500' }
    : null

  const x = useMotionValue(0)
  const crossed = useRef(0)
  const approveOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1])
  const rejectOpacity  = useTransform(x, [-SWIPE_THRESHOLD, 0], [1, 0])
  const scale          = useTransform(x, [-SWIPE_THRESHOLD, 0, SWIPE_THRESHOLD], [0.98, 1, 0.98])

  function handleDrag(_, info) {
    const sign = Math.sign(info.offset.x)
    if (sign !== crossed.current && Math.abs(info.offset.x) > SWIPE_THRESHOLD) {
      crossed.current = sign
      haptic(sign > 0 ? HAPTIC_APPROVE : HAPTIC_REJECT)
    } else if (Math.abs(info.offset.x) < SWIPE_THRESHOLD) {
      crossed.current = 0
    }
  }

  function handleDragEnd(_, info) {
    if (info.offset.x > SWIPE_THRESHOLD && isPending) {
      onApprove(suggestion.id)
    } else if (info.offset.x < -SWIPE_THRESHOLD && isPending) {
      onReject(suggestion.id)
    }
  }

  return (
    <motion.div layout className="relative">
      {isPending && (
        <>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-end rounded-2xl bg-gradient-to-l from-emerald-500 to-emerald-400 pr-6 text-white"
            style={{ opacity: approveOpacity }}
          >
            <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <span className="ml-2 font-semibold">Aprobar</span>
          </motion.div>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-start rounded-2xl bg-gradient-to-r from-slate-500 to-slate-400 pl-6 text-white"
            style={{ opacity: rejectOpacity }}
          >
            <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>close</span>
            <span className="ml-2 font-semibold">Rechazar</span>
          </motion.div>
        </>
      )}
    <motion.div
      drag={isPending ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.35}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      style={{ x, scale }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', damping: 22, stiffness: 300 }}
      className={`relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${
        !isPending ? 'opacity-70' : ''
      } ${isPending ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
            isPending
              ? 'bg-gradient-to-br from-blue-50 to-violet-50 text-blue-600'
              : 'bg-slate-50 text-slate-400'
          }`}
        >
          <span className="material-symbols-outlined text-[19px]">
            {suggestion.previewIcon || 'auto_awesome'}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-nova text-[14px] font-semibold text-slate-800">
              {suggestion.previewTitle}
            </p>
            {statusChip && (
              <span
                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusChip.className}`}
              >
                {statusChip.label}
              </span>
            )}
          </div>

          {suggestion.previewBody && (
            <p className="mt-0.5 text-[12px] text-slate-500">{suggestion.previewBody}</p>
          )}

          {suggestion.reason && (
            <p className="mt-2 font-nova rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] italic leading-snug text-slate-600">
              “{suggestion.reason}”
            </p>
          )}

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10.5px] text-slate-400">
              {formatTimeAgo(suggestion.createdAt)}
            </span>

            {isPending && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onReject(suggestion.id)}
                  className="rounded-full px-2.5 py-1 text-[11.5px] font-medium text-slate-500 transition-colors hover:bg-slate-100"
                >
                  Rechazar
                </button>
                <button
                  onClick={() => onApprove(suggestion.id)}
                  className="flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-[11.5px] font-semibold text-white transition-all hover:bg-blue-700 active:scale-95"
                >
                  <span className="material-symbols-outlined text-[13px]">check</span>
                  Aprobar
                </button>
              </div>
            )}
          </div>
          {isPending && (
            <p className="mt-1.5 text-[10.5px] text-slate-400">
              Desliza → aprobar · ← rechazar
            </p>
          )}
        </div>
      </div>
    </motion.div>
    </motion.div>
  )
}

// ── Panel principal ─────────────────────────────────────────────────────────
export default function SuggestionsInbox({
  isOpen,
  onClose,
  suggestions = [],
  onApprove,
  onReject,
  onClearResolved,
}) {
  const { pending, resolved } = useMemo(() => {
    return {
      pending: suggestions.filter((s) => s.status === 'pending'),
      resolved: suggestions.filter((s) => s.status !== 'pending').slice(0, 10),
    }
  }, [suggestions])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-slate-900/30 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 z-[71] flex h-full w-full max-w-md flex-col bg-slate-50 shadow-2xl"
          >
            {/* Header */}
            <header
              className="flex items-center justify-between border-b border-slate-200 bg-white px-5 pb-4"
              style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-md shadow-blue-200">
                  <span
                    className="material-symbols-outlined text-[17px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    inbox
                  </span>
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-slate-900">
                    Bandeja de Nova
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    {pending.length > 0
                      ? `${pending.length} sugerencia${pending.length === 1 ? '' : 's'} pendiente${pending.length === 1 ? '' : 's'}`
                      : 'Sin sugerencias pendientes'}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Cerrar bandeja"
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 active:scale-95"
              >
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </header>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {pending.length === 0 && resolved.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-violet-50">
                    <span className="material-symbols-outlined text-[28px] text-blue-500">
                      auto_awesome
                    </span>
                  </div>
                  <p className="text-[14px] font-semibold text-slate-700">
                    Bandeja vacía
                  </p>
                  <p className="mt-1 max-w-[260px] text-[12.5px] leading-relaxed text-slate-500">
                    Cuando le pidas algo a Nova, sus propuestas aparecerán aquí para que las apruebes antes de aplicarlas.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pending.length > 0 && (
                    <>
                      <p className="px-1 text-[11px] font-semibold text-slate-400">
                        Pendientes
                      </p>
                      <AnimatePresence initial={false}>
                        {pending.map((s) => (
                          <SuggestionCard
                            key={s.id}
                            suggestion={s}
                            onApprove={onApprove}
                            onReject={onReject}
                          />
                        ))}
                      </AnimatePresence>
                    </>
                  )}

                  {resolved.length > 0 && (
                    <>
                      <div className="flex items-center justify-between pt-3">
                        <p className="px-1 text-[11px] font-semibold text-slate-400">
                          Recientes
                        </p>
                        <button
                          onClick={onClearResolved}
                          className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
                        >
                          Limpiar
                        </button>
                      </div>
                      <AnimatePresence initial={false}>
                        {resolved.map((s) => (
                          <SuggestionCard
                            key={s.id}
                            suggestion={s}
                            onApprove={onApprove}
                            onReject={onReject}
                          />
                        ))}
                      </AnimatePresence>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Footer con info */}
            <footer className="border-t border-slate-200 bg-white px-5 py-3">
              <p className="text-[11px] leading-relaxed text-slate-500">
                Nova nunca cambia tu calendario sin tu confirmación. Revisa cada propuesta antes de aplicarla.
              </p>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

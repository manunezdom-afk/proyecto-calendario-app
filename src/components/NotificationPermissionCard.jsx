import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { getIOSPushStatus } from '../lib/iosPushSupport'

// Card que invita al usuario a activar notificaciones.
//
// En iOS es especial: Safari plano NO puede recibir Web Push, solo la PWA
// instalada al home screen (iOS 16.4+). Sin este gate, el usuario tocaba
// "Activar" en Safari, el request fallaba en silencio, y creía que la
// feature estaba rota. Ahora mostramos el hint de instalación primero.
//
// Props:
// - onAllow: pide permiso y suscribe. Debe devolver { ok, reason }.
// - onDismiss: descarta el card (se persiste fuera).
// - error: último reason si el último intento falló.
export default function NotificationPermissionCard({ onAllow, onDismiss, error }) {
  const [iosStatus, setIosStatus] = useState(() => getIOSPushStatus())
  const [iosHintOpen, setIosHintOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState(null)

  // Re-evaluar al montar (por si cambió standalone mientras la pestaña
  // estaba abierta — p.ej. el usuario instaló la app y volvió).
  useEffect(() => { setIosStatus(getIOSPushStatus()) }, [])

  const gate = iosStatus.reason // 'ok' | 'not_ios' | 'ios_too_old' | 'not_installed' | 'no_api'

  const copy = useMemo(() => {
    // iOS < 16.4: no hay nada que hacer del lado de la app.
    if (gate === 'ios_too_old') {
      return {
        title: 'Actualiza tu iPhone para recibir avisos',
        body: 'Las notificaciones push en la web requieren iOS 16.4 o posterior. Revisa Ajustes → General → Actualización de software.',
        primary: null,
        secondary: 'Entendido',
      }
    }
    // iOS OK pero aún no instalado como PWA.
    if (gate === 'not_installed') {
      return {
        title: 'Instala Focus para recibir avisos',
        body: 'En iPhone las notificaciones solo llegan si usas Focus como app. Te guío en 3 pasos.',
        primary: 'Cómo instalarla',
        primaryAction: 'install_hint',
        secondary: 'Ahora no',
      }
    }
    // Permiso rechazado antes (no podemos re-preguntar).
    if (error === 'permission_denied') {
      return {
        title: 'Notificaciones bloqueadas',
        body: iosStatus.isIOS
          ? 'Ve a Ajustes iOS → Notificaciones → Focus y activa "Permitir notificaciones".'
          : 'Tocá el candado 🔒 junto a la URL → Notificaciones → Permitir. Después recarga la página.',
        primary: null,
        secondary: 'Entendido',
      }
    }
    // Errores técnicos post-permiso.
    if (error === 'no_vapid_key') {
      return {
        title: 'Configuración pendiente',
        body: 'Falta configurar la clave VAPID en el servidor. Contacta al admin o revisa el README.',
        primary: null,
        secondary: 'Cerrar',
      }
    }
    if (error === 'sw_register_failed' || error === 'subscribe_failed') {
      return {
        title: 'No pude activar las notificaciones',
        body: 'Hubo un problema técnico registrando tu dispositivo. Reintenta o recarga la página.',
        primary: 'Reintentar',
        primaryAction: 'retry',
        secondary: 'Ahora no',
      }
    }
    // Flujo normal: todo OK, pedimos el permiso.
    return {
      title: '¿Activar recordatorios?',
      body: 'Focus puede avisarte antes de que empiecen tus eventos, aunque la app esté cerrada.',
      primary: 'Activar',
      primaryAction: 'allow',
      secondary: 'Ahora no',
    }
  }, [gate, error, iosStatus.isIOS])

  async function handlePrimary() {
    if (copy.primaryAction === 'install_hint') {
      setIosHintOpen(true)
      return
    }
    if (copy.primaryAction === 'allow' || copy.primaryAction === 'retry') {
      setBusy(true)
      setLocalError(null)
      try {
        const r = await onAllow?.()
        if (r && !r.ok) setLocalError(r.reason)
      } finally {
        setBusy(false)
      }
      return
    }
  }

  const shownError = error || localError

  return (
    <>
      <div className="mx-6 mt-3 mb-1 p-4 rounded-[20px] bg-primary/5 border border-primary/15 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <span
            className="material-symbols-outlined text-primary text-[22px]"
            style={{ fontVariationSettings: "'FILL' 1" }}
            aria-hidden="true"
          >
            notifications
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-headline font-bold text-on-surface text-sm mb-0.5">
            {copy.title}
          </p>
          <p className="text-xs text-on-surface-variant font-medium leading-relaxed mb-3">
            {copy.body}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs font-semibold text-outline hover:text-on-surface transition-colors px-3 py-1.5"
            >
              {copy.secondary}
            </button>
            {copy.primary && (
              <button
                type="button"
                onClick={handlePrimary}
                disabled={busy}
                className="text-xs font-bold text-white bg-primary rounded-full px-4 py-1.5 shadow-sm shadow-primary/20 active:scale-95 transition-all disabled:opacity-50"
              >
                {busy ? 'Activando…' : copy.primary}
              </button>
            )}
          </div>
          {shownError && shownError !== 'permission_denied' && (
            <p role="alert" className="text-[10.5px] text-rose-500 mt-2 leading-snug">
              Detalle técnico: {shownError}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar"
          className="flex-shrink-0 text-outline hover:text-on-surface transition-colors mt-0.5"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Modal de instrucciones iOS (A2HS). Reutiliza el mismo patrón que
          InstallAppCard para que el usuario vea los 3 pasos y, después de
          instalar, pueda volver a abrir la app y pedir el permiso. */}
      <AnimatePresence>
        {iosHintOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIosHintOpen(false)}
              className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm"
              aria-hidden="true"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ios-hint-title"
              initial={{ opacity: 0, y: 30, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="fixed left-1/2 top-1/2 z-[91] w-[min(92vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-2xl"
            >
              <p id="ios-hint-title" className="mb-2 text-center text-[16px] font-bold text-slate-900">
                Instala Focus en iPhone
              </p>
              <p className="mb-4 text-center text-[12px] text-slate-500 leading-snug">
                iOS solo permite recibir avisos desde apps instaladas. Es rápido:
              </p>
              <ol className="space-y-3 text-[13.5px] leading-relaxed text-slate-700">
                <li className="flex gap-2">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">1</span>
                  Toca el botón <span aria-hidden="true" className="material-symbols-outlined mx-0.5 align-middle text-[17px] text-blue-500">ios_share</span> Compartir en Safari.
                </li>
                <li className="flex gap-2">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">2</span>
                  Selecciona <b>Añadir a pantalla de inicio</b>.
                </li>
                <li className="flex gap-2">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">3</span>
                  Abre Focus desde el home y vuelve a tocar <b>Activar</b>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setIosHintOpen(false)}
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

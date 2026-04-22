import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getMicrophonePermission,
  requestMicrophonePermission,
  getCameraPermission,
  requestCameraPermission,
  getNotificationsPermission,
  requestNotificationsPermission,
  watchPermission,
  isIOS,
  isAndroid,
  isStandalone,
  isSafari,
  isIOSSafari,
  hasWorkingSpeechRecognition,
} from '../lib/permissions'

/**
 * PermissionsSection — sección de Ajustes que muestra el estado de micrófono,
 * cámara y notificaciones, y guía al usuario para concederlos.
 *
 * Diseño:
 *   · Una fila por permiso con icono, etiqueta y un chip de estado a la
 *     derecha (verde si está concedido, rojo si está bloqueado, etc.).
 *   · Cuando el permiso puede pedirse desde la app → botón "Permitir".
 *   · Cuando ya fue rechazado o Safari no permite re-preguntar → botón
 *     "Cómo activarlo" que expande instrucciones específicas de la
 *     plataforma (Safari/iPhone, Chrome, etc.).
 *
 * Safari/iOS:
 *   · getUserMedia solo lo pedimos cuando el usuario toca "Permitir". Evita
 *     prompts involuntarios al abrir Ajustes.
 *   · Si permissions.query no existe (Safari viejo), mostramos estado
 *     "Sin verificar" y el botón "Permitir" sirve también como test.
 *   · Para notificaciones en iOS fuera de la app instalada, el estado pasa a
 *     "Requiere instalar Focus" con pasos para añadirla a la pantalla de
 *     inicio.
 */

const STATE_META = {
  granted:          { label: 'Permitido',          tone: 'ok' },
  denied:           { label: 'Bloqueado',          tone: 'err' },
  prompt:           { label: 'Sin conceder',       tone: 'warn' },
  unknown:          { label: 'Sin verificar',      tone: 'warn' },
  unsupported:      { label: 'No disponible',      tone: 'mute' },
  requires_install: { label: 'Requiere instalar',  tone: 'warn' },
}

function StatePill({ state }) {
  const meta = STATE_META[state] || STATE_META.unknown
  const tone = meta.tone
  const cls =
    tone === 'ok'   ? 'bg-emerald-50 text-emerald-700' :
    tone === 'err'  ? 'bg-red-50 text-red-600' :
    tone === 'warn' ? 'bg-amber-50 text-amber-700' :
                      'bg-slate-100 text-slate-500'
  return (
    <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {meta.label}
    </span>
  )
}

function ActionButton({ children, onClick, disabled, variant = 'solid' }) {
  const base = 'text-[12px] font-semibold px-3 py-1.5 rounded-full transition-all active:scale-95 disabled:opacity-40'
  const cls = variant === 'solid'
    ? 'bg-slate-900 text-white hover:bg-slate-800'
    : 'text-primary hover:bg-primary/5'
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${cls}`}>
      {children}
    </button>
  )
}

function HelpBlock({ state, kind }) {
  // Devuelve los pasos para desbloquear manualmente según plataforma y tipo.
  const ios = isIOS()
  const android = isAndroid()
  const safari = isSafari()

  if (state === 'requires_install' && kind === 'notifications') {
    return (
      <>
        <p className="font-semibold text-slate-700 mb-1.5">Para recibir notificaciones en iPhone:</p>
        <ol className="list-decimal pl-4 space-y-1">
          <li>Abre Focus en Safari.</li>
          <li>Toca el icono Compartir (<span className="font-mono">􀈂</span>) en la barra inferior.</li>
          <li>Elige <b>Añadir a pantalla de inicio</b>.</li>
          <li>Abre Focus desde el icono nuevo, no desde Safari.</li>
          <li>Vuelve aquí y toca <b>Permitir</b>.</li>
        </ol>
      </>
    )
  }

  if (kind === 'microphone' || kind === 'camera') {
    const label = kind === 'microphone' ? 'Micrófono' : 'Cámara'
    if (ios || safari) {
      return (
        <>
          <p className="font-semibold text-slate-700 mb-1.5">En iPhone / Safari:</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Abre la app <b>Ajustes</b> del iPhone.</li>
            <li>Busca <b>Safari</b> y entra.</li>
            <li>Entra en <b>{label}</b> y marca <b>Preguntar</b> o <b>Permitir</b>.</li>
            <li>Vuelve a Focus y recarga la pestaña.</li>
          </ol>
          <p className="mt-2 text-slate-500">
            Si usas Focus instalado en la pantalla de inicio, también puedes abrir
            Ajustes del iPhone → <b>Focus</b> y activar el permiso allí.
          </p>
        </>
      )
    }
    if (android) {
      return (
        <>
          <p className="font-semibold text-slate-700 mb-1.5">En Android / Chrome:</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Toca el icono de candado junto a la URL.</li>
            <li>Entra en <b>Permisos</b>.</li>
            <li>Cambia <b>{label}</b> a <b>Permitir</b>.</li>
            <li>Recarga Focus.</li>
          </ol>
          <p className="mt-2 text-slate-500">
            Si tienes Focus instalado, también puedes ir a <b>Ajustes de Android → Apps → Focus → Permisos</b>.
          </p>
        </>
      )
    }
    return (
      <>
        <p className="font-semibold text-slate-700 mb-1.5">En tu navegador:</p>
        <ol className="list-decimal pl-4 space-y-1">
          <li>Toca el icono de candado o información a la izquierda de la URL.</li>
          <li>Busca <b>{label}</b> en la lista de permisos.</li>
          <li>Cámbialo a <b>Permitir</b>.</li>
          <li>Recarga la pestaña.</li>
        </ol>
      </>
    )
  }

  if (kind === 'notifications') {
    if (ios) {
      return (
        <>
          <p className="font-semibold text-slate-700 mb-1.5">En iPhone:</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Abre <b>Ajustes</b> del iPhone.</li>
            <li>Busca <b>Focus</b> en la lista de apps.</li>
            <li>Entra en <b>Notificaciones</b> y actívalas.</li>
          </ol>
        </>
      )
    }
    if (android) {
      return (
        <>
          <p className="font-semibold text-slate-700 mb-1.5">En Android:</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Abre <b>Ajustes</b> de Android.</li>
            <li>Entra en <b>Apps → Focus → Notificaciones</b>.</li>
            <li>Actívalas y vuelve a Focus.</li>
          </ol>
        </>
      )
    }
    return (
      <>
        <p className="font-semibold text-slate-700 mb-1.5">En tu navegador:</p>
        <ol className="list-decimal pl-4 space-y-1">
          <li>Abre los ajustes del sitio (candado junto a la URL).</li>
          <li>Cambia <b>Notificaciones</b> a <b>Permitir</b>.</li>
          <li>Recarga Focus.</li>
        </ol>
      </>
    )
  }

  return null
}

function PermissionRow({ icon, label, description, state, onRequest, kind, busy, footerNote }) {
  const [expanded, setExpanded] = useState(false)
  const canRequest = state === 'prompt' || state === 'unknown'
  const needsManual = state === 'denied' || state === 'requires_install'
  const showHelpToggle = needsManual

  return (
    <div className="border-t border-slate-50 first:border-t-0">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <span
          className="material-symbols-outlined text-[20px] flex-shrink-0 text-slate-400"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold leading-tight text-slate-800 truncate">
            {label}
          </p>
          {description && (
            <p className="text-[11.5px] text-slate-400 mt-0.5 leading-tight">
              {description}
            </p>
          )}
        </div>
        <StatePill state={state} />
      </div>

      {(canRequest || showHelpToggle) && (
        <div className="flex items-center justify-end gap-2 px-5 pb-3 -mt-1">
          {showHelpToggle && (
            <ActionButton variant="ghost" onClick={() => setExpanded(v => !v)}>
              {expanded ? 'Ocultar' : 'Cómo activarlo'}
            </ActionButton>
          )}
          {canRequest && (
            <ActionButton onClick={onRequest} disabled={busy}>
              {busy ? 'Solicitando…' : 'Permitir'}
            </ActionButton>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {expanded && showHelpToggle && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mx-5 mb-4 rounded-xl bg-slate-50 px-3.5 py-3 text-[12px] leading-relaxed text-slate-600">
              <HelpBlock state={state} kind={kind} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {footerNote && (
        <div className="mx-5 mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-amber-800">
          {footerNote}
        </div>
      )}
    </div>
  )
}

export default function PermissionsSection() {
  const [mic, setMic] = useState('unknown')
  const [cam, setCam] = useState('unknown')
  const [notif, setNotif] = useState('unknown')
  const [busy, setBusy] = useState(null) // 'mic' | 'cam' | 'notif' | null
  const [lastError, setLastError] = useState(null)

  const refresh = useCallback(async () => {
    const [m, c] = await Promise.all([
      getMicrophonePermission(),
      getCameraPermission(),
    ])
    setMic(m)
    setCam(c)
    setNotif(getNotificationsPermission())
  }, [])

  useEffect(() => {
    refresh()
    // Cuando el usuario vuelve a la app (por ejemplo tras cambiar permisos
    // en Ajustes del iPhone) refrescamos el estado.
    const onFocus = () => refresh()
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refresh])

  useEffect(() => {
    let cancels = []
    ;(async () => {
      cancels.push(await watchPermission('microphone', s => setMic(s)))
      cancels.push(await watchPermission('camera', s => setCam(s)))
      cancels.push(await watchPermission('notifications', () => setNotif(getNotificationsPermission())))
    })()
    return () => cancels.forEach(fn => fn?.())
  }, [])

  async function handleMic() {
    setBusy('mic'); setLastError(null)
    const r = await requestMicrophonePermission()
    if (!r.ok) {
      if (r.reason === 'no_device') setLastError('No se detectó ningún micrófono en este dispositivo.')
      else if (r.reason === 'unsupported') setLastError('Tu navegador no permite solicitar el micrófono.')
      else if (r.reason === 'denied') {
        // Safari/iOS después de un rechazo no lanza el prompt — hay que
        // resolverlo manualmente. Dejamos el estado en 'denied' para que la
        // fila muestre "Cómo activarlo".
      }
    }
    await refresh()
    setBusy(null)
  }

  async function handleCam() {
    setBusy('cam'); setLastError(null)
    const r = await requestCameraPermission()
    if (!r.ok) {
      if (r.reason === 'no_device') setLastError('No se detectó ninguna cámara en este dispositivo.')
      else if (r.reason === 'unsupported') setLastError('Tu navegador no permite solicitar la cámara.')
    }
    await refresh()
    setBusy(null)
  }

  async function handleNotif() {
    setBusy('notif'); setLastError(null)
    const r = await requestNotificationsPermission()
    if (!r.ok && r.reason === 'requires_install') {
      setLastError('Instala Focus en la pantalla de inicio para activar las notificaciones.')
    }
    await refresh()
    setBusy(null)
  }

  const iosNotInstalled = isIOS() && !isStandalone()
  // En iOS Safari la API Web Speech está presente pero no es fiable: aunque
  // el permiso de micrófono esté concedido, el dictado web no funciona. La
  // app cae al dictado nativo del teclado iOS. Lo comunicamos aquí para que
  // Ajustes no parezca contradecir a Mi Día ("Permitido" pero el botón no
  // dicta).
  const micUsesKeyboardDictation = !hasWorkingSpeechRecognition() && isIOSSafari()
  const micDescription = micUsesKeyboardDictation
    ? 'En iPhone el dictado se hace con el teclado del sistema'
    : 'Dictado con Nova y comandos de voz'

  return (
    <section className="bg-white rounded-[20px] border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 pt-4 pb-1">
        <p className="text-[11px] font-bold text-slate-400">Permisos</p>
        <p className="text-[11.5px] text-slate-400 mt-1 leading-snug">
          Focus usa el micrófono para el dictado, la cámara para leer fotos de
          eventos y las notificaciones para avisarte antes de cada cita.
        </p>
      </div>

      <PermissionRow
        icon="mic"
        label="Micrófono"
        description={micDescription}
        state={mic}
        onRequest={handleMic}
        kind="microphone"
        busy={busy === 'mic'}
        footerNote={micUsesKeyboardDictation ? (
          <>
            Safari en iPhone no permite el dictado web. Cuando pulsas el micrófono
            en la app, se abre el teclado del iPhone; toca el icono de micrófono
            sobre el teclado para dictar. El permiso de micrófono se usa para
            otras funciones de voz.
          </>
        ) : null}
      />

      <PermissionRow
        icon="photo_camera"
        label="Cámara"
        description="Foto de eventos y capturas para Nova"
        state={cam}
        onRequest={handleCam}
        kind="camera"
        busy={busy === 'cam'}
      />

      <PermissionRow
        icon="notifications"
        label="Notificaciones"
        description={iosNotInstalled
          ? 'En iPhone solo funcionan con la app instalada'
          : 'Recordatorios antes de cada evento'}
        state={notif}
        onRequest={handleNotif}
        kind="notifications"
        busy={busy === 'notif'}
      />

      {lastError && (
        <div className="mx-5 mb-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-[12px] font-medium text-red-600">
          {lastError}
        </div>
      )}
    </section>
  )
}

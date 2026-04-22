import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { humanizeAuthError, isValidEmail, isRateLimitError, extractRetryAfterSec } from '../utils/authErrors'
import QRCodeView from './QRCodeView'
import QRScannerSheet from './QRScannerSheet'
import {
  buildQRValue,
  extractUserCodeFromScanned,
  readIncomingPairCode,
  clearIncomingPairCode,
} from '../utils/devicePairing'

const PENDING_KEY  = 'focus_auth_pending'
const COOLDOWN_KEY = 'focus_auth_resend_until'
const DEVICE_KEY   = 'focus_device_pairing'
const PENDING_TTL_MS = 15 * 60 * 1000 // 15 min — tras eso el OTP ya expiró en Supabase
// Supabase por defecto acepta 1 OTP por minuto por email. Alineamos la UI
// a 60s para que el primer reintento no choque con el rate limit del backend.
const RESEND_COOLDOWN_SEC = 60
// Cuando Supabase rechaza por rate-limit, aplicamos un cooldown largo en UI
// para no seguir martillando el endpoint (cada rechazo puede extender el ban).
const RATE_LIMIT_COOLDOWN_SEC = 5 * 60
// Polling cada 1.5s: el rate-limit del endpoint (120/min) deja holgura de sobra
// (40 reqs/min). Antes estaba en 3s y dejaba un gap promedio de 1.5s entre
// "aprobar" y el login real — se sentía pegado.
const DEVICE_POLL_INTERVAL_MS = 1500

function readPending() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.email || !parsed?.ts) return null
    if (Date.now() - parsed.ts > PENDING_TTL_MS) {
      sessionStorage.removeItem(PENDING_KEY)
      return null
    }
    return parsed
  } catch { return null }
}

function writePending(email) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ email, ts: Date.now() })) } catch {}
}

function clearPending() {
  try { sessionStorage.removeItem(PENDING_KEY) } catch {}
}

// Cooldown con timestamp absoluto: sobrevive a cerrar/reabrir modal y a
// recargas. Sin esto, los useState del AuthModal persisten aunque el JSX se
// oculte (el componente raíz nunca se desmonta), y eso hace que el contador
// quede desalineado con la realidad del backend.
function readCooldownSec() {
  try {
    const raw = sessionStorage.getItem(COOLDOWN_KEY)
    if (!raw) return 0
    const until = parseInt(raw, 10)
    if (!Number.isFinite(until)) return 0
    const rest = Math.ceil((until - Date.now()) / 1000)
    if (rest <= 0) {
      sessionStorage.removeItem(COOLDOWN_KEY)
      return 0
    }
    return rest
  } catch { return 0 }
}

function writeCooldownSec(secs) {
  try { sessionStorage.setItem(COOLDOWN_KEY, String(Date.now() + secs * 1000)) } catch {}
}

function clearCooldown() {
  try { sessionStorage.removeItem(COOLDOWN_KEY) } catch {}
}

// Estado del device pairing en curso. Persistimos device_code + user_code +
// expiry en sessionStorage para que cerrar/reabrir el modal (o recargar la
// pestaña) no pierda el pairing en vuelo.
function readDevicePairing() {
  try {
    const raw = sessionStorage.getItem(DEVICE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.device_code || !parsed?.user_code || !parsed?.expires_at) return null
    if (parsed.expires_at < Date.now()) {
      sessionStorage.removeItem(DEVICE_KEY)
      return null
    }
    return parsed
  } catch { return null }
}

function writeDevicePairing(obj) {
  try { sessionStorage.setItem(DEVICE_KEY, JSON.stringify(obj)) } catch {}
}

function clearDevicePairing() {
  try { sessionStorage.removeItem(DEVICE_KEY) } catch {}
}

function formatUserCode(code) {
  if (!code) return ''
  const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (clean.length <= 4) return clean
  return `${clean.slice(0, 4)}-${clean.slice(4)}`
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"
    />
  )
}

export default function AuthModal({ isOpen, onClose }) {
  const {
    signInWithEmail, verifyOtp, user, signOut,
    startDevicePairing, pollDevicePairing, approveDevicePairing, exchangeDeviceToken,
  } = useAuth()

  // Hidratamos el paso desde sessionStorage para que reload no rompa el flujo.
  const initialPending = typeof window !== 'undefined' ? readPending() : null
  const initialDevice  = typeof window !== 'undefined' ? readDevicePairing() : null

  const [email, setEmail]       = useState(initialPending?.email || '')
  const [code, setCode]         = useState('')
  // Pasos:
  //   chooser         — elección entre email y otro dispositivo
  //   email           — pedir email para OTP
  //   code            — verificar OTP
  //   device_wait     — dispositivo nuevo esperando aprobación
  //   device_success  — breve confirmación antes de cerrar
  //   device_approve  — (logged-in) ingresar user_code de otro dispositivo
  //   device_approved — (logged-in) confirmación de aprobación
  const [step, setStep] = useState(() => {
    if (initialPending) return 'code'
    if (initialDevice)  return 'device_wait'
    return 'chooser'
  })
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  // Hidratamos desde sessionStorage: el componente AuthModal nunca se
  // desmonta (AnimatePresence solo oculta el JSX), así que sin esto el
  // cooldown quedaría en 0 tras cerrar y reabrir aunque el backend siga
  // rate-limitando.
  const [resendCooldown, setResendCooldown] = useState(() =>
    typeof window !== 'undefined' ? readCooldownSec() : 0
  )

  // Estado del device pairing en el nuevo dispositivo.
  const [devicePairing, setDevicePairing] = useState(initialDevice)
  const [deviceCountdown, setDeviceCountdown] = useState(0)
  // Subestados del paso device_wait, para mostrar progreso granular y que la UI
  // no parezca congelada entre "detecté la aprobación" y "sesión lista":
  //   waiting     — polling, aún sin aprobar
  //   approved    — el backend marcó approved, estamos a punto de canjear
  //   signing_in  — intercambiando el token_hash por sesión real
  const [deviceStage, setDeviceStage] = useState('waiting')
  // Estado del lado que aprueba (logged-in).
  const [approveCode, setApproveCode]       = useState('')
  const [approvedInfo, setApprovedInfo]     = useState(null)
  // Escáner QR: abierto vía botón "Escanear QR" dentro del step device_approve.
  const [scannerOpen, setScannerOpen] = useState(false)
  // Subestados del botón "Aprobar" para que el botón no quede 1-2s en
  // "Aprobando…" sin feedback:
  //   idle        — sin acción
  //   validating  — acaba de darle click, request en vuelo
  //   approving   — el backend ya respondió validación, generando link
  const [approveStage, setApproveStage] = useState('idle')
  // Banner post rate-limit sugiriendo usar otro dispositivo.
  const [rateLimitHit, setRateLimitHit]     = useState(false)

  // submitLock evita dobles envíos incluso en el mismo tick (antes de re-render)
  const submitLock = useRef(false)
  const codeInputRef = useRef(null)
  const approveInputRef = useRef(null)
  // historyPushedRef: evita apilar múltiples entries al abrir/cerrar varias veces.
  const historyPushedRef = useRef(false)
  // Guardamos el id del polling para cancelarlo al cambiar de paso o cerrar.
  const pollTimerRef = useRef(null)
  // Debounce del auto-submit del OTP: cancela disparos previos si el usuario
  // sigue tipeando/pegando. Evita que un código de 8 dígitos se envíe truncado
  // a Supabase al pasar por la longitud 6 intermedia.
  const autoSubmitTimerRef = useRef(null)

  const emailValid = isValidEmail(email)
  // Aceptamos 6-10 dígitos: Supabase puede entregar 6 (default) u 8 (config
  // del proyecto). La UI no puede asumir un largo fijo o trunca el código.
  const codeValid  = /^\d{6,10}$/.test(code)
  const approveCodeValid = approveCode.replace(/[^A-Z0-9]/gi, '').length === 8

  // Si el usuario verifica con éxito mientras el modal está abierto, cerramos
  // automáticamente — evita que quede atascado en el paso 'code' si el auth
  // context resolvió la sesión (p. ej. desde otra pestaña).
  useEffect(() => {
    if (!isOpen) return
    if (user && (step === 'code' || step === 'device_wait' || step === 'device_success')) {
      clearPending()
      clearDevicePairing()
      handleClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isOpen, step])

  // Autofocus código cuando entramos al paso 'code'.
  useEffect(() => {
    if (step === 'code' && codeInputRef.current) codeInputRef.current.focus()
    if (step === 'device_approve' && approveInputRef.current) approveInputRef.current.focus()
    // Si salimos del paso 'code', cancelamos cualquier auto-submit pendiente.
    if (step !== 'code' && autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current)
      autoSubmitTimerRef.current = null
    }
  }, [step])

  useEffect(() => () => {
    if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current)
  }, [])

  // Cooldown tick para el botón de reenviar.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [resendCooldown])

  // Countdown del device pairing (para mostrar "expira en Xm Ys").
  useEffect(() => {
    if (step !== 'device_wait' || !devicePairing) return
    const tick = () => {
      const rest = Math.max(0, Math.ceil((devicePairing.expires_at - Date.now()) / 1000))
      setDeviceCountdown(rest)
      if (rest === 0) {
        clearDevicePairing()
        setDevicePairing(null)
        setError('El código expiró. Genera uno nuevo.')
        setStep('chooser')
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [step, devicePairing])

  // Polling del device pairing. Se detiene al salir del step o cerrar modal.
  useEffect(() => {
    if (step !== 'device_wait' || !devicePairing?.device_code) return
    let cancelled = false

    async function loop() {
      try {
        const res = await pollDevicePairing(devicePairing.device_code)
        if (cancelled) return
        if (res.status === 'approved' && res.token_hash) {
          // Intercambiamos el token_hash por una sesión real. onAuthStateChange
          // detectará el SIGNED_IN y disparará los flujos post-login.
          setDeviceStage('approved')
          clearDevicePairing()
          try {
            // Pequeño tick para que el stepper alcance a renderizar "Código
            // aprobado" antes de cambiar a "Iniciando sesión" — sin esto, el
            // usuario solo percibe un flash.
            await new Promise((r) => setTimeout(r, 120))
            if (cancelled) return
            setDeviceStage('signing_in')
            await exchangeDeviceToken(res.token_hash)
            if (cancelled) return
            setDevicePairing(null)
            setStep('device_success')
            // Cierre automático en ~900ms para dejar ver el check.
            setTimeout(() => { if (!cancelled) handleClose() }, 900)
          } catch (err) {
            setDeviceStage('waiting')
            setDevicePairing(null)
            setError(humanizeAuthError(err) || 'No pudimos iniciar sesión con ese código.')
            setStep('chooser')
          }
          return
        }
        if (res.status === 'expired' || res.status === 'not_found' || res.status === 'consumed') {
          clearDevicePairing()
          setDevicePairing(null)
          setError(res.status === 'expired'
            ? 'El código expiró. Genera uno nuevo.'
            : 'El código ya no es válido. Genera uno nuevo.')
          setStep('chooser')
          return
        }
        pollTimerRef.current = setTimeout(loop, DEVICE_POLL_INTERVAL_MS)
      } catch (err) {
        if (cancelled) return
        // Si el backend está caído, esperamos un poco más antes de reintentar.
        pollTimerRef.current = setTimeout(loop, DEVICE_POLL_INTERVAL_MS * 2)
      }
    }

    pollTimerRef.current = setTimeout(loop, DEVICE_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, devicePairing?.device_code])

  // Al reabrir el modal, re-hidratamos state desde sessionStorage. Sin esto,
  // si el usuario cerró el modal hace >15 min (TTL del pending ya caducó),
  // al reabrir veríamos step='code' con email viejo en memoria apuntando a
  // un OTP ya expirado — y el botón "Reenviar" pegaría al email equivocado.
  //
  // También detectamos un "incoming pair code" (del URL ?pair=XXXX que levantó
  // App.jsx): si hay uno y el usuario está logueado, saltamos directo a
  // device_approve con el código pre-llenado. Si NO hay sesión, el código
  // queda en sessionStorage y se consumirá tras login.
  useEffect(() => {
    if (!isOpen) return
    const pending = readPending()
    const device  = readDevicePairing()
    const incomingCode = readIncomingPairCode()

    if (user && incomingCode) {
      // Prioridad máxima: aprobar el dispositivo entrante.
      setApproveCode(incomingCode)
      setStep('device_approve')
      clearIncomingPairCode()
    } else if (pending) {
      setEmail(pending.email)
      setStep('code')
    } else if (device) {
      setDevicePairing(device)
      setStep('device_wait')
    } else {
      setStep('chooser')
      setCode('')
    }
    setError(null)
    setRateLimitHit(false)
    setResendCooldown(readCooldownSec())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user])

  // Bloqueo de scroll + Escape + interceptar botón atrás del navegador.
  // El back cierra el modal en vez de salir de la app.
  useEffect(() => {
    if (!isOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Empujamos un entry al history solo una vez por apertura.
    if (!historyPushedRef.current) {
      try { window.history.pushState({ focusAuthModal: true }, '') } catch {}
      historyPushedRef.current = true
    }
    function onPop() { handleClose() }
    function onKey(e) { if (e.key === 'Escape') handleClose() }
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleClose = useCallback(() => {
    setCode('')
    setError(null)
    setRateLimitHit(false)
    submitLock.current = false
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
    // Si hay una entry en el history que empujamos nosotros, la quitamos
    // haciendo history.back — pero solo si la entry está activa. Si el close
    // vino por popstate (back), el browser ya la consumió.
    if (historyPushedRef.current) {
      historyPushedRef.current = false
      try {
        if (window.history.state?.focusAuthModal) window.history.back()
      } catch {}
    }
    // Solo reseteamos email+step si el flujo terminó. Si hay pending (OTP)
    // o device_pairing vivo, preservamos para que reopen continúe.
    const hasPending = !!readPending()
    const hasDevice  = !!readDevicePairing()
    if (!hasPending && !hasDevice) {
      setStep('chooser')
      setEmail('')
      setDevicePairing(null)
      setApproveCode('')
      setApprovedInfo(null)
    }
    onClose?.()
  }, [onClose])

  async function handleSendEmail(e) {
    e?.preventDefault?.()
    if (submitLock.current || loading) return
    if (!emailValid) {
      setError('Ingresa un email válido.')
      return
    }
    // Si hay un cooldown activo (p. ej. el usuario recargó la página tras
    // pedir un OTP), respetarlo sin pegarle al backend.
    const pendingCd = readCooldownSec()
    if (pendingCd > 0) {
      setStep('code')
      setResendCooldown(pendingCd)
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      await signInWithEmail(email)
      writePending(email)
      writeCooldownSec(RESEND_COOLDOWN_SEC)
      setStep('code')
      setResendCooldown(RESEND_COOLDOWN_SEC)
    } catch (err) {
      if (isRateLimitError(err)) {
        const secs = extractRetryAfterSec(err) ?? RATE_LIMIT_COOLDOWN_SEC
        writeCooldownSec(secs)
        setResendCooldown(secs)
        setRateLimitHit(true)
        if (readPending()) setStep('code')
      }
      setError(humanizeAuthError(err))
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }

  async function handleVerify(eOrCode) {
    let cleanCode
    if (typeof eOrCode === 'string') {
      cleanCode = String(eOrCode).replace(/\D/g, '').slice(0, 10)
    } else {
      eOrCode?.preventDefault?.()
      const raw = codeInputRef.current?.value ?? code
      cleanCode = String(raw).replace(/\D/g, '').slice(0, 10)
    }
    if (submitLock.current || loading) return
    if (!/^\d{6,10}$/.test(cleanCode)) {
      setError('Revisa el código de tu correo.')
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      await verifyOtp(email, cleanCode)
      clearPending()
      clearCooldown()
      handleClose()
    } catch (err) {
      setCode('')
      setError(humanizeAuthError(err))
      if (isRateLimitError(err)) setRateLimitHit(true)
      setTimeout(() => codeInputRef.current?.focus(), 50)
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }

  async function handleResend() {
    if (submitLock.current || loading) return
    const liveCd = readCooldownSec()
    if (liveCd > 0) {
      setResendCooldown(liveCd)
      return
    }
    if (!emailValid) {
      setError('Ingresa un email válido para reenviar el código.')
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    setCode('')
    try {
      await signInWithEmail(email)
      writePending(email)
      writeCooldownSec(RESEND_COOLDOWN_SEC)
      setResendCooldown(RESEND_COOLDOWN_SEC)
    } catch (err) {
      if (isRateLimitError(err)) {
        const secs = extractRetryAfterSec(err) ?? RATE_LIMIT_COOLDOWN_SEC
        writeCooldownSec(secs)
        setResendCooldown(secs)
        setRateLimitHit(true)
      }
      setError(humanizeAuthError(err))
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }

  function handleChangeEmail() {
    clearPending()
    clearCooldown()
    setStep('email')
    setCode('')
    setError(null)
    setRateLimitHit(false)
    setResendCooldown(0)
  }

  function handleEmailChange(value) {
    setEmail(value)
    if (error) setError(null)
  }

  function handleCodeChange(rawValue) {
    const cleanCode = String(rawValue).replace(/\D/g, '').slice(0, 10)
    setCode(cleanCode)
    if (error) setError(null)
    // Auto-submit con debounce: dispara solo si el usuario dejó de tipear
    // 350ms y ya hay >=6 dígitos. Sin esto, un código de 8 dígitos pegado
    // se autosubmiteaba al llegar a 6 (truncado) y Supabase lo rechazaba.
    if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current)
    if (cleanCode.length >= 6 && !submitLock.current && !loading) {
      autoSubmitTimerRef.current = setTimeout(() => {
        autoSubmitTimerRef.current = null
        handleVerify(cleanCode)
      }, 350)
    }
  }

  // ── Device pairing: nuevo dispositivo ────────────────────────────────────
  async function handleStartDevice() {
    if (submitLock.current || loading) return
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      const res = await startDevicePairing()
      const expires_at = Date.now() + (res.expires_in || 300) * 1000
      const pairing = {
        device_code: res.device_code,
        user_code: res.user_code,
        expires_at,
      }
      writeDevicePairing(pairing)
      setDevicePairing(pairing)
      setDeviceStage('waiting')
      setStep('device_wait')
    } catch (err) {
      setError('No pudimos generar el código. Prueba de nuevo en un momento.')
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }

  function handleCancelDevice() {
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
    clearDevicePairing()
    setDevicePairing(null)
    setDeviceStage('waiting')
    setStep('chooser')
    setError(null)
  }

  async function handleCopyCode() {
    if (!devicePairing?.user_code) return
    try {
      await navigator.clipboard?.writeText(devicePairing.user_code)
    } catch {}
  }

  // ── Device pairing: lado logueado que aprueba ───────────────────────────
  // Admite un override de código (desde scan QR) para evitar depender del
  // estado approveCode, que puede estar stale cuando el escáner llama
  // inmediatamente después de setApproveCode.
  async function handleApprove(eOrCode) {
    let explicitCode = null
    if (typeof eOrCode === 'string') {
      explicitCode = eOrCode
    } else {
      eOrCode?.preventDefault?.()
    }
    if (submitLock.current || loading) return
    const source = explicitCode ?? approveCode
    const clean = String(source).replace(/[^A-Z0-9]/gi, '').toUpperCase()
    if (clean.length !== 8) {
      setError('El código tiene 8 caracteres.')
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    setApproveStage('validating')
    // A los 400ms, si seguimos en validating, pasamos a "approving". El backend
    // típicamente tarda 1-2s por el generateLink de Supabase. Este tick evita
    // que el usuario vea 2s seguidos del mismo texto "Aprobando…".
    const stageTimer = setTimeout(() => setApproveStage('approving'), 400)
    try {
      const res = await approveDevicePairing(clean)
      setApprovedInfo({ email: res.email, user_agent: res.user_agent })
      setStep('device_approved')
      setApproveCode('')
    } catch (err) {
      const code = err?.status
      if (code === 404) setError('No encontramos ese código. Revisa que esté bien.')
      else if (code === 410) setError('El código expiró. Pide uno nuevo en el otro dispositivo.')
      else if (code === 409) setError('Ese código ya fue usado o ya no es válido.')
      else if (code === 429) setError('Demasiados intentos. Espera un momento.')
      else setError('No pudimos aprobar el código. Prueba de nuevo.')
    } finally {
      clearTimeout(stageTimer)
      setApproveStage('idle')
      setLoading(false)
      submitLock.current = false
    }
  }

  function handleApproveCodeChange(raw) {
    const clean = String(raw).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8)
    setApproveCode(clean)
    if (error) setError(null)
  }

  // Scanner de QR en el lado logueado. El QR escaneado puede ser una URL
  // (con ?pair=XXXX) o texto plano con el código — extractUserCodeFromScanned
  // normaliza ambos casos.
  function handleScanDetected(raw) {
    setScannerOpen(false)
    const userCode = extractUserCodeFromScanned(raw)
    if (!userCode) {
      setError('El QR no contiene un código de vinculación válido.')
      return
    }
    setApproveCode(userCode)
    setError(null)
    // Pequeño delay para que el sheet del scanner termine su animación de
    // salida antes de disparar el submit. Pasamos el código explícitamente
    // para no depender del estado que puede llegar stale al closure.
    setTimeout(() => handleApprove(userCode), 180)
  }

  const userAgentSummary = (ua) => {
    if (!ua) return 'Dispositivo sin identificar'
    const isIOS  = /iPhone|iPad|iPod/i.test(ua)
    const isAnd  = /Android/i.test(ua)
    const isMac  = /Mac OS X/i.test(ua) && !isIOS
    const isWin  = /Windows/i.test(ua)
    const isLin  = /Linux/i.test(ua) && !isAnd
    const browser = /Chrome/i.test(ua) && !/Edg/i.test(ua) ? 'Chrome'
                  : /Safari/i.test(ua) && !/Chrome/i.test(ua) ? 'Safari'
                  : /Firefox/i.test(ua) ? 'Firefox'
                  : /Edg/i.test(ua) ? 'Edge'
                  : 'Navegador'
    const os = isIOS ? 'iPhone/iPad' : isAnd ? 'Android' : isMac ? 'Mac' : isWin ? 'Windows' : isLin ? 'Linux' : 'otro'
    return `${browser} en ${os}`
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/50 z-[80]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Iniciar sesión"
            className="fixed inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 bg-white rounded-t-3xl sm:rounded-3xl z-[81] w-full sm:w-[420px] sm:max-w-[92vw] max-h-[92vh] overflow-y-auto shadow-2xl"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
          >
            <div className="px-5 sm:px-6 pt-5">
              {/* Grip handle visual en mobile */}
              <div className="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" aria-hidden="true" />

              {user ? (
                step === 'device_approve' ? (
                  /* ── Logged-in: aprobar otro dispositivo ─────────────── */
                  <>
                    <div className="flex items-start justify-between gap-3 mb-5">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                          Aprobar otro dispositivo
                        </h2>
                        <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                          Escanea el QR del dispositivo nuevo o escribe su código de 8 caracteres.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setStep('chooser'); setApproveCode(''); setError(null) }}
                        aria-label="Volver"
                        className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                      >
                        <span className="material-symbols-outlined text-slate-400 text-[22px]">arrow_back</span>
                      </button>
                    </div>

                    {/* Botón principal: escanear QR. Debajo, el input manual. */}
                    <button
                      type="button"
                      onClick={() => { setError(null); setScannerOpen(true) }}
                      disabled={loading}
                      className="w-full mb-3 px-4 py-3.5 rounded-2xl bg-primary text-white font-bold text-[14px] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined text-[20px]">qr_code_scanner</span>
                      Escanear QR
                    </button>

                    <div className="flex items-center gap-3 my-3">
                      <div className="flex-1 h-px bg-slate-200" />
                      <span className="text-[11px] text-slate-400 font-semibold tracking-wide">O ESCRIBE EL CÓDIGO</span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>

                    <form onSubmit={handleApprove} noValidate>
                      <input
                        ref={approveInputRef}
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        value={formatUserCode(approveCode)}
                        onChange={(e) => handleApproveCodeChange(e.target.value)}
                        placeholder="ABCD-EFGH"
                        maxLength={9}
                        aria-label="Código de vinculación"
                        aria-invalid={!!error}
                        className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-center text-2xl font-mono tracking-[0.25em] mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 uppercase"
                      />
                      {error && (
                        <p role="alert" className="text-red-500 text-[12.5px] mb-3 text-center leading-snug">
                          {error}
                        </p>
                      )}
                      <button
                        type="submit"
                        disabled={loading || !approveCodeValid}
                        className="w-full py-3.5 bg-primary text-white rounded-2xl text-[14px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                      >
                        {loading
                          ? (
                            <>
                              <Spinner />
                              {approveStage === 'validating' ? 'Validando código…' : 'Aprobando dispositivo…'}
                            </>
                          )
                          : 'Aprobar dispositivo'}
                      </button>
                    </form>
                    <p className="mt-3 text-[11px] text-center text-slate-400 leading-snug">
                      Solo aprueba códigos que tú mismo estés viendo en otro dispositivo.
                    </p>
                  </>
                ) : step === 'device_approved' ? (
                  /* ── Logged-in: confirmación de aprobación ───────────── */
                  <div className="text-center py-2">
                    <span className="material-symbols-outlined text-5xl text-emerald-500 mb-3 block" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    <p className="font-semibold text-slate-800 text-[15px]">Dispositivo aprobado</p>
                    <p className="text-[12.5px] text-slate-500 mt-1 mb-5 leading-snug">
                      {approvedInfo?.user_agent
                        ? `${userAgentSummary(approvedInfo.user_agent)} ya puede iniciar sesión.`
                        : 'El otro dispositivo ya puede iniciar sesión.'}
                    </p>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-semibold active:scale-[0.98] transition-transform"
                    >
                      Listo
                    </button>
                  </div>
                ) : (
                  /* ── Logged in ─────────────────────────────────────── */
                  <div className="py-2">
                    <div className="text-center">
                      <span className="material-symbols-outlined text-5xl text-primary mb-3 block" style={{ fontVariationSettings: "'FILL' 1" }}>account_circle</span>
                      <p className="text-[13px] text-slate-500 mb-1">Sesión activa</p>
                      <p className="font-semibold text-slate-800 mb-5 break-all">{user.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setApproveCode(''); setError(null); setStep('device_approve') }}
                      className="w-full py-3 bg-slate-900 text-white rounded-2xl text-sm font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-2 mb-3"
                    >
                      <span className="material-symbols-outlined text-[18px]">devices</span>
                      Vincular otro dispositivo
                    </button>
                    <button
                      type="button"
                      onClick={() => { signOut(); handleClose() }}
                      className="w-full py-3 bg-red-50 text-red-600 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-transform"
                    >
                      Cerrar sesión
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="mt-3 w-full py-3 bg-slate-100 rounded-2xl text-sm active:scale-[0.98] transition-transform"
                    >
                      Cancelar
                    </button>
                  </div>
                )
              ) : step === 'chooser' ? (
                /* ── Chooser: elegir método ──────────────────────────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Inicia sesión
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        Elige cómo quieres entrar.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClose}
                      aria-label="Cerrar"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                    >
                      <span className="material-symbols-outlined text-slate-400 text-[22px]">close</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-5">
                    {[
                      { icon: 'sync',       label: 'Sincroniza tus datos' },
                      { icon: 'cloud_done', label: 'Respaldo en la nube' },
                      { icon: 'devices',    label: 'Desde cualquier lugar' },
                    ].map(({ icon, label }) => (
                      <div key={icon} className="flex flex-col items-center gap-1.5 px-1.5 py-3 bg-slate-50 rounded-2xl">
                        <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>
                        <span className="text-[10.5px] text-center text-slate-500 leading-tight">{label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => { setStep('email'); setError(null) }}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99] transition-all flex items-center gap-3 text-left"
                    >
                      <span className="material-symbols-outlined text-primary text-[22px] flex-shrink-0">mail</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-slate-800">Continuar con email</p>
                        <p className="text-[11.5px] text-slate-500 leading-snug">Te enviamos un código por correo.</p>
                      </div>
                      <span className="material-symbols-outlined text-slate-300 text-[20px]">chevron_right</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleStartDevice}
                      disabled={loading}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99] transition-all flex items-center gap-3 text-left disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-primary text-[22px] flex-shrink-0">devices</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-slate-800">Iniciar sesión desde otro dispositivo</p>
                        <p className="text-[11.5px] text-slate-500 leading-snug">Apruébalo desde donde ya tienes sesión.</p>
                      </div>
                      {loading
                        ? <Spinner />
                        : <span className="material-symbols-outlined text-slate-300 text-[20px]">chevron_right</span>}
                    </button>
                  </div>

                  {error && (
                    <p role="alert" className="text-red-500 text-[12.5px] mt-3 leading-snug">
                      {error}
                    </p>
                  )}

                  <p className="mt-4 text-[11px] text-center text-slate-400 leading-snug">
                    Al continuar aceptas que usemos tu email solo para autenticación.
                  </p>
                </>
              ) : step === 'device_wait' ? (
                /* ── Nuevo dispositivo: esperando aprobación ──────────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Apruébalo desde otro dispositivo
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        Abre Focus donde ya tienes sesión e ingresa este código.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClose}
                      aria-label="Cerrar"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                    >
                      <span className="material-symbols-outlined text-slate-400 text-[22px]">close</span>
                    </button>
                  </div>

                  {/* Escanea este QR desde el dispositivo ya logueado. El
                      payload es una URL con ?pair=CODE para que también
                      funcione con la cámara nativa del sistema (abre la PWA
                      con el código prellenado). */}
                  {devicePairing?.user_code && (
                    <div className="flex flex-col items-center gap-3 mb-4">
                      <QRCodeView
                        size={208}
                        value={buildQRValue(
                          devicePairing.user_code,
                          typeof window !== 'undefined' ? window.location.origin : '',
                        )}
                      />
                      <p className="text-[11px] text-slate-400 text-center leading-snug max-w-[280px]">
                        Apunta la cámara desde el otro dispositivo, o escribe el código manualmente.
                      </p>
                    </div>
                  )}

                  <div className="bg-slate-50 rounded-3xl p-4 mb-4 text-center">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">O este código</p>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="text-[28px] sm:text-[32px] font-mono font-bold tracking-[0.18em] text-slate-900 active:scale-95 transition-transform"
                      aria-label="Copiar código"
                    >
                      {formatUserCode(devicePairing?.user_code)}
                    </button>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Toca el código para copiarlo
                    </p>
                  </div>

                  {deviceStage === 'waiting' ? (
                    <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-2xl mb-4">
                      <span className="material-symbols-outlined text-primary text-[20px] flex-shrink-0 animate-pulse">timer</span>
                      <p className="text-[12px] text-slate-600 leading-snug">
                        {deviceCountdown > 0
                          ? `Expira en ${Math.floor(deviceCountdown/60)}m ${String(deviceCountdown%60).padStart(2,'0')}s. Esperando aprobación…`
                          : 'Expira en unos segundos…'}
                      </p>
                    </div>
                  ) : (
                    <ol className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-2xl mb-4 space-y-1.5" aria-live="polite">
                      {[
                        { key: 'approved',   label: 'Código aprobado' },
                        { key: 'signing_in', label: 'Iniciando sesión' },
                        { key: 'done',       label: 'Listo' },
                      ].map((s, i, arr) => {
                        const order = arr.findIndex((x) => x.key === deviceStage)
                        const done    = i < order
                        const current = i === order
                        return (
                          <li key={s.key} className="flex items-center gap-2 text-[12.5px] leading-snug">
                            {done ? (
                              <span className="material-symbols-outlined text-emerald-500 text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                            ) : current ? (
                              <Spinner />
                            ) : (
                              <span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200" aria-hidden="true" />
                            )}
                            <span className={current ? 'text-slate-800 font-semibold' : done ? 'text-slate-600' : 'text-slate-400'}>
                              {s.label}
                            </span>
                          </li>
                        )
                      })}
                    </ol>
                  )}

                  {deviceStage === 'waiting' && (
                    <>
                      <ol className="text-[12.5px] text-slate-600 space-y-1.5 mb-5 list-decimal list-inside leading-snug">
                        <li>Abre Focus en el dispositivo donde ya iniciaste sesión.</li>
                        <li>Toca tu avatar o entra a tu cuenta.</li>
                        <li>Elige <span className="font-semibold text-slate-800">Vincular otro dispositivo</span>.</li>
                        <li>Escanea el QR de arriba o escribe el código.</li>
                      </ol>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCancelDevice}
                          className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-2xl text-[13px] font-semibold active:scale-[0.98] transition-transform"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => { setStep('email'); setError(null) }}
                          className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl text-[13px] font-semibold active:scale-[0.98] transition-transform"
                        >
                          Usar email
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : step === 'device_success' ? (
                <div className="text-center py-6">
                  <span className="material-symbols-outlined text-6xl text-emerald-500 mb-3 block" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <p className="font-semibold text-slate-800 text-[16px]">¡Sesión iniciada!</p>
                  <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">Ya puedes usar Focus en este dispositivo.</p>
                </div>
              ) : step === 'code' ? (
                /* ── Verificar código OTP ─────────────────────────────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Revisa tu correo
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        Te enviamos un código a{' '}
                        <strong className="text-slate-700 break-all">{email}</strong>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClose}
                      aria-label="Cerrar"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                    >
                      <span className="material-symbols-outlined text-slate-400 text-[22px]">close</span>
                    </button>
                  </div>

                  <div className="flex items-start gap-2 p-3 bg-primary/5 rounded-2xl mb-5">
                    <span className="material-symbols-outlined text-primary text-[20px] flex-shrink-0 mt-0.5">mark_email_read</span>
                    <p className="text-[12px] text-slate-600 leading-snug">
                      Busca el código en tu bandeja (revisa spam si no aparece en 1 minuto).
                    </p>
                  </div>

                  <form onSubmit={handleVerify} noValidate>
                    <input
                      ref={codeInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => handleCodeChange(e.target.value)}
                      onPaste={(e) => {
                        // Capturamos el texto del clipboard y lo procesamos directo.
                        // Sin esto, un código pegado con espacios o guiones podía
                        // cargarse parcial antes de que el onChange limpiara.
                        const pasted = e.clipboardData?.getData('text') ?? ''
                        if (pasted) {
                          e.preventDefault()
                          handleCodeChange(pasted)
                        }
                      }}
                      placeholder="Pega o escribe el código"
                      maxLength={10}
                      aria-label="Código de tu correo"
                      aria-invalid={!!error}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-center text-2xl font-mono tracking-[0.25em] mb-3 placeholder:text-[13px] placeholder:tracking-normal placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
                    />
                    {error && (
                      <p role="alert" className="text-red-500 text-[12.5px] mb-3 text-center leading-snug">
                        {error}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={loading || !codeValid}
                      className="w-full py-3.5 bg-primary text-white rounded-2xl text-[14px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      {loading ? (<><Spinner /> Verificando…</>) : 'Entrar'}
                    </button>
                  </form>

                  {rateLimitHit && (
                    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl">
                      <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-amber-600 text-[20px] flex-shrink-0 mt-0.5">lightbulb</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] font-semibold text-amber-900 leading-snug">
                            ¿Ya tienes sesión en otro dispositivo?
                          </p>
                          <p className="text-[11.5px] text-amber-800 mt-0.5 leading-snug">
                            Apruébalo desde ahí. Es más rápido y no depende del correo.
                          </p>
                          <button
                            type="button"
                            onClick={handleStartDevice}
                            disabled={loading}
                            className="mt-2 w-full py-2 bg-amber-900 text-white rounded-xl text-[12.5px] font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-[16px]">devices</span>
                            Iniciar sesión desde otro dispositivo
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between text-[12px] gap-3">
                    <button
                      type="button"
                      onClick={handleChangeEmail}
                      disabled={loading}
                      className="text-slate-500 hover:text-slate-800 font-semibold disabled:opacity-40"
                    >
                      ← Cambiar email
                    </button>
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={loading || resendCooldown > 0}
                      className="text-primary hover:underline font-semibold disabled:opacity-40 disabled:no-underline"
                    >
                      {resendCooldown > 0 ? `Reenviar en ${resendCooldown}s` : 'Reenviar código'}
                    </button>
                  </div>
                </>
              ) : (
                /* ── Pedir código (step 'email') ─────────────────────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Continuar con email
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        Sin contraseña. Te enviamos un código por correo.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setStep('chooser'); setError(null); setRateLimitHit(false) }}
                      aria-label="Volver"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                    >
                      <span className="material-symbols-outlined text-slate-400 text-[22px]">arrow_back</span>
                    </button>
                  </div>

                  <form onSubmit={handleSendEmail} noValidate>
                    <label htmlFor="auth-email" className="sr-only">Email</label>
                    <input
                      id="auth-email"
                      type="email"
                      inputMode="email"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      value={email}
                      onChange={(e) => handleEmailChange(e.target.value)}
                      placeholder="tu@email.com"
                      required
                      autoComplete="email"
                      aria-invalid={!!error}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-[15px] mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
                    />
                    {error && (
                      <p role="alert" className="text-red-500 text-[12.5px] mb-3 leading-snug">
                        {error}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={loading || !emailValid}
                      className="w-full py-3.5 bg-primary text-white rounded-2xl text-[14px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      {loading ? (<><Spinner /> Enviando…</>) : 'Enviar código'}
                    </button>
                  </form>

                  {rateLimitHit && (
                    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl">
                      <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-amber-600 text-[20px] flex-shrink-0 mt-0.5">lightbulb</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] font-semibold text-amber-900 leading-snug">
                            Prueba con otro dispositivo
                          </p>
                          <p className="text-[11.5px] text-amber-800 mt-0.5 leading-snug">
                            Si ya iniciaste sesión en otro lado, apruébalo desde ahí sin depender del correo.
                          </p>
                          <button
                            type="button"
                            onClick={handleStartDevice}
                            disabled={loading}
                            className="mt-2 w-full py-2 bg-amber-900 text-white rounded-xl text-[12.5px] font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-[16px]">devices</span>
                            Iniciar sesión desde otro dispositivo
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <p className="mt-3 text-[11px] text-center text-slate-400 leading-snug">
                    Al continuar aceptas que usemos tu email solo para autenticación.
                  </p>
                </>
              )}
            </div>
          </motion.div>

          {/* Scanner QR — se monta fuera de la card del modal para ocupar la
              pantalla completa. Su overlay incluye el cierre. */}
          <QRScannerSheet
            isOpen={scannerOpen}
            onDetect={handleScanDetected}
            onClose={() => setScannerOpen(false)}
          />
        </>
      )}
    </AnimatePresence>
  )
}

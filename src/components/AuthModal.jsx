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
const PENDING_TTL_MS = 15 * 60 * 1000 // 15 min — tras eso el OTP ya expiró en Supabase
// Supabase por defecto acepta 1 OTP por minuto por email. Alineamos la UI
// a 60s para que el primer reintento no choque con el rate limit del backend.
const RESEND_COOLDOWN_SEC = 60
// Cuando Supabase rechaza por rate-limit, aplicamos un cooldown largo en UI
// para no seguir martillando el endpoint (cada rechazo puede extender el ban).
const RATE_LIMIT_COOLDOWN_SEC = 5 * 60

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
    signInWithPassword, signUpWithPassword,
    startDevicePairing, claimDevicePairing, exchangeDeviceToken,
  } = useAuth()

  // Hidratamos el paso desde sessionStorage para que reload no rompa el flujo.
  const initialPending = typeof window !== 'undefined' ? readPending() : null

  const [email, setEmail]       = useState(initialPending?.email || '')
  const [code, setCode]         = useState('')
  // Pasos:
  //   chooser         — elección entre email-OTP, email+contraseña y QR
  //   email           — pedir email para OTP
  //   code            — verificar OTP
  //   password        — login/registro con email + contraseña
  //   device_scan     — (sin sesión) escanear/tipear código para entrar
  //   device_show     — (logueado) mostrar QR para que otro dispositivo entre
  //   device_success  — breve confirmación antes de cerrar
  const [step, setStep] = useState(() => {
    if (initialPending) return 'code'
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

  // ── Lado logueado: pairing generado + countdown de expiración. No
  // persistimos en sessionStorage porque el user_code vive 5 min y lo
  // regeneramos al reabrir; si guardáramos y el usuario volviera 4 min
  // después veríamos un QR casi vencido sin un refresh natural.
  const [sharePairing, setSharePairing] = useState(null) // { user_code, expires_at }
  const [shareCountdown, setShareCountdown] = useState(0)

  // ── Lado nuevo dispositivo: código que el usuario tipea o escanea.
  const [claimCode, setClaimCode] = useState('')
  // Subestados del claim para mostrar feedback granular:
  //   idle       — nada en curso
  //   claiming   — request al backend en vuelo
  //   signing_in — ya tenemos token_hash, canjeando por sesión
  const [claimStage, setClaimStage] = useState('idle')

  // Escáner QR (lado nuevo dispositivo).
  const [scannerOpen, setScannerOpen] = useState(false)
  // Banner post rate-limit sugiriendo usar otro dispositivo.
  const [rateLimitHit, setRateLimitHit] = useState(false)

  // ── Lado password (signin/signup) ───────────────────────────────────────
  // Mismo paso 'password' sirve para entrar o crear cuenta. El toggle al pie
  // alterna el modo sin desmontar el form.
  const [password, setPassword] = useState('')
  const [passwordMode, setPasswordMode] = useState('signin') // 'signin' | 'signup'
  const [showPassword, setShowPassword] = useState(false)
  // Cuando el proyecto Supabase tiene email-confirmation activado, signUp
  // devuelve session=null y el usuario debe abrir el link del correo. En ese
  // caso mostramos un mensaje en lugar del form, sin cerrar el modal.
  const [signupSuccess, setSignupSuccess] = useState(false)

  // submitLock evita dobles envíos incluso en el mismo tick (antes de re-render)
  const submitLock = useRef(false)
  const codeInputRef = useRef(null)
  const claimInputRef = useRef(null)
  // historyPushedRef: evita apilar múltiples entries al abrir/cerrar varias veces.
  const historyPushedRef = useRef(false)
  // Debounce del auto-submit del OTP: cancela disparos previos si el usuario
  // sigue tipeando/pegando. Evita que un código de 8 dígitos se envíe truncado
  // a Supabase al pasar por la longitud 6 intermedia.
  const autoSubmitTimerRef = useRef(null)

  const emailValid = isValidEmail(email)
  // Aceptamos 6-10 dígitos: Supabase puede entregar 6 (default) u 8 (config
  // del proyecto). La UI no puede asumir un largo fijo o trunca el código.
  const codeValid  = /^\d{6,10}$/.test(code)
  const claimCodeValid = claimCode.replace(/[^A-Z0-9]/gi, '').length === 8

  const handleClose = useCallback(() => {
    setCode('')
    setError(null)
    setRateLimitHit(false)
    submitLock.current = false
    // Si hay una entry en el history que empujamos nosotros, la quitamos
    // haciendo history.back — pero solo si la entry está activa. Si el close
    // vino por popstate (back), el browser ya la consumió.
    if (historyPushedRef.current) {
      historyPushedRef.current = false
      try {
        if (window.history.state?.focusAuthModal) window.history.back()
      } catch {}
    }
    // Solo reseteamos email+step si el flujo terminó. Si hay pending (OTP),
    // preservamos para que reopen continúe.
    const hasPending = !!readPending()
    if (!hasPending) {
      setStep('chooser')
      setEmail('')
      setClaimCode('')
      setSharePairing(null)
      setClaimStage('idle')
    }
    onClose?.()
  }, [onClose])

  // Si el usuario verifica con éxito mientras el modal está abierto, cerramos
  // automáticamente — evita que quede atascado en el paso 'code' si el auth
  // context resolvió la sesión (p. ej. desde otra pestaña).
  useEffect(() => {
    if (!isOpen) return
    if (user && (step === 'code' || step === 'device_scan' || step === 'device_success')) {
      clearPending()
      handleClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isOpen, step])

  // Autofocus código cuando entramos al paso 'code' o 'device_scan'.
  useEffect(() => {
    if (step === 'code' && codeInputRef.current) codeInputRef.current.focus()
    if (step === 'device_scan' && claimInputRef.current) claimInputRef.current.focus()
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

  // Countdown del share del dispositivo logueado. Al llegar a 0, limpiamos el
  // QR y pedimos al usuario generar uno nuevo (el token_hash detrás ya expiró).
  useEffect(() => {
    if (step !== 'device_show' || !sharePairing?.expires_at) return
    const tick = () => {
      const rest = Math.max(0, Math.ceil((sharePairing.expires_at - Date.now()) / 1000))
      setShareCountdown(rest)
      if (rest === 0) {
        setSharePairing(null)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [step, sharePairing])

  // Al entrar al paso device_show sin pairing vivo, generamos uno. Esto cubre
  // (a) la apertura inicial, (b) post-expiración cuando el countdown lo borró.
  const handleStartShare = useCallback(async () => {
    if (submitLock.current) return
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      const res = await startDevicePairing()
      setSharePairing({
        user_code: res.user_code,
        expires_at: Date.now() + (res.expires_in || 300) * 1000,
      })
    } catch (err) {
      // Mensajes específicos por reason para que el usuario sepa si es un
      // problema de sesión, red, backend o timeout — no todo "error genérico".
      const reason = err?.reason || ''
      if (reason === 'no_session' || reason === 'supabase_not_configured') {
        setError('No hay sesión activa en este dispositivo. Inicia sesión antes de vincular otro.')
      } else if (reason === 'session_timeout') {
        setError('Tu sesión tardó en responder. Reintenta en unos segundos.')
      } else if (reason === 'backend_timeout') {
        setError('La generación del QR tardó demasiado. Reintenta en un momento.')
      } else if (reason === 'network_error') {
        setError('No se pudo contactar al servidor. Revisa la conexión y reintenta.')
      } else if (reason === 'invalid_user_code') {
        setError('El servidor respondió con un código inválido. Reintenta — si persiste, avísanos.')
      } else if (err?.status === 401 || reason === 'unauthorized') {
        setError('Tu sesión expiró. Cierra sesión y vuelve a entrar antes de vincular.')
      } else {
        setError('No pudimos generar el código de vinculación. Prueba de nuevo en un momento.')
      }
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }, [startDevicePairing])

  useEffect(() => {
    if (step !== 'device_show') return
    if (sharePairing || loading) return
    handleStartShare()
  }, [step, sharePairing, loading, handleStartShare])

  // Canjear user_code → token_hash → sesión. Admite override explícito para
  // evitar depender del estado claimCode cuando lo disparamos tras un scan.
  const handleClaim = useCallback(async (explicit) => {
    if (submitLock.current || loading) return
    const source = typeof explicit === 'string' ? explicit : claimCode
    const clean = String(source).replace(/[^A-Z0-9]/gi, '').toUpperCase()
    if (clean.length !== 8) {
      setError('El código tiene 8 caracteres.')
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    setClaimStage('claiming')
    try {
      const { token_hash } = await claimDevicePairing(clean)
      setClaimStage('signing_in')
      await exchangeDeviceToken(token_hash)
      setStep('device_success')
      // Cierre automático en ~900ms para dejar ver el check.
      setTimeout(() => handleClose(), 900)
    } catch (err) {
      setClaimStage('idle')
      const st = err?.status
      if (st === 404) setError('No encontramos ese código. Revisa que esté bien.')
      else if (st === 410) setError('El código expiró. Pide uno nuevo en el otro dispositivo.')
      else if (st === 409) setError('Ese código ya fue usado.')
      else if (st === 429) setError('Demasiados intentos. Espera un momento.')
      else setError(humanizeAuthError(err) || 'No pudimos iniciar sesión con ese código.')
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }, [claimCode, claimDevicePairing, exchangeDeviceToken, handleClose, loading])

  // Al reabrir el modal, re-hidratamos state desde sessionStorage. Sin esto,
  // si el usuario cerró el modal hace >15 min (TTL del pending ya caducó),
  // al reabrir veríamos step='code' con email viejo en memoria apuntando a
  // un OTP ya expirado — y el botón "Reenviar" pegaría al email equivocado.
  //
  // También detectamos un "incoming pair code" (del URL ?pair=XXXX que levantó
  // App.jsx): si llegó y NO hay sesión, saltamos a device_scan y auto-canjeamos.
  // Si hay sesión, ignoramos — el QR es para dispositivos nuevos, no para
  // reusar en el mismo dispositivo.
  useEffect(() => {
    if (!isOpen) return
    const pending = readPending()
    const incomingCode = readIncomingPairCode()

    if (!user && incomingCode) {
      setClaimCode(incomingCode)
      setStep('device_scan')
      clearIncomingPairCode()
    } else if (user && incomingCode) {
      // Sin uso para un usuario logueado: lo limpiamos para que no quede pegado.
      clearIncomingPairCode()
      setStep('chooser')
    } else if (pending) {
      setEmail(pending.email)
      setStep('code')
    } else {
      setStep('chooser')
      setCode('')
    }
    setError(null)
    setRateLimitHit(false)
    setResendCooldown(readCooldownSec())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user])

  // Si llegamos a device_scan con un code pre-seteado (desde ?pair=), auto-claim.
  useEffect(() => {
    if (step !== 'device_scan') return
    if (!claimCodeValid) return
    if (submitLock.current || loading || claimStage !== 'idle') return
    handleClaim(claimCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, claimCode])

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

  async function handlePasswordSubmit(e) {
    e?.preventDefault?.()
    if (submitLock.current || loading) return
    if (!emailValid) {
      setError('Ingresa un email válido.')
      return
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      if (passwordMode === 'signup') {
        const { session } = await signUpWithPassword(email, password)
        if (!session) {
          // Email confirmation activado en Supabase: no hay sesión todavía.
          // Mostramos el mensaje "revisa tu correo" sin cerrar el modal.
          setSignupSuccess(true)
          setPassword('')
          return
        }
      } else {
        await signInWithPassword(email, password)
      }
      // SIGNED_IN dispara onAuthStateChange en AuthContext, que maneja la
      // limpieza de caché global y el flush de cola. Solo cerramos el modal.
      setPassword('')
      handleClose()
    } catch (err) {
      setError(humanizeAuthError(err))
    } finally {
      setLoading(false)
      submitLock.current = false
    }
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

  function handleClaimCodeChange(raw) {
    const clean = String(raw).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8)
    setClaimCode(clean)
    if (error) setError(null)
  }

  async function handleCopyShare() {
    if (!sharePairing?.user_code) return
    try {
      await navigator.clipboard?.writeText(sharePairing.user_code)
    } catch {}
  }

  // Scanner de QR (nuevo dispositivo). El QR puede ser URL con ?pair=XXX o
  // el código pelado — extractUserCodeFromScanned normaliza ambos.
  function handleScanDetected(raw) {
    setScannerOpen(false)
    const userCode = extractUserCodeFromScanned(raw)
    if (!userCode) {
      setError('El QR no contiene un código de vinculación válido.')
      return
    }
    setClaimCode(userCode)
    setError(null)
    // Pequeño delay para que el sheet del scanner termine su animación de
    // salida antes de disparar el submit.
    setTimeout(() => handleClaim(userCode), 180)
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
                step === 'device_show' ? (
                  /* ── Logged-in: mostrar QR para que otro dispositivo entre ── */
                  <>
                    <div className="flex items-start justify-between gap-3 mb-5">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                          Vincular otro dispositivo
                        </h2>
                        <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                          Escanea este QR desde el dispositivo nuevo, o dicta el código.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSharePairing(null); setStep('chooser'); setError(null) }}
                        aria-label="Volver"
                        className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                      >
                        <span className="material-symbols-outlined text-slate-400 text-[22px]">arrow_back</span>
                      </button>
                    </div>

                    {sharePairing?.user_code ? (
                      <>
                        <div className="flex flex-col items-center gap-3 mb-4">
                          <QRCodeView
                            size={232}
                            value={buildQRValue(
                              sharePairing.user_code,
                              typeof window !== 'undefined' ? window.location.origin : '',
                            )}
                          />
                          <p className="text-[11px] text-slate-400 text-center leading-snug max-w-[280px]">
                            Apunta la cámara del otro dispositivo al QR.
                          </p>
                        </div>

                        <div className="bg-slate-50 rounded-3xl p-4 mb-4 text-center">
                          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">O este código</p>
                          <button
                            type="button"
                            onClick={handleCopyShare}
                            className="text-[28px] sm:text-[32px] font-mono font-bold tracking-[0.18em] text-slate-900 active:scale-95 transition-transform"
                            aria-label="Copiar código"
                          >
                            {formatUserCode(sharePairing.user_code)}
                          </button>
                          <p className="text-[11px] text-slate-400 mt-2">
                            Toca el código para copiarlo
                          </p>
                        </div>

                        <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-2xl mb-4">
                          <span className="material-symbols-outlined text-primary text-[20px] flex-shrink-0 animate-pulse">timer</span>
                          <p className="text-[12px] text-slate-600 leading-snug">
                            {shareCountdown > 0
                              ? `Expira en ${Math.floor(shareCountdown/60)}m ${String(shareCountdown%60).padStart(2,'0')}s. Esperando al otro dispositivo…`
                              : 'Expira en unos segundos…'}
                          </p>
                        </div>

                        <p className="text-[11px] text-center text-slate-400 leading-snug">
                          Solo comparte este QR con un dispositivo tuyo.
                        </p>
                      </>
                    ) : (
                      <div className="py-10 flex flex-col items-center gap-3">
                        {loading ? (
                          <>
                            <Spinner />
                            <p className="text-[12.5px] text-slate-500">Generando QR seguro…</p>
                          </>
                        ) : error ? (
                          <>
                            <p className="text-[12.5px] text-red-500 text-center leading-snug">{error}</p>
                            <button
                              type="button"
                              onClick={handleStartShare}
                              className="mt-2 px-4 py-2 bg-primary text-white rounded-xl text-[13px] font-semibold active:scale-[0.98] transition-transform"
                            >
                              Reintentar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={handleStartShare}
                            className="px-4 py-2.5 bg-primary text-white rounded-xl text-[13px] font-semibold active:scale-[0.98] transition-transform"
                          >
                            Generar QR nuevo
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  /* ── Logged in: menú principal ─────────────────────── */
                  <div className="py-2">
                    <div className="text-center">
                      <span className="material-symbols-outlined text-5xl text-primary mb-3 block" style={{ fontVariationSettings: "'FILL' 1" }}>account_circle</span>
                      <p className="text-[13px] text-slate-500 mb-1">Sesión activa</p>
                      <p className="font-semibold text-slate-800 mb-5 break-all">{user.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setError(null); setSharePairing(null); setStep('device_show') }}
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
                      onClick={() => { setStep('password'); setError(null); setPasswordMode('signin'); setSignupSuccess(false) }}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99] transition-all flex items-center gap-3 text-left"
                    >
                      <span className="material-symbols-outlined text-primary text-[22px] flex-shrink-0">lock</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-slate-800">Email y contraseña</p>
                        <p className="text-[11.5px] text-slate-500 leading-snug">Inicia sesión o crea una cuenta.</p>
                      </div>
                      <span className="material-symbols-outlined text-slate-300 text-[20px]">chevron_right</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setStep('email'); setError(null) }}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99] transition-all flex items-center gap-3 text-left"
                    >
                      <span className="material-symbols-outlined text-primary text-[22px] flex-shrink-0">mail</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-slate-800">Código por email</p>
                        <p className="text-[11.5px] text-slate-500 leading-snug">Sin contraseña. Te enviamos un código por correo.</p>
                      </div>
                      <span className="material-symbols-outlined text-slate-300 text-[20px]">chevron_right</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setClaimCode(''); setError(null); setStep('device_scan') }}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99] transition-all flex items-center gap-3 text-left"
                    >
                      <span className="material-symbols-outlined text-primary text-[22px] flex-shrink-0">qr_code_scanner</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-slate-800">Entrar con QR de otro dispositivo</p>
                        <p className="text-[11.5px] text-slate-500 leading-snug">Escanea el código de donde ya tienes sesión.</p>
                      </div>
                      <span className="material-symbols-outlined text-slate-300 text-[20px]">chevron_right</span>
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
              ) : step === 'password' ? (
                /* ── Email + contraseña (signin/signup) ────────────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        {passwordMode === 'signup' ? 'Crear cuenta' : 'Iniciar sesión'}
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        {passwordMode === 'signup'
                          ? 'Usa tu email y elige una contraseña.'
                          : 'Con tu email y contraseña.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStep('chooser')
                        setError(null)
                        setPassword('')
                        setShowPassword(false)
                        setSignupSuccess(false)
                      }}
                      aria-label="Volver"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                    >
                      <span className="material-symbols-outlined text-slate-400 text-[22px]">arrow_back</span>
                    </button>
                  </div>

                  {signupSuccess ? (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center">
                      <span
                        className="material-symbols-outlined text-emerald-600 text-[32px]"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        mark_email_read
                      </span>
                      <p className="text-[13px] font-bold text-emerald-900 mt-2">Revisa tu correo</p>
                      <p className="text-[12px] text-emerald-800 mt-1 leading-snug">
                        Te enviamos un enlace a <span className="font-semibold break-all">{email}</span> para confirmar tu cuenta. Tras confirmar, vuelve aquí e inicia sesión.
                      </p>
                      <button
                        type="button"
                        onClick={() => { setSignupSuccess(false); setPasswordMode('signin'); setError(null) }}
                        className="mt-3 text-primary text-[12.5px] font-semibold hover:underline"
                      >
                        Iniciar sesión
                      </button>
                    </div>
                  ) : (
                    <>
                      <form onSubmit={handlePasswordSubmit} noValidate>
                        <label htmlFor="auth-pw-email" className="sr-only">Email</label>
                        <input
                          id="auth-pw-email"
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

                        <label htmlFor="auth-pw-input" className="sr-only">Contraseña</label>
                        <div className="relative mb-3">
                          <input
                            id="auth-pw-input"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => { setPassword(e.target.value); if (error) setError(null) }}
                            placeholder="Contraseña"
                            required
                            minLength={6}
                            autoComplete={passwordMode === 'signup' ? 'new-password' : 'current-password'}
                            aria-invalid={!!error}
                            className="w-full px-4 py-3.5 pr-12 rounded-2xl border border-slate-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
                          >
                            <span className="material-symbols-outlined text-slate-400 text-[20px]">
                              {showPassword ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        </div>

                        {error && (
                          <p role="alert" className="text-red-500 text-[12.5px] mb-3 leading-snug">
                            {error}
                          </p>
                        )}

                        <button
                          type="submit"
                          disabled={loading || !emailValid || password.length < 6}
                          className="w-full py-3.5 bg-primary text-white rounded-2xl text-[14px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                        >
                          {loading
                            ? (<><Spinner /> {passwordMode === 'signup' ? 'Creando cuenta…' : 'Iniciando sesión…'}</>)
                            : (passwordMode === 'signup' ? 'Crear cuenta' : 'Iniciar sesión')}
                        </button>
                      </form>

                      <div className="mt-4 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setPasswordMode((m) => (m === 'signup' ? 'signin' : 'signup'))
                            setError(null)
                          }}
                          className="text-primary text-[12.5px] font-semibold hover:underline"
                        >
                          {passwordMode === 'signup'
                            ? '¿Ya tienes cuenta? Inicia sesión'
                            : '¿No tienes cuenta? Crea una'}
                        </button>
                      </div>

                      <p className="mt-4 text-[11px] text-center text-slate-400 leading-snug">
                        Mínimo 6 caracteres. Al continuar aceptas que usemos tu email solo para autenticación.
                      </p>
                    </>
                  )}
                </>
              ) : step === 'device_scan' ? (
                /* ── Nuevo dispositivo: escanear o tipear código ────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Escanea el QR
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        Abre Focus donde ya tienes sesión y pulsa <span className="font-semibold text-slate-700">Vincular otro dispositivo</span>. Ahí verás el QR.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setClaimCode(''); setClaimStage('idle'); setError(null); setStep('chooser') }}
                      aria-label="Volver"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                    >
                      <span className="material-symbols-outlined text-slate-400 text-[22px]">arrow_back</span>
                    </button>
                  </div>

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

                  <form onSubmit={(e) => { e.preventDefault(); handleClaim() }} noValidate>
                    <input
                      ref={claimInputRef}
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      value={formatUserCode(claimCode)}
                      onChange={(e) => handleClaimCodeChange(e.target.value)}
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
                      disabled={loading || !claimCodeValid}
                      className="w-full py-3.5 bg-primary text-white rounded-2xl text-[14px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      {loading
                        ? (
                          <>
                            <Spinner />
                            {claimStage === 'claiming' ? 'Validando código…' : 'Iniciando sesión…'}
                          </>
                        )
                        : 'Entrar'}
                    </button>
                  </form>
                  <p className="mt-3 text-[11px] text-center text-slate-400 leading-snug">
                    El código expira en 5 minutos.
                  </p>
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
                            Entra con QR desde ahí. Es más rápido y no depende del correo.
                          </p>
                          <button
                            type="button"
                            onClick={() => { setClaimCode(''); setError(null); setStep('device_scan') }}
                            disabled={loading}
                            className="mt-2 w-full py-2 bg-amber-900 text-white rounded-xl text-[12.5px] font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-[16px]">qr_code_scanner</span>
                            Entrar con QR
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
                            Si ya iniciaste sesión en otro lado, escanea su QR desde ahí sin depender del correo.
                          </p>
                          <button
                            type="button"
                            onClick={() => { setClaimCode(''); setError(null); setStep('device_scan') }}
                            disabled={loading}
                            className="mt-2 w-full py-2 bg-amber-900 text-white rounded-xl text-[12.5px] font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-[16px]">qr_code_scanner</span>
                            Entrar con QR
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

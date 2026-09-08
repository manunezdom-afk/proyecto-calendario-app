import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import {
  humanizeAuthError,
  isValidEmail,
  isRateLimitError,
  extractRetryAfterSec,
  passwordStrength,
  isAcceptablePassword,
} from '../utils/authErrors'
import { pushModal, popModal } from '../utils/modalStack'

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
    signInWithGoogle,
    signInWithPassword, signUpWithPassword,
    resetPasswordForEmail, updatePassword,
    recoveryMode, setRecoveryMode,
  } = useAuth()

  // Hidratamos el paso desde sessionStorage para que reload no rompa el flujo.
  const initialPending = typeof window !== 'undefined' ? readPending() : null

  const [email, setEmail]       = useState(initialPending?.email || '')
  const [code, setCode]         = useState('')
  // Pasos:
  //   chooser         — elección entre Iniciar sesión / Crear cuenta / Google / OTP
  //   email           — pedir email para OTP
  //   code            — verificar OTP
  //   signin          — login con email + contraseña + "Olvidé mi contraseña"
  //   signup          — registro con nombre, email, contraseña + confirmación, t&c
  //   forgot          — pedir email para enviar link de reset
  //   forgot_sent     — confirmación de "te mandamos el correo"
  //   signup_sent     — confirmación post-signup cuando email confirmation está activo
  //   recovery        — setear nueva contraseña (vino del link de reset)
  //   recovery_success — breve confirmación tras updatePassword
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

  // Registramos el modal en el stack global para que la pastilla de Nova,
  // NovaHint e InstallAppCard se escondan mientras el AuthModal esté abierto
  // en mobile. Sin esto la pastilla de Nova quedaba flotando sobre el sheet.
  useEffect(() => {
    if (!isOpen) return
    pushModal()
    return () => popModal()
  }, [isOpen])

  // Banner post rate-limit (informativo, sin sugerencia QR).
  const [rateLimitHit, setRateLimitHit] = useState(false)

  // ── Lado password (signin/signup separados) ────────────────────────────
  // Ahora signin y signup viven en pasos distintos para que el usuario
  // entienda qué está haciendo. Compartimos el state `password` porque solo
  // uno de los dos forms está montado a la vez.
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [name, setName] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  // Cuando el proyecto Supabase tiene email-confirmation activado, signUp
  // devuelve session=null y el usuario debe abrir el link del correo. En ese
  // caso mostramos un mensaje en lugar del form, sin cerrar el modal.
  const [signupSuccess, setSignupSuccess] = useState(false)

  // submitLock evita dobles envíos incluso en el mismo tick (antes de re-render)
  const submitLock = useRef(false)
  const codeInputRef = useRef(null)
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
      // Limpieza extra de estados de signup/forgot para que un reopen
      // no muestre datos sensibles del intento anterior.
      setPassword('')
      setPasswordConfirm('')
      setName('')
      setAcceptTerms(false)
      setShowPassword(false)
      setSignupSuccess(false)
    }
    onClose?.()
  }, [onClose])

  // Si el usuario verifica con éxito mientras el modal está abierto, cerramos
  // automáticamente — evita que quede atascado en el paso 'code' si el auth
  // context resolvió la sesión (p. ej. desde otra pestaña).
  useEffect(() => {
    if (!isOpen) return
    if (user && step === 'code') {
      clearPending()
      handleClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isOpen, step])

  // Autofocus código cuando entramos al paso 'code'.
  useEffect(() => {
    if (step === 'code' && codeInputRef.current) codeInputRef.current.focus()
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

  // Al reabrir el modal, re-hidratamos state desde sessionStorage. Sin esto,
  // si el usuario cerró el modal hace >15 min (TTL del pending ya caducó),
  // al reabrir veríamos step='code' con email viejo en memoria apuntando a
  // un OTP ya expirado — y el botón "Reenviar" pegaría al email equivocado.
  useEffect(() => {
    if (!isOpen) return
    const pending = readPending()

    if (pending) {
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

  // PASSWORD_RECOVERY: si Supabase nos avisó (vía AuthContext), forzamos
  // el paso de "nueva contraseña". Esto pisa cualquier otro flujo en curso
  // porque la sesión recovery solo sirve para cambiar la contraseña.
  useEffect(() => {
    if (!isOpen) return
    if (recoveryMode && step !== 'recovery' && step !== 'recovery_success') {
      setStep('recovery')
      setError(null)
      setPassword('')
      setPasswordConfirm('')
    }
  }, [isOpen, recoveryMode, step])

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

  async function handleSigninSubmit(e) {
    e?.preventDefault?.()
    if (submitLock.current || loading) return
    if (!emailValid) {
      setError('Ingresa un email válido.')
      return
    }
    if (password.length < 6) {
      setError('Ingresa tu contraseña.')
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      await signInWithPassword(email, password)
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

  async function handleSignupSubmit(e) {
    e?.preventDefault?.()
    if (submitLock.current || loading) return
    if (!emailValid) {
      setError('Ingresa un email válido.')
      return
    }
    if (!isAcceptablePassword(password)) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== passwordConfirm) {
      setError('Las contraseñas no coinciden.')
      return
    }
    if (!acceptTerms) {
      setError('Debes aceptar los términos para continuar.')
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      const { session } = await signUpWithPassword(email, password, { name: name.trim() })
      if (!session) {
        // Email confirmation activado en Supabase: no hay sesión todavía.
        // Mostramos el mensaje "revisa tu correo" sin cerrar el modal.
        setSignupSuccess(true)
        setStep('signup_sent')
        setPassword('')
        setPasswordConfirm('')
        return
      }
      // Auto-login (Supabase devolvió session): cerramos el modal.
      setPassword('')
      setPasswordConfirm('')
      setName('')
      setAcceptTerms(false)
      handleClose()
    } catch (err) {
      setError(humanizeAuthError(err))
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }

  async function handleRecoverySubmit(e) {
    e?.preventDefault?.()
    if (submitLock.current || loading) return
    if (!isAcceptablePassword(password)) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== passwordConfirm) {
      setError('Las contraseñas no coinciden.')
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      await updatePassword(password)
      setRecoveryMode(false)
      setStep('recovery_success')
      setPassword('')
      setPasswordConfirm('')
      setTimeout(() => handleClose(), 1500)
    } catch (err) {
      setError(humanizeAuthError(err))
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }

  async function handleForgotSubmit(e) {
    e?.preventDefault?.()
    if (submitLock.current || loading) return
    if (!emailValid) {
      setError('Ingresa un email válido.')
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      await resetPasswordForEmail(email)
      setStep('forgot_sent')
    } catch (err) {
      if (isRateLimitError(err)) {
        const secs = extractRetryAfterSec(err) ?? RATE_LIMIT_COOLDOWN_SEC
        writeCooldownSec(secs)
        setResendCooldown(secs)
      }
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

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/50 z-[80]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <div className="fixed inset-0 z-[81] flex items-end justify-center sm:items-center pointer-events-none">
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Iniciar sesión"
            className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:w-[420px] sm:max-w-[92vw] max-h-[92vh] overflow-y-auto shadow-2xl kb-aware pointer-events-auto"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem + var(--keyboard-height, 0px))' }}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
          >
            <div className="px-5 sm:px-6 pt-5">
              {/* Grip handle visual en mobile */}
              <div className="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" aria-hidden="true" />

              {/* recoveryMode tiene precedencia sobre el bloque "user" porque
                  Supabase deja al usuario logueado durante PASSWORD_RECOVERY,
                  pero la UI debe mostrar el form de "nueva contraseña" antes
                  que el menú de "sesión activa". */}
              {recoveryMode && (step === 'recovery' || step === 'recovery_success') ? (
                step === 'recovery' ? (
                  <>
                    <div className="flex items-start justify-between gap-3 mb-5">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                          Nueva contraseña
                        </h2>
                        <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                          Crea una nueva contraseña para tu cuenta.
                        </p>
                      </div>
                    </div>

                    <form onSubmit={handleRecoverySubmit} noValidate>
                      <div className="relative mb-1.5">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => { setPassword(e.target.value); if (error) setError(null) }}
                          placeholder="Nueva contraseña"
                          required
                          minLength={8}
                          autoComplete="new-password"
                          autoFocus
                          aria-label="Nueva contraseña"
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

                      {password.length > 0 && (() => {
                        const score = passwordStrength(password)
                        const labels = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte']
                        const colors = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-500', 'bg-emerald-600']
                        return (
                          <div className="mb-3 px-1" aria-live="polite">
                            <div className="flex gap-1 mb-1">
                              {[0, 1, 2, 3].map((i) => (
                                <div
                                  key={i}
                                  className={`h-1 flex-1 rounded-full transition-colors ${
                                    i < score ? colors[score] : 'bg-slate-200'
                                  }`}
                                />
                              ))}
                            </div>
                            <p className="text-[11px] text-slate-500">
                              Fortaleza: <span className="font-semibold text-slate-700">{labels[score]}</span>
                            </p>
                          </div>
                        )
                      })()}

                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={passwordConfirm}
                        onChange={(e) => { setPasswordConfirm(e.target.value); if (error) setError(null) }}
                        placeholder="Confirma la nueva contraseña"
                        required
                        minLength={8}
                        autoComplete="new-password"
                        aria-label="Confirmar nueva contraseña"
                        aria-invalid={!!error || (passwordConfirm.length > 0 && password !== passwordConfirm)}
                        className={`w-full px-4 py-3.5 rounded-2xl border text-[15px] mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 ${
                          passwordConfirm.length > 0 && password !== passwordConfirm
                            ? 'border-red-300'
                            : 'border-slate-200'
                        }`}
                      />

                      {error && (
                        <p role="alert" className="text-red-500 text-[12.5px] mb-3 leading-snug">
                          {error}
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={
                          loading ||
                          !isAcceptablePassword(password) ||
                          password !== passwordConfirm
                        }
                        className="w-full py-3.5 bg-primary text-white rounded-2xl text-[14px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                      >
                        {loading ? (<><Spinner /> Guardando…</>) : 'Guardar nueva contraseña'}
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="text-center py-6">
                    <span
                      className="material-symbols-outlined text-6xl text-emerald-500 mb-3 block"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      check_circle
                    </span>
                    <p className="font-semibold text-slate-800 text-[16px]">Contraseña actualizada</p>
                    <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                      Ya puedes seguir usando Focus con tu nueva contraseña.
                    </p>
                  </div>
                )
              ) : user ? (
                /* ── Logged in: menú principal ─────────────────────── */
                <div className="py-2">
                  <div className="text-center">
                    <span className="material-symbols-outlined text-5xl text-primary mb-3 block" style={{ fontVariationSettings: "'FILL' 1" }}>account_circle</span>
                    <p className="text-[13px] text-slate-500 mb-1">Sesión activa</p>
                    <p className="font-semibold text-slate-800 mb-5 break-all">{user.email}</p>
                  </div>
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
              ) : step === 'chooser' ? (
                /* ── Chooser: elegir método (signin / signup / OTP / QR) ── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Bienvenido a Focus
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        Inicia sesión o crea tu cuenta para sincronizar tus datos.
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
                    {/* CTA primaria: Iniciar sesión con email + contraseña */}
                    <button
                      type="button"
                      onClick={() => {
                        setStep('signin')
                        setError(null)
                        setSignupSuccess(false)
                      }}
                      className="w-full px-4 py-3.5 rounded-2xl bg-primary text-white hover:opacity-95 active:scale-[0.99] transition-all flex items-center gap-3 text-left shadow-sm"
                    >
                      <span className="material-symbols-outlined text-white text-[22px] flex-shrink-0">login</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold">Iniciar sesión</p>
                        <p className="text-[11.5px] text-white/80 leading-snug">Con tu email y contraseña.</p>
                      </div>
                      <span className="material-symbols-outlined text-white/70 text-[20px]">chevron_right</span>
                    </button>

                    {/* CTA secundaria: Crear cuenta nueva */}
                    <button
                      type="button"
                      onClick={() => {
                        setStep('signup')
                        setError(null)
                        setSignupSuccess(false)
                        setPassword('')
                        setPasswordConfirm('')
                        setName('')
                        setAcceptTerms(false)
                      }}
                      className="w-full px-4 py-3.5 rounded-2xl border-2 border-primary/30 hover:border-primary/50 hover:bg-primary/5 active:scale-[0.99] transition-all flex items-center gap-3 text-left"
                    >
                      <span className="material-symbols-outlined text-primary text-[22px] flex-shrink-0">person_add</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold text-slate-800">Crear cuenta</p>
                        <p className="text-[11.5px] text-slate-500 leading-snug">Empieza con Focus en menos de un minuto.</p>
                      </div>
                      <span className="material-symbols-outlined text-slate-300 text-[20px]">chevron_right</span>
                    </button>

                    <div className="flex items-center gap-2 my-2">
                      <div className="flex-1 h-px bg-slate-100" />
                      <span className="text-[11px] text-slate-400">o entra con</span>
                      <div className="flex-1 h-px bg-slate-100" />
                    </div>

                    <button
                      type="button"
                      onClick={async () => { setError(null); try { await signInWithGoogle() } catch (e) { setError(e.message) } }}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99] transition-all flex items-center gap-3"
                    >
                      <svg width="20" height="20" viewBox="0 0 18 18" fill="none" className="flex-shrink-0">
                        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
                        <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
                        <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332Z" fill="#FBBC05"/>
                        <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
                      </svg>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-[13.5px] font-semibold text-slate-800">Continuar con Google</p>
                      </div>
                      <span className="material-symbols-outlined text-slate-300 text-[20px]">chevron_right</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setStep('email'); setError(null) }}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99] transition-all flex items-center gap-3 text-left"
                    >
                      <span className="material-symbols-outlined text-primary text-[20px] flex-shrink-0">mail</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-semibold text-slate-800">Código por email</p>
                        <p className="text-[11px] text-slate-500 leading-snug">Sin contraseña.</p>
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
              ) : step === 'signin' ? (
                /* ── Iniciar sesión (email + contraseña) ─────────────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Iniciar sesión
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        Bienvenido de vuelta. Entra con tu email y contraseña.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStep('chooser')
                        setError(null)
                        setPassword('')
                        setShowPassword(false)
                      }}
                      aria-label="Volver"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                    >
                      <span className="material-symbols-outlined text-slate-400 text-[22px]">arrow_back</span>
                    </button>
                  </div>

                  <form onSubmit={handleSigninSubmit} noValidate>
                    <label htmlFor="auth-signin-email" className="sr-only">Email</label>
                    <input
                      id="auth-signin-email"
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

                    <label htmlFor="auth-signin-pw" className="sr-only">Contraseña</label>
                    <div className="relative mb-2">
                      <input
                        id="auth-signin-pw"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); if (error) setError(null) }}
                        placeholder="Contraseña"
                        required
                        autoComplete="current-password"
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

                    <div className="flex justify-end mb-3">
                      <button
                        type="button"
                        onClick={() => { setStep('forgot'); setError(null) }}
                        className="text-primary text-[12px] font-semibold hover:underline"
                      >
                        ¿Olvidaste tu contraseña?
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
                      {loading ? (<><Spinner /> Iniciando sesión…</>) : 'Iniciar sesión'}
                    </button>
                  </form>

                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setStep('signup')
                        setError(null)
                        setPassword('')
                        setPasswordConfirm('')
                        setName('')
                        setAcceptTerms(false)
                      }}
                      className="text-primary text-[12.5px] font-semibold hover:underline"
                    >
                      ¿No tienes cuenta? Crea una
                    </button>
                  </div>
                </>
              ) : step === 'signup' ? (
                /* ── Crear cuenta (nombre + email + contraseña + confirmar + t&c) ── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Crear cuenta
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        Empieza a organizar tu día con Focus.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStep('chooser')
                        setError(null)
                        setPassword('')
                        setPasswordConfirm('')
                        setShowPassword(false)
                      }}
                      aria-label="Volver"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                    >
                      <span className="material-symbols-outlined text-slate-400 text-[22px]">arrow_back</span>
                    </button>
                  </div>

                  <form onSubmit={handleSignupSubmit} noValidate>
                    <label htmlFor="auth-signup-name" className="sr-only">Tu nombre</label>
                    <input
                      id="auth-signup-name"
                      type="text"
                      autoCapitalize="words"
                      autoCorrect="off"
                      spellCheck={false}
                      value={name}
                      onChange={(e) => { setName(e.target.value); if (error) setError(null) }}
                      placeholder="Tu nombre (opcional)"
                      autoComplete="given-name"
                      maxLength={60}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-[15px] mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
                    />

                    <label htmlFor="auth-signup-email" className="sr-only">Email</label>
                    <input
                      id="auth-signup-email"
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

                    <label htmlFor="auth-signup-pw" className="sr-only">Contraseña</label>
                    <div className="relative mb-1.5">
                      <input
                        id="auth-signup-pw"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); if (error) setError(null) }}
                        placeholder="Crea una contraseña"
                        required
                        minLength={8}
                        autoComplete="new-password"
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

                    {/* Indicador de fortaleza de contraseña */}
                    {password.length > 0 && (() => {
                      const score = passwordStrength(password)
                      const labels = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte']
                      const colors = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-500', 'bg-emerald-600']
                      return (
                        <div className="mb-3 px-1" aria-live="polite">
                          <div className="flex gap-1 mb-1">
                            {[0, 1, 2, 3].map((i) => (
                              <div
                                key={i}
                                className={`h-1 flex-1 rounded-full transition-colors ${
                                  i < score ? colors[score] : 'bg-slate-200'
                                }`}
                              />
                            ))}
                          </div>
                          <p className="text-[11px] text-slate-500">
                            Fortaleza: <span className="font-semibold text-slate-700">{labels[score]}</span>
                            {score < 2 && <span className="text-slate-400"> · al menos 8 caracteres</span>}
                          </p>
                        </div>
                      )
                    })()}

                    <label htmlFor="auth-signup-pw2" className="sr-only">Confirmar contraseña</label>
                    <input
                      id="auth-signup-pw2"
                      type={showPassword ? 'text' : 'password'}
                      value={passwordConfirm}
                      onChange={(e) => { setPasswordConfirm(e.target.value); if (error) setError(null) }}
                      placeholder="Confirma la contraseña"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      aria-invalid={!!error || (passwordConfirm.length > 0 && password !== passwordConfirm)}
                      className={`w-full px-4 py-3.5 rounded-2xl border text-[15px] mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 ${
                        passwordConfirm.length > 0 && password !== passwordConfirm
                          ? 'border-red-300'
                          : 'border-slate-200'
                      }`}
                    />

                    {/* Términos */}
                    <label className="flex items-start gap-2 mb-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acceptTerms}
                        onChange={(e) => { setAcceptTerms(e.target.checked); if (error) setError(null) }}
                        className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30"
                      />
                      <span className="text-[11.5px] text-slate-600 leading-snug">
                        Acepto que Focus use mi email para autenticación y que mis datos se sincronicen en la nube.
                      </span>
                    </label>

                    {error && (
                      <p role="alert" className="text-red-500 text-[12.5px] mb-3 leading-snug">
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={
                        loading ||
                        !emailValid ||
                        !isAcceptablePassword(password) ||
                        password !== passwordConfirm ||
                        !acceptTerms
                      }
                      className="w-full py-3.5 bg-primary text-white rounded-2xl text-[14px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      {loading ? (<><Spinner /> Creando cuenta…</>) : 'Crear cuenta'}
                    </button>
                  </form>

                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setStep('signin')
                        setError(null)
                        setPassword('')
                        setPasswordConfirm('')
                      }}
                      className="text-primary text-[12.5px] font-semibold hover:underline"
                    >
                      ¿Ya tienes cuenta? Inicia sesión
                    </button>
                  </div>

                  <p className="mt-4 text-[11px] text-center text-slate-400 leading-snug">
                    Tu contraseña debe tener al menos 8 caracteres.
                  </p>
                </>
              ) : step === 'signup_sent' ? (
                /* ── Post-signup: revisa tu correo ──────────────────────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Casi listo
                      </h2>
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

                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center">
                    <span
                      className="material-symbols-outlined text-emerald-600 text-[36px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      mark_email_read
                    </span>
                    <p className="text-[14px] font-bold text-emerald-900 mt-2">Revisa tu correo</p>
                    <p className="text-[12.5px] text-emerald-800 mt-1 leading-snug">
                      Te enviamos un enlace de confirmación a <span className="font-semibold break-all">{email}</span>. Ábrelo para activar tu cuenta y luego inicia sesión.
                    </p>
                    <p className="text-[11px] text-emerald-700 mt-2">Revisa también la carpeta de spam.</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSignupSuccess(false)
                      setPassword('')
                      setPasswordConfirm('')
                      setStep('signin')
                      setError(null)
                    }}
                    className="mt-4 w-full py-3 bg-primary text-white rounded-2xl text-[13.5px] font-semibold active:scale-[0.98] transition-transform"
                  >
                    Ya confirmé, iniciar sesión
                  </button>

                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-[11px] text-slate-500 mb-2 text-center">
                      ¿No llegó el correo? Entra con código de un solo uso.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSignupSuccess(false)
                        setPassword('')
                        setPasswordConfirm('')
                        setError(null)
                        setStep('email')
                      }}
                      className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-[12.5px] font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[16px]">mail</span>
                      Acceder con código OTP
                    </button>
                  </div>
                </>
              ) : step === 'forgot' ? (
                /* ── Olvidé mi contraseña — pedir email para reset ──────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Recupera tu cuenta
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        Te enviamos un enlace para crear una nueva contraseña.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setStep('signin'); setError(null) }}
                      aria-label="Volver"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors active:scale-95"
                    >
                      <span className="material-symbols-outlined text-slate-400 text-[22px]">arrow_back</span>
                    </button>
                  </div>

                  <form onSubmit={handleForgotSubmit} noValidate>
                    <label htmlFor="auth-forgot-email" className="sr-only">Email</label>
                    <input
                      id="auth-forgot-email"
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
                      {loading ? (<><Spinner /> Enviando…</>) : 'Enviar enlace de recuperación'}
                    </button>
                  </form>

                  <p className="mt-3 text-[11px] text-center text-slate-400 leading-snug">
                    Si el email está registrado, te llegará un correo.
                  </p>
                </>
              ) : step === 'forgot_sent' ? (
                /* ── Confirmación: te enviamos el correo de reset ──────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Revisa tu correo
                      </h2>
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

                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center">
                    <span
                      className="material-symbols-outlined text-emerald-600 text-[36px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      mark_email_read
                    </span>
                    <p className="text-[14px] font-bold text-emerald-900 mt-2">Enlace enviado</p>
                    <p className="text-[12.5px] text-emerald-800 mt-1 leading-snug">
                      Si <span className="font-semibold break-all">{email}</span> está registrado, llegará un correo con instrucciones para crear una nueva contraseña.
                    </p>
                    <p className="text-[11px] text-emerald-700 mt-2">Revisa también la carpeta de spam.</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => { setStep('signin'); setError(null) }}
                    className="mt-4 w-full py-3 bg-primary text-white rounded-2xl text-[13.5px] font-semibold active:scale-[0.98] transition-transform"
                  >
                    Volver a iniciar sesión
                  </button>
                </>
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
                            Demasiados intentos
                          </p>
                          <p className="text-[11.5px] text-amber-800 mt-0.5 leading-snug">
                            Espera unos minutos antes de pedir otro código, o usa email + contraseña.
                          </p>
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
                            Demasiados intentos
                          </p>
                          <p className="text-[11.5px] text-amber-800 mt-0.5 leading-snug">
                            Espera unos minutos antes de pedir otro código, o usa email + contraseña.
                          </p>
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
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

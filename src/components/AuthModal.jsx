import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { humanizeAuthError, isValidEmail } from '../utils/authErrors'

const PENDING_KEY = 'focus_auth_pending'
const PENDING_TTL_MS = 15 * 60 * 1000 // 15 min — tras eso el OTP ya expiró en Supabase
const RESEND_COOLDOWN_SEC = 30

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

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"
    />
  )
}

export default function AuthModal({ isOpen, onClose }) {
  const { signInWithEmail, verifyOtp, user, signOut } = useAuth()

  // Hidratamos el paso desde sessionStorage para que reload no rompa el flujo.
  const initialPending = typeof window !== 'undefined' ? readPending() : null
  const [email, setEmail]       = useState(initialPending?.email || '')
  const [code, setCode]         = useState('')
  const [step, setStep]         = useState(initialPending ? 'code' : 'email')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [resendCooldown, setResendCooldown] = useState(0)

  // submitLock evita dobles envíos incluso en el mismo tick (antes de re-render)
  const submitLock = useRef(false)
  const codeInputRef = useRef(null)
  // historyPushedRef: evita apilar múltiples entries al abrir/cerrar varias veces.
  const historyPushedRef = useRef(false)

  const emailValid = isValidEmail(email)
  const codeValid  = /^\d{6}$/.test(code)

  // Si el usuario verifica con éxito mientras el modal está abierto, cerramos
  // automáticamente — evita que quede atascado en el paso 'code' si el auth
  // context resolvió la sesión (p. ej. desde otra pestaña).
  useEffect(() => {
    if (isOpen && user && step === 'code') {
      clearPending()
      handleClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isOpen, step])

  // Autofocus código cuando entramos al paso 'code'.
  useEffect(() => {
    if (step === 'code' && codeInputRef.current) codeInputRef.current.focus()
  }, [step])

  // Cooldown tick para el botón de reenviar.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [resendCooldown])

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
    // Solo reseteamos email+step si el flujo terminó (usuario logueado o manual cancel).
    // Si hay pending, preservamos para que reopen continúe.
    if (!readPending()) {
      setStep('email')
      setEmail('')
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
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      await signInWithEmail(email)
      writePending(email)
      setStep('code')
      setResendCooldown(RESEND_COOLDOWN_SEC)
    } catch (err) {
      setError(humanizeAuthError(err))
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }

  async function handleVerify(eOrCode) {
    // Puede invocarse desde el submit del form (event) o desde el auto-submit
    // pasando el código directo (evita leer `code` de una closure vieja mientras
    // setState todavía no aplicó).
    let codeToVerify
    if (typeof eOrCode === 'string') {
      codeToVerify = eOrCode
    } else {
      eOrCode?.preventDefault?.()
      codeToVerify = code
    }
    if (submitLock.current || loading) return
    if (!/^\d{6}$/.test(codeToVerify)) {
      setError('El código debe tener 6 dígitos.')
      return
    }
    submitLock.current = true
    setLoading(true)
    setError(null)
    try {
      await verifyOtp(email, codeToVerify)
      clearPending()
      // handleClose resetea estado local
      handleClose()
    } catch (err) {
      // Limpiamos el código: el usuario debe reingresarlo (evita reenviar el
      // mismo código inválido al tocar "Entrar" otra vez).
      setCode('')
      setError(humanizeAuthError(err))
      setTimeout(() => codeInputRef.current?.focus(), 50)
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }

  async function handleResend() {
    if (submitLock.current || loading || resendCooldown > 0) return
    submitLock.current = true
    setLoading(true)
    setError(null)
    setCode('')
    try {
      await signInWithEmail(email)
      writePending(email)
      setResendCooldown(RESEND_COOLDOWN_SEC)
    } catch (err) {
      setError(humanizeAuthError(err))
    } finally {
      setLoading(false)
      submitLock.current = false
    }
  }

  function handleChangeEmail() {
    clearPending()
    setStep('email')
    setCode('')
    setError(null)
  }

  function handleEmailChange(value) {
    setEmail(value)
    if (error) setError(null)
  }

  function handleCodeChange(value) {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (error) setError(null)
    // Auto-submit cuando el usuario pega o termina de tipear los 6 dígitos.
    // Evita el tap extra en mobile y cumple con la expectativa del input
    // autoComplete="one-time-code" en iOS.
    if (digits.length === 6 && !submitLock.current && !loading) {
      // Pasamos los dígitos directo: el setCode de arriba todavía no aplicó,
      // así que `code` del estado sigue desactualizado cuando corre el timeout.
      setTimeout(() => handleVerify(digits), 0)
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
                /* ── Logged in ─────────────────────────────────────────── */
                <div className="text-center py-2">
                  <span className="material-symbols-outlined text-5xl text-primary mb-3 block" style={{ fontVariationSettings: "'FILL' 1" }}>account_circle</span>
                  <p className="text-[13px] text-slate-500 mb-1">Sesión activa</p>
                  <p className="font-semibold text-slate-800 mb-6 break-all">{user.email}</p>
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
                      Busca el código de 6 dígitos en tu bandeja (revisa spam si no aparece en 1 minuto).
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
                      placeholder="123456"
                      maxLength={6}
                      aria-label="Código de 6 dígitos"
                      aria-invalid={!!error}
                      className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 text-center text-2xl font-mono tracking-[0.4em] mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
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
                /* ── Pedir código ─────────────────────────────────────── */
                <>
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[20px] sm:text-[22px] font-bold text-slate-900 leading-tight">
                        Inicia sesión
                      </h2>
                      <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">
                        Sin contraseña. Te enviamos un código de 6 dígitos por email.
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

                  <p className="mt-3 text-[11px] text-center text-slate-400 leading-snug">
                    Al continuar aceptas que usemos tu email solo para autenticación.
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

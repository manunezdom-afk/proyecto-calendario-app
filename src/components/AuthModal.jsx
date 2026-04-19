import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'

export default function AuthModal({ isOpen, onClose }) {
  const { signInWithEmail, verifyOtp, user, signOut } = useAuth()
  const [email, setEmail]     = useState('')
  const [code, setCode]       = useState('')
  const [step, setStep]       = useState('email') // 'email' | 'code'
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const codeInputRef = useRef(null)
  const dialogRef    = useRef(null)

  useEffect(() => {
    if (step === 'code' && codeInputRef.current) {
      codeInputRef.current.focus()
    }
  }, [step])

  // Cerrar con Escape — atajo estándar para modales.
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // handleClose es estable (no depende de nada que cambie por frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  async function handleSendEmail(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await signInWithEmail(email)
      setStep('code')
    } catch (err) {
      setError(err.message || 'No se pudo enviar el código')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(e) {
    e.preventDefault()
    if (code.length !== 6) {
      setError('El código debe tener 6 dígitos')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await verifyOtp(email, code)
      handleClose()
    } catch (err) {
      setError(err.message || 'Código inválido o expirado')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setLoading(true)
    setError(null)
    setCode('')
    try {
      await signInWithEmail(email)
    } catch (err) {
      setError(err.message || 'No se pudo reenviar')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setStep('email')
    setCode('')
    setEmail('')
    setError(null)
    onClose()
  }

  function handleChangeEmail() {
    setStep('email')
    setCode('')
    setError(null)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/40 z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={handleClose}
            aria-hidden="true"
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            className="fixed inset-x-4 bottom-0 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 bg-white rounded-t-3xl md:rounded-3xl p-6 z-50 md:w-96 shadow-2xl"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {user ? (
              /* ── Logged in ── */
              <div className="text-center py-4">
                <span className="material-symbols-outlined text-5xl text-primary mb-3 block">account_circle</span>
                <p className="text-sm text-slate-500 mb-1">Sesión activa</p>
                <p className="font-semibold mb-6">{user.email}</p>
                <button
                  onClick={() => { signOut(); handleClose() }}
                  className="w-full py-3 bg-red-50 text-red-600 rounded-2xl text-sm font-semibold"
                >
                  Cerrar sesión
                </button>
                <button onClick={handleClose} className="mt-3 w-full py-3 bg-slate-100 rounded-2xl text-sm">
                  Cancelar
                </button>
              </div>
            ) : step === 'code' ? (
              /* ── Enter 6-digit code ── */
              <>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 id="auth-modal-title" className="text-xl font-bold">Revisa tu correo</h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Enviamos un código a <strong className="text-slate-700">{email}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClose}
                    aria-label="Cerrar"
                    className="p-2 rounded-full hover:bg-slate-100 transition-colors"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-slate-400">close</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-2xl mb-5">
                  <span className="material-symbols-outlined text-primary text-[20px]">mark_email_read</span>
                  <p className="text-[12px] text-slate-600 leading-snug">
                    Buscá el código de <b>6 dígitos</b> en tu email (revisá spam si no llega).
                    Pegalo acá abajo.
                  </p>
                </div>

                <form onSubmit={handleVerify}>
                  <input
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    maxLength={6}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-center text-2xl font-mono tracking-[0.3em] mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {error && <p className="text-red-500 text-xs mb-3 text-center">{error}</p>}
                  <button
                    type="submit"
                    disabled={loading || code.length !== 6}
                    className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-bold disabled:opacity-40 transition-opacity"
                  >
                    {loading ? 'Verificando…' : 'Entrar'}
                  </button>
                </form>

                <div className="mt-4 flex items-center justify-between text-[11.5px]">
                  <button
                    onClick={handleChangeEmail}
                    className="text-slate-500 hover:text-slate-800 font-semibold"
                  >
                    ← Cambiar email
                  </button>
                  <button
                    onClick={handleResend}
                    disabled={loading}
                    className="text-primary hover:underline font-semibold disabled:opacity-40"
                  >
                    Reenviar código
                  </button>
                </div>
              </>
            ) : (
              /* ── Sign in form ── */
              <>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 id="auth-modal-title" className="text-xl font-bold">Guardar tu progreso</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Sin contraseña · código por email</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClose}
                    aria-label="Cerrar"
                    className="p-2 rounded-full hover:bg-slate-100 transition-colors"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-slate-400">close</span>
                  </button>
                </div>

                <div className="flex gap-3 mb-5">
                  {[
                    { icon: 'sync', label: 'Sync multi-dispositivo' },
                    { icon: 'cloud_done', label: 'Respaldo en la nube' },
                    { icon: 'devices', label: 'Acceso desde cualquier lugar' },
                  ].map(({ icon, label }) => (
                    <div key={icon} className="flex-1 flex flex-col items-center gap-1 p-2 bg-slate-50 rounded-2xl">
                      <span className="material-symbols-outlined text-primary text-xl">{icon}</span>
                      <span className="text-[10px] text-center text-slate-500 leading-tight">{label}</span>
                    </div>
                  ))}
                </div>

                <form onSubmit={handleSendEmail}>
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="tu@email.com" required
                    autoComplete="email"
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {error && <p className="text-red-500 text-xs mb-3">{error}</p>}
                  <button
                    type="submit" disabled={loading || !email}
                    className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-bold disabled:opacity-40 transition-opacity"
                  >
                    {loading ? 'Enviando...' : 'Enviar código'}
                  </button>
                </form>

                <p className="mt-3 text-[10.5px] text-center text-slate-400">
                  Te enviamos un código de 6 dígitos por email. Sin contraseñas.
                </p>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

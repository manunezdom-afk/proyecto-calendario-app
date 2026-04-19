import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'

export default function AuthModal({ isOpen, onClose }) {
  const { signInWithEmail, verifyEmailCode, user, signOut } = useAuth()
  const [email, setEmail]     = useState('')
  const [code, setCode]       = useState('')
  const [step, setStep]       = useState('email') // 'email' | 'code'
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  async function handleSendCode(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await signInWithEmail(email)
      setStep('code')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await verifyEmailCode(email, code)
      handleClose()
    } catch (err) {
      setError('Código inválido o expirado. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setLoading(true)
    setError(null)
    try {
      await signInWithEmail(email)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setStep('email')
    setEmail('')
    setCode('')
    setError(null)
    onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/40 z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <motion.div
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
                    <h2 className="text-xl font-bold">Ingresa tu código</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Enviamos un código de 6 dígitos a <strong>{email}</strong></p>
                  </div>
                  <button onClick={handleClose} className="p-2 rounded-full hover:bg-slate-100 transition-colors">
                    <span className="material-symbols-outlined text-slate-400">close</span>
                  </button>
                </div>

                <form onSubmit={handleVerifyCode}>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    required
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-center text-2xl font-bold tracking-[0.5em] tabular-nums mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {error && <p className="text-red-500 text-xs mb-3">{error}</p>}
                  <button
                    type="submit"
                    disabled={loading || code.length < 6}
                    className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-bold disabled:opacity-50 transition-opacity"
                  >
                    {loading ? 'Verificando...' : 'Verificar código'}
                  </button>
                </form>

                <div className="flex justify-between mt-4 text-xs">
                  <button
                    onClick={() => { setStep('email'); setCode(''); setError(null) }}
                    className="text-slate-500 hover:text-slate-700"
                  >
                    ← Cambiar email
                  </button>
                  <button
                    onClick={handleResend}
                    disabled={loading}
                    className="text-primary font-semibold hover:underline disabled:opacity-50"
                  >
                    Reenviar código
                  </button>
                </div>
              </>
            ) : (
              /* ── Sign in form (email step) ── */
              <>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-xl font-bold">Guardar tu progreso</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Sin contraseña · código de 6 dígitos por email</p>
                  </div>
                  <button onClick={handleClose} className="p-2 rounded-full hover:bg-slate-100 transition-colors">
                    <span className="material-symbols-outlined text-slate-400">close</span>
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

                <form onSubmit={handleSendCode}>
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="tu@email.com" required
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {error && <p className="text-red-500 text-xs mb-3">{error}</p>}
                  <button
                    type="submit" disabled={loading}
                    className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-bold disabled:opacity-50 transition-opacity"
                  >
                    {loading ? 'Enviando...' : 'Enviar código'}
                  </button>
                </form>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

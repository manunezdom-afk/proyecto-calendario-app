import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'

export default function GuestBanner() {
  const { user, setAuthModal } = useAuth()
  if (user) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-3 mb-1 flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="material-symbols-outlined text-amber-500 text-[18px] flex-shrink-0">cloud_off</span>
        <p className="text-xs text-amber-800 truncate">Modo demo — solo en este dispositivo</p>
      </div>
      <button
        onClick={() => setAuthModal(true)}
        className="text-xs font-bold text-primary whitespace-nowrap ml-3 flex-shrink-0"
      >
        Crear cuenta
      </button>
    </motion.div>
  )
}

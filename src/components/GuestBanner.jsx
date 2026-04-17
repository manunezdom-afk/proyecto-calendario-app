import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'

const STORAGE_KEY = 'focus_demo_banner_dismissed'

export default function GuestBanner() {
  const { user, setAuthModal } = useAuth()
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1'
  )

  if (user) return null

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setDismissed(true)
  }

  if (dismissed) {
    return (
      <div className="mx-4 mt-3 mb-1 flex justify-end">
        <button
          type="button"
          onClick={() => setAuthModal(true)}
          title="Modo demo. Crear cuenta para sincronizar"
          className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
          aria-label="Modo demo. Crear cuenta para sincronizar"
        >
          <span className="material-symbols-outlined text-amber-500 text-[14px]">cloud_off</span>
        </button>
      </div>
    )
  }

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
      <div className="flex items-center gap-1 ml-3 flex-shrink-0">
        <button
          onClick={() => setAuthModal(true)}
          className="text-xs font-bold text-primary whitespace-nowrap"
        >
          Crear cuenta
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Cerrar banner"
          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-amber-100 text-amber-700"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    </motion.div>
  )
}

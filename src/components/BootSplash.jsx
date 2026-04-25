import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import AuroraBackground from './AuroraBackground'

// Pantalla de arranque con el icono de marca, igual que apps mainstream
// (Instagram, Spotify, X): aparece ~1s al abrir la app, fade-out suave y
// luego el contenido. Se muestra SIEMPRE, no sólo en el primer uso —
// distinto de WelcomeScreen, que es la "Threshold Scene" elaborada con
// saludo personalizado y aparece sólo en la primera apertura.
//
// Por qué un BootSplash React además del splash inline en index.html:
//   1. El splash inline pinta al instante (antes de que cargue el bundle)
//      pero React lo reemplaza al montar — termina visible apenas
//      ~100-300ms en cold start rápido. Demasiado fugaz para registrarse
//      visualmente, no se siente como "splash" sino como un flash.
//   2. BootSplash se monta en App.jsx con duración mínima de 1s antes de
//      empezar a hacer fade-out. La transición inline → React es invisible
//      porque ambos splashes tienen el MISMO layout (icono centrado +
//      mismo fondo + mismos blobs azules).
//   3. Como vive en React, puede usar AnimatePresence para hacer el exit
//      con framer-motion, sin saltos.

const MIN_VISIBLE_MS = 1000
const FADE_OUT_MS = 420

export function useBootSplash() {
  const [show, setShow] = useState(true)
  useEffect(() => {
    const id = setTimeout(() => setShow(false), MIN_VISIBLE_MS)
    return () => clearTimeout(id)
  }, [])
  return { show }
}

// Reproduce el icono de la app (public/icons/icon.svg) inline, para que el
// rendering sea instantáneo y no dependa de cargar un PNG. Misma paleta
// azul que el icono de instalación: #60a5fa → #1d4ed8 → #1e1b4b.
function FocusIcon({ size = 96 }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      style={{
        filter: 'drop-shadow(0 16px 38px rgba(29,78,216,0.45))',
      }}
    >
      <defs>
        <linearGradient id="bootsplash-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="55%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#1e1b4b" />
        </linearGradient>
        <radialGradient id="bootsplash-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#bootsplash-bg)" />
      <circle cx="256" cy="256" r="180" fill="url(#bootsplash-glow)" />
      <g fill="#ffffff" transform="translate(256 256)">
        <circle r="68" />
        <g>
          <rect x="-10" y="-128" width="20" height="40" rx="10" />
          <rect x="-10" y="88" width="20" height="40" rx="10" />
          <rect x="-128" y="-10" width="40" height="20" rx="10" />
          <rect x="88" y="-10" width="40" height="20" rx="10" />
          <rect x="-10" y="-128" width="20" height="40" rx="10" transform="rotate(45)" />
          <rect x="-10" y="88" width="20" height="40" rx="10" transform="rotate(45)" />
          <rect x="-128" y="-10" width="40" height="20" rx="10" transform="rotate(45)" />
          <rect x="88" y="-10" width="40" height="20" rx="10" transform="rotate(45)" />
        </g>
      </g>
    </svg>
  )
}

export default function BootSplash() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: FADE_OUT_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{
        background: 'radial-gradient(ellipse at 50% 42%, #0a1226 0%, #06080f 70%)',
      }}
      aria-hidden="true"
    >
      <AuroraBackground variant="threshold" intensity={1} />
      <motion.div
        // Breath sutil del icono — vivo sin distraer. Misma curva que la
        // animación del orbe en WelcomeScreen para mantener consistencia.
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-[1]"
      >
        <FocusIcon size={96} />
      </motion.div>
      {/* Wordmark sutil arriba — mismo tamaño/posición que WelcomeScreen
          y el splash inline, para que no haya salto visual al hacer el
          handoff entre pantallas oscuras. */}
      <span
        className="pointer-events-none absolute select-none text-center"
        style={{
          left: 0,
          right: 0,
          top: 'calc(env(safe-area-inset-top, 0px) + clamp(28px, 6vh, 56px))',
          fontSize: 'clamp(11px, 1.2vw, 13px)',
          letterSpacing: '0.42em',
          fontWeight: 500,
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.55)',
          zIndex: 1,
        }}
      >
        Focus
      </span>
    </motion.div>
  )
}

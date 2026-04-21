import { motion } from 'framer-motion'

/**
 * NovaOrb — firma visual de la IA.
 * Respiración infinita (scale 1↔1.04, glow 0.55↔1.0) cada 3.2s.
 * El único elemento de la UI que nunca se detiene: es la "latencia viva" de la marca.
 * Respeta prefers-reduced-motion via el override global en index.css.
 */
export default function NovaOrb({ size = 72, pulse = false, ambient = true, onClick, className = '', style }) {
  const s = size
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Nova"
      className={`relative inline-flex items-center justify-center ${onClick ? 'cursor-pointer' : 'cursor-default'} ${className}`}
      style={{ width: s, height: s, background: 'transparent', border: 0, padding: 0, ...style }}
    >
      {ambient && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: `-${Math.round(s * 0.55)}px`,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(var(--nova-glow), 0.35) 0%, rgba(var(--nova-glow), 0.12) 40%, transparent 70%)',
            filter: 'blur(14px)',
            animation: 'novaBreath 3.2s ease-in-out infinite',
          }}
        />
      )}

      <motion.span
        aria-hidden="true"
        animate={pulse ? { scale: [1, 1.08, 1] } : undefined}
        transition={pulse ? { duration: 0.9, ease: 'easeInOut' } : undefined}
        style={{
          position: 'relative',
          width: s,
          height: s,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 30% 30%, #a99bff 0%, #7c6bff 45%, #4c3fd6 100%)',
          boxShadow: '0 10px 32px -8px rgba(124, 107, 255, 0.6), inset 0 1px 2px rgba(255,255,255,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 28%, rgba(255,255,255,0.55), transparent 40%)',
            mixBlendMode: 'screen',
          }}
        />
        <span
          aria-hidden="true"
          style={{
            width: Math.round(s * 0.18),
            height: Math.round(s * 0.18),
            borderRadius: '50%',
            background: 'radial-gradient(circle, #fff 0%, rgba(255,255,255,0.6) 60%, transparent 100%)',
            animation: 'novaBreath 3.2s ease-in-out infinite',
          }}
        />
      </motion.span>
    </button>
  )
}

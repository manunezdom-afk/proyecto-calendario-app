import { motion } from 'framer-motion'

/**
 * NovaOrb — firma visual de la IA.
 * Esfera cian eléctrica con respiración infinita (scale 1↔1.04, glow 0.55↔1.0)
 * cada 3.2s. El único elemento de la UI que nunca se detiene: la "latencia
 * viva" de la marca. Respeta prefers-reduced-motion via override en index.css.
 *
 * Props:
 *   - size: diámetro en px (default 72)
 *   - pulse: pulso one-shot (scale 1.08) — útil al click
 *   - ambient: glow exterior respirando (default true)
 *   - hero: variante landing — añade anillo orbital y glow extendido
 */
export default function NovaOrb({
  size = 72,
  pulse = false,
  ambient = true,
  hero = false,
  onClick,
  className = '',
  style,
}) {
  const s = size
  // Anillo orbital: solo en hero o tamaños grandes (≥ 88px). En tamaños
  // pequeños (hint, evening shutdown) sería ruido visual.
  const showRing = hero || s >= 88

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
            inset: `-${Math.round(s * (hero ? 0.85 : 0.55))}px`,
            borderRadius: '50%',
            background: hero
              ? 'radial-gradient(circle, rgba(var(--nova-glow), 0.45) 0%, rgba(var(--nova-glow), 0.18) 35%, rgba(139, 92, 246, 0.08) 60%, transparent 75%)'
              : 'radial-gradient(circle, rgba(var(--nova-glow), 0.38) 0%, rgba(var(--nova-glow), 0.14) 45%, transparent 72%)',
            filter: hero ? 'blur(22px)' : 'blur(14px)',
            animation: 'novaBreath 3.2s ease-in-out infinite',
          }}
        />
      )}

      {/* Anillo orbital — capa de futurismo. Rota lento (18s) en linear para
          que el ojo no lo perciba como "loading", solo como presencia. */}
      {showRing && (
        <motion.span
          aria-hidden="true"
          animate={{ rotate: 360 }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
          style={{
            position: 'absolute',
            inset: `-${Math.round(s * 0.18)}px`,
            borderRadius: '50%',
            border: '1px solid rgba(var(--nova-glow), 0.28)',
            boxShadow: '0 0 12px rgba(var(--nova-glow), 0.18)',
          }}
        />
      )}

      {/* Esfera principal — degradado 3D cian con punto de luz arriba-izq,
          ecuador saturado y polo sur en cian profundo para profundidad. */}
      <motion.span
        aria-hidden="true"
        animate={pulse ? { scale: [1, 1.08, 1] } : undefined}
        transition={pulse ? { duration: 0.9, ease: 'easeInOut' } : undefined}
        style={{
          position: 'relative',
          width: s,
          height: s,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 32% 28%, #ecfeff 0%, #67e8f9 18%, #22d3ee 42%, #0891b2 75%, #164e63 100%)',
          boxShadow:
            '0 12px 36px -6px rgba(34, 211, 238, 0.55), ' +
            '0 4px 14px -2px rgba(139, 92, 246, 0.22), ' +
            'inset 0 1px 2px rgba(255,255,255,0.55), ' +
            'inset 0 -8px 16px -4px rgba(8, 51, 68, 0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Specular highlight superior izq — la luz "del mundo". */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 28% 24%, rgba(255,255,255,0.78), transparent 38%)',
            mixBlendMode: 'screen',
          }}
        />
        {/* Reflejo iridiscente violeta en el polo opuesto — guiño al morado
            original de Nova, ahora como acento, no como base. */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 78% 80%, rgba(139, 92, 246, 0.30), transparent 36%)',
            mixBlendMode: 'screen',
          }}
        />
        {/* Núcleo brillante que respira — corazón vivo del orbe. */}
        <span
          aria-hidden="true"
          style={{
            width: Math.round(s * 0.18),
            height: Math.round(s * 0.18),
            borderRadius: '50%',
            background: 'radial-gradient(circle, #fff 0%, rgba(207,250,254,0.7) 55%, transparent 100%)',
            animation: 'novaBreath 3.2s ease-in-out infinite',
          }}
        />
      </motion.span>
    </button>
  )
}

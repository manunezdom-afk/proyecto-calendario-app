import { useMemo } from 'react'

const CONTINUITY_KEY = 'focus_aurora_continuity'

export function readContinuity() {
  try {
    const raw = sessionStorage.getItem(CONTINUITY_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data?.t || Date.now() - data.t > 4000) return null
    return data
  } catch {
    return null
  }
}

export function consumeContinuity() {
  const data = readContinuity()
  try { sessionStorage.removeItem(CONTINUITY_KEY) } catch {}
  return data
}

export default function AuroraBackground({ variant = 'app', className = '', intensity = 1 }) {
  const continuity = useMemo(readContinuity, [])
  const boost = continuity ? 1.2 : 1

  const dims = variant === 'threshold'
    ? { b1: 560, b2: 520, b3: 480, blur: 120 }
    : { b1: 520, b2: 480, b3: 420, blur: 140 }

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 overflow-hidden ${className}`}
      style={{ zIndex: 0 }}
    >
      {/* Tres blobs en familia azul, alineados con el gradiente del icono
          (#60a5fa → #1d4ed8 → #1e1b4b). Antes eran azul + morado + rosa,
          y daban una sensación general violeta que ya no concuerda con el
          icono actual ni con la marca. Ahora todo el degradado tira al
          azul: claro arriba-izquierda, royal arriba-derecha, profundo
          abajo. Las opacidades se mantienen para preservar la sensación
          ambiente — sólo cambia el matiz. */}
      <div
        style={{
          position: 'absolute',
          top: '-160px',
          left: '-160px',
          width: dims.b1,
          height: dims.b1,
          borderRadius: '50%',
          background: `rgba(96,165,250,${0.30 * intensity * boost})`,
          filter: `blur(${dims.blur}px)`,
          animation: 'auroraDrift1 18s ease-in-out infinite',
          willChange: 'transform',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '15%',
          right: '-180px',
          width: dims.b2,
          height: dims.b2,
          borderRadius: '50%',
          background: `rgba(37,99,235,${0.26 * intensity * boost})`,
          filter: `blur(${dims.blur}px)`,
          animation: 'auroraDrift2 22s ease-in-out infinite',
          willChange: 'transform',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '5%',
          left: '20%',
          width: dims.b3,
          height: dims.b3,
          borderRadius: '50%',
          background: `rgba(29,78,216,${0.22 * intensity * boost})`,
          filter: `blur(${dims.blur}px)`,
          animation: 'auroraDrift3 26s ease-in-out infinite',
          willChange: 'transform',
        }}
      />
      {/* Fade al fondo para que la aurora no sea todo — solo firma ambiente. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: variant === 'threshold'
            ? 'linear-gradient(180deg, transparent 0%, rgba(10,10,15,0.3) 60%, rgba(10,10,15,0.85) 100%)'
            : 'linear-gradient(180deg, rgba(252,248,251,0.55) 0%, rgba(252,248,251,0.85) 50%, #fcf8fb 100%)',
        }}
      />
    </div>
  )
}

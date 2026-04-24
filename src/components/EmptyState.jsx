// EmptyState
//
// Componente reutilizable para los estados vacíos de la app. Antes muchos
// lugares sólo mostraban una línea gris en itálica (ej. "Nada en la
// tarde/noche."), que se sentía como un error y no como una condición
// normal. Apps como Linear o Fantastical ocupan este espacio con una
// ilustración simple + una frase corta con personalidad + un CTA opcional,
// y el vacío deja de percibirse como vacío.
//
// Dos props clave:
//   · illustration → id del glyph SVG que se dibuja arriba. Los SVGs
//     viven en este archivo para que el componente sea un único import y
//     no haya que pelearse con assets sueltos.
//   · tone → 'primary' (azul) | 'emerald' (hecho) | 'violet' (reflexión)
//     | 'muted' (sin datos, neutral). Afecta sólo al color de la
//     ilustración y la cápsula CTA.
//
// Las ilustraciones son deliberadamente minimal: stroke 1.5–2, redondeadas,
// con un único elemento decorativo que resuena con la pantalla (relojito,
// calendario en blanco, estrella, checkmark). No mascotas, no cartoons.

const TONE_CLASSES = {
  primary: {
    bg:     'bg-primary/10',
    stroke: 'text-primary',
    button: 'bg-primary text-white hover:bg-primary/90',
  },
  emerald: {
    bg:     'bg-emerald-100',
    stroke: 'text-emerald-600',
    button: 'bg-emerald-500 text-white hover:bg-emerald-600',
  },
  violet: {
    bg:     'bg-violet-100',
    stroke: 'text-violet-600',
    button: 'bg-violet-500 text-white hover:bg-violet-600',
  },
  muted: {
    bg:     'bg-surface-container-low',
    stroke: 'text-outline',
    button: 'bg-surface-container text-on-surface hover:bg-surface-container-high',
  },
}

function Illustration({ id, className }) {
  const common = {
    width: 72,
    height: 72,
    viewBox: '0 0 48 48',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
  }
  switch (id) {
    case 'calendar-empty':
      return (
        <svg {...common}>
          <rect x="7" y="10" width="34" height="30" rx="4" />
          <path d="M7 18h34" />
          <path d="M15 7v6M33 7v6" />
          <circle cx="24" cy="28" r="1.2" fill="currentColor" />
        </svg>
      )
    case 'moon-stars':
      return (
        <svg {...common}>
          <path d="M30 8a14 14 0 1 0 10 24 11 11 0 0 1-10-24z" />
          <path d="M12 12l1.5 3 3 1.5-3 1.5L12 21l-1.5-3L7.5 16.5l3-1.5z" strokeWidth="1.2" />
        </svg>
      )
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M24 8v10M24 30v10M8 24h10M30 24h10" />
          <circle cx="24" cy="24" r="4" />
          <path d="M12 12l2 4M34 12l-2 4M12 36l2-4M34 36l-2-4" strokeWidth="1.2" />
        </svg>
      )
    case 'check-circle':
      return (
        <svg {...common}>
          <circle cx="24" cy="24" r="16" />
          <path d="M17 24l5 5 9-11" />
        </svg>
      )
    case 'inbox':
      return (
        <svg {...common}>
          <path d="M8 22l4-12h24l4 12v14a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V22z" />
          <path d="M8 22h10l2 4h8l2-4h10" />
        </svg>
      )
    case 'heart-memory':
      return (
        <svg {...common}>
          <path d="M24 38s-14-8-14-18a7 7 0 0 1 14-2 7 7 0 0 1 14 2c0 10-14 18-14 18z" />
        </svg>
      )
    case 'compass':
      return (
        <svg {...common}>
          <circle cx="24" cy="24" r="16" />
          <path d="M30 18l-4 10-10 4 4-10z" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="24" cy="24" r="16" />
        </svg>
      )
  }
}

export default function EmptyState({
  illustration = 'calendar-empty',
  title,
  body,
  cta,           // { label, onClick } | null
  tone = 'primary',
  compact = false,
  className = '',
}) {
  const t = TONE_CLASSES[tone] || TONE_CLASSES.primary
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'py-6' : 'py-10'} px-4 ${className}`}>
      <div className={`${compact ? 'h-16 w-16' : 'h-20 w-20'} rounded-2xl ${t.bg} flex items-center justify-center mb-4`}>
        <Illustration id={illustration} className={t.stroke} />
      </div>
      {title && (
        <h3 className={`${compact ? 'text-[15px]' : 'text-[17px]'} font-bold text-on-surface leading-tight`}>
          {title}
        </h3>
      )}
      {body && (
        <p className={`${compact ? 'text-[12.5px]' : 'text-[13px]'} text-outline max-w-[320px] mt-1.5 leading-snug`}>
          {body}
        </p>
      )}
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className={`mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-bold transition-colors active:scale-[0.98] ${t.button}`}
        >
          {cta.icon && <span className="material-symbols-outlined text-[16px]">{cta.icon}</span>}
          {cta.label}
        </button>
      )}
    </div>
  )
}

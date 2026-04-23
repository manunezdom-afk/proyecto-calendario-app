import { Component } from 'react'

// Último telón de seguridad. Si cualquier cosa crashea durante el primer render
// (error cargando un chunk lazy, excepción en un useEffect, etc.), sin esto el
// usuario se queda mirando el splash estático porque React no llegó a reemplazar
// el DOM. Este boundary muestra un fallback mínimo con un botón de recarga —
// reemplaza la "blank screen" por algo accionable.
export class BootErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[Focus] 💥 render crash:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 16,
          padding: 24,
          background: 'radial-gradient(ellipse at 50% 42%, #15121f 0%, #0a0a0f 70%)',
          color: '#fff',
          fontFamily: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          textAlign: 'center',
          zIndex: 99999,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #a99bff 0%, #7c6bff 45%, #4c3fd6 100%)',
            boxShadow: '0 10px 32px -8px rgba(124,107,255,0.6)',
            marginBottom: 8,
          }}
        />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Focus no pudo iniciar</h1>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.6, maxWidth: 280, lineHeight: 1.4 }}>
          Recargá para reintentar. Si el problema sigue, desinstalá la PWA desde el home screen y volvé a instalarla desde Safari.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8,
            padding: '10px 22px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(124,107,255,0.2)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Recargar
        </button>
      </div>
    )
  }
}

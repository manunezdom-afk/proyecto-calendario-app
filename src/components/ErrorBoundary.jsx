import { Component } from 'react'

// Error boundary raíz: atrapa errores en el tree de React para que un crash
// en cualquier hook/componente no deje la app en pantalla blanca.
// El fallback ofrece recarga rápida y también limpiar caché local (útil si el
// estado en localStorage quedó corrupto).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[ErrorBoundary] crash:', error, info)
  }

  reset = () => this.setState({ error: null, info: null })

  clearAndReload = () => {
    try {
      const KEEP = new Set(['focus_migrated'])
      Object.keys(localStorage).forEach((k) => {
        if (!KEEP.has(k)) localStorage.removeItem(k)
      })
    } catch {}
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    const msg = this.state.error?.message || String(this.state.error)
    const stack = this.state.error?.stack || ''

    return (
      <div
        role="alert"
        className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-slate-50"
      >
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl shadow-xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-rose-500">error</span>
            <h1 className="text-lg font-bold text-slate-800">Algo falló</h1>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            La app se encontró con un error inesperado. Puedes reintentar o limpiar
            los datos locales y recargar.
          </p>
          <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-32 overflow-auto text-slate-700 mb-4 whitespace-pre-wrap break-words">
            {msg}
          </pre>
          {import.meta.env?.DEV && stack && (
            <details className="mb-4">
              <summary className="text-[11px] text-slate-400 cursor-pointer">
                Stack trace
              </summary>
              <pre className="text-[10px] mt-2 bg-slate-50 border border-slate-200 rounded-xl p-2 max-h-48 overflow-auto text-slate-500 whitespace-pre-wrap break-words">
                {stack}
              </pre>
            </details>
          )}
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90"
            >
              Reintentar
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              Recargar
            </button>
          </div>
          <button
            onClick={this.clearAndReload}
            className="w-full mt-2 py-2 rounded-xl text-[12px] text-slate-400 hover:text-slate-600"
          >
            Borrar datos locales y recargar
          </button>
        </div>
      </div>
    )
  }
}

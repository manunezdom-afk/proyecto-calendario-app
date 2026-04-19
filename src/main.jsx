import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { registerServiceWorker } from './lib/pwa'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Evita el "flash" de texto literal ("brightness_high", "business", etc.)
// en iPhone mientras la fuente Material Symbols descarga. Los iconos quedan
// invisibles (ver index.html) hasta que `document.fonts.ready` resuelve.
if (typeof document !== 'undefined') {
  const markReady = () => document.documentElement.classList.add('msl-ready')
  if (document.fonts?.ready) {
    document.fonts.ready.then(markReady)
    // Safety net: en redes muy lentas, no bloqueamos eternamente la UI.
    setTimeout(markReady, 2500)
  } else {
    markReady()
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// Registrar service worker para convertir la web en app instalable y offline-capable
registerServiceWorker()

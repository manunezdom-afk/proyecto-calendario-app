import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { registerServiceWorker } from './lib/pwa'
import { BootErrorBoundary } from './components/BootErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BootErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BootErrorBoundary>
  </StrictMode>,
)

// Registrar service worker para convertir la web en app instalable y offline-capable
registerServiceWorker()

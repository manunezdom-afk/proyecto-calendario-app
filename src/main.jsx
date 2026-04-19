import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

const SPLASH_MIN_MS = 700
const splashStart = performance.now()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)

// Ocultar splash cuando (a) React ya montó y (b) pasaron al menos SPLASH_MIN_MS
const elapsed = performance.now() - splashStart
setTimeout(
  () => document.documentElement.classList.add('app-ready'),
  Math.max(0, SPLASH_MIN_MS - elapsed),
)

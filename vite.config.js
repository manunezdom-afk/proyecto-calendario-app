import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  esbuild: {
    // En producción quitamos console.* y debugger para no ralentizar iOS
    // ni filtrar logs internos; en dev se mantienen.
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
}))

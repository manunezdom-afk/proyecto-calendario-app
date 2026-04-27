import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Separar dependencies estables del código de la app. Ganancia clave en
    // cold start de PWA instalada / Safari: el vendor chunk se cachea para
    // siempre (mismo hash entre deploys mientras no cambien las versiones),
    // así que sólo se baja una vez. Antes todo vivía en index-*.js, y un
    // cambio de una línea en App.jsx invalidaba los 175 KB de vendors → 2 s
    // extra de red en cada deploy.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'
          if (id.includes('framer-motion')) return 'vendor-motion'
          return 'vendor'
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})

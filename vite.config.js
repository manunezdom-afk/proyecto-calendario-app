import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  build: {
    // Source maps solo en prod para depurar errores de usuarios sin exponer
    // demasiado (son "hidden" por defecto si se quiere ocultar).
    sourcemap: true,
    rollupOptions: {
      output: {
        // Code splitting: separa los chunks pesados para que el tiempo hasta
        // interactivo sea menor y el cache del browser reutilice vendor entre
        // deploys.
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'supabase': ['@supabase/supabase-js'],
          'motion': ['framer-motion'],
        },
      },
    },
  },

  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.{js,jsx}', 'api/**/*.test.{js,mjs}'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/utils/**', 'src/hooks/**', 'api/_shared/**'],
    },
  },
})

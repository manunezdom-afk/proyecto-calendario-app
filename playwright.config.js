import { defineConfig, devices } from '@playwright/test'

// Tests E2E de Focus. Levantan Vite en background, mockean los endpoints de
// IA con `page.route` para no quemar cuota de Anthropic ni depender de red,
// y validan el feedback loop crítico de Nova: enviar mensaje, ver loading,
// recibir respuesta, no doble submit, errores claros.
export default defineConfig({
  testDir: './tests/e2e',
  // tests/audit/ contiene specs de auditoría visual (screenshots) que NO
  // corren en la suite default. Se invocan con `npm run test:audit`.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Local: limitamos a 2 workers. Con más, el Vite dev server compartido
  // satura y los tests de chromium-desktop empiezan a fallar por timeout
  // esperando que la pastilla de Nova se renderice. CI: idem.
  workers: 2,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },

  projects: [
    {
      // Mobile usa WebKit (motor real de iOS Safari y Capacitor WKWebView).
      // No es un Chromium con viewport mobile — es el engine que corre en
      // iPhone. Detecta bugs específicos de Safari (p.ej. requestIdleCallback
      // ausente, gestos pointer, viewport sticky). Si querés iterar más rápido
      // sin esto, comentá el project y dejá solo chromium-desktop.
      // Viewport 393x852 es el iPhone 14 Pro real en Capacitor full-screen
      // (sin barra Safari). El default de devices['iPhone 14 Pro'] usaba
      // 393x659 simulando barra de URL — falsamente reportaba contenido
      // bajo la nav bar que en device real está holgado.
      name: 'webkit-mobile',
      use: {
        ...devices['iPhone 14 Pro'],
        viewport: { width: 393, height: 852 },
      },
    },
    {
      name: 'chromium-desktop',
      // Optional existing Chrome, isolated by Playwright in a temporary profile.
      use: { ...devices['Desktop Chrome'], ...(process.env.FOCUS_PLAYWRIGHT_CHANNEL === 'chrome' ? { channel: 'chrome' } : {}) },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
})

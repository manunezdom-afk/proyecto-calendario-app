// ESLint 9 flat config — mantiene lint ligero, solo reglas útiles para
// encontrar bugs reales (no estilo, de eso se encarga Prettier).

import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly',
  fetch: 'readonly', Headers: 'readonly', Request: 'readonly', Response: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  console: 'readonly', Intl: 'readonly', Blob: 'readonly', FormData: 'readonly',
  SpeechSynthesisUtterance: 'readonly', speechSynthesis: 'readonly',
  AbortController: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
  matchMedia: 'readonly', crypto: 'readonly', atob: 'readonly', btoa: 'readonly',
  alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  File: 'readonly', FileReader: 'readonly', Image: 'readonly',
  Notification: 'readonly', ServiceWorkerRegistration: 'readonly',
  PushSubscription: 'readonly',
}

const nodeGlobals = {
  process: 'readonly', Buffer: 'readonly', global: 'readonly',
  __dirname: 'readonly', __filename: 'readonly',
  console: 'readonly', fetch: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  crypto: 'readonly', URL: 'readonly',
}

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'landing/**', 'coverage/**', 'supabase/**', 'scripts/**'],
  },
  js.configs.recommended,
  // Frontend (browser)
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18' } },
    rules: {
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-vars': 'error',
      'react/jsx-key': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'off',
      'no-constant-condition': ['warn', { checkLoops: false }],
    },
  },
  // Backend (serverless) + shared
  {
    files: ['api/**/*.{js,mjs}', 'netlify/functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'off',
    },
  },
  // Tests
  {
    files: ['**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...browserGlobals, vi: 'readonly' },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
]

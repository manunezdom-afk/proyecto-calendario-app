import { useEffect, useState } from 'react'
import { NOVA_PERSONALITY_IDS, DEFAULT_NOVA_PERSONALITY } from '../utils/novaPersonality'

// Preferencias locales del usuario que no viven en Supabase (aún).
// Se guardan por dispositivo en localStorage. Si más adelante agregamos la
// columna en user_profiles, este hook puede migrar a leer/escribir allí sin
// cambiar la API pública.

const STORAGE_KEY = 'focus_app_prefs_v1'

// Comportamiento por defecto al crear un evento sin duración explícita.
//   'ask'       → mostrar chips y pedir al usuario (default actual).
//   'default30' → asumir 30 min automáticamente y no molestar.
//   'none'      → guardar sin hora de término.
export const DEFAULT_DURATION_BEHAVIORS = ['ask', 'default30', 'none']

export const DEFAULT_PREFERENCES = {
  defaultDurationBehavior: 'ask',
  // Personalidad de Nova: afecta tono/framing de los mensajes que Nova dice
  // al usuario. NO cambia lógica de negocio ni hechos. Ver utils/novaPersonality.js
  novaPersonality: DEFAULT_NOVA_PERSONALITY,
}

// Validación explícita: si el localStorage tiene un valor viejo, inválido o
// proveniente de otra app, caemos al default sin romper la sesión.
function sanitize(raw) {
  const out = { ...DEFAULT_PREFERENCES, ...(raw && typeof raw === 'object' ? raw : {}) }
  if (!DEFAULT_DURATION_BEHAVIORS.includes(out.defaultDurationBehavior)) {
    out.defaultDurationBehavior = DEFAULT_PREFERENCES.defaultDurationBehavior
  }
  if (!NOVA_PERSONALITY_IDS.includes(out.novaPersonality)) {
    out.novaPersonality = DEFAULT_PREFERENCES.novaPersonality
  }
  return out
}

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES }
    const parsed = JSON.parse(raw)
    return sanitize(parsed)
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function useAppPreferences() {
  const [prefs, setPrefs] = useState(() => readFromStorage())

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)) } catch {}
  }, [prefs])

  // Sincronizar entre pestañas / vistas del mismo origen.
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== STORAGE_KEY) return
      setPrefs(readFromStorage())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function setPreference(key, value) {
    setPrefs((prev) => ({ ...prev, [key]: value }))
  }

  return { prefs, setPreference }
}

// Lectura puntual sin suscribirse (útil en handlers one-shot fuera de React).
export function readPreferenceSync(key) {
  return readFromStorage()[key]
}

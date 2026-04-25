// Preferencias de color por tipo (evento, tarea, recordatorio).
//
// El usuario elige un color para cada tipo desde Ajustes y se aplica en todo
// el calendario (Mi Día, vista semanal, vista de día) para que pueda escanear
// la agenda visualmente y distinguir de un vistazo qué es qué.
//
// Mismo patrón que taskLinks/taskParents: persistencia en localStorage por
// usuario, sin migración de DB. Si después se sube a Supabase (sync entre
// dispositivos), agregamos una columna en user_profiles.
//
// La paleta es CERRADA (6 colores) en vez de hex libre — así garantizamos
// contraste decente en light+dark, y Nova puede mapear nombres de color
// del usuario ("ponme las tareas en verde") a los presets.

export const COLOR_PALETTE = [
  { id: 'blue',    name: 'Azul',    hex: '#3b82f6', dot: '#3b82f6', tint: 'rgba(59,130,246,0.12)',  text: '#1d4ed8', ring: 'rgba(59,130,246,0.35)' },
  { id: 'violet',  name: 'Violeta', hex: '#8b5cf6', dot: '#8b5cf6', tint: 'rgba(139,92,246,0.12)',  text: '#6d28d9', ring: 'rgba(139,92,246,0.35)' },
  { id: 'emerald', name: 'Verde',   hex: '#10b981', dot: '#10b981', tint: 'rgba(16,185,129,0.12)',  text: '#047857', ring: 'rgba(16,185,129,0.35)' },
  { id: 'amber',   name: 'Ámbar',   hex: '#f59e0b', dot: '#f59e0b', tint: 'rgba(245,158,11,0.14)',  text: '#b45309', ring: 'rgba(245,158,11,0.4)'  },
  { id: 'rose',    name: 'Rosa',    hex: '#ec4899', dot: '#ec4899', tint: 'rgba(236,72,153,0.12)',  text: '#be185d', ring: 'rgba(236,72,153,0.35)' },
  { id: 'slate',   name: 'Grafito', hex: '#64748b', dot: '#64748b', tint: 'rgba(100,116,139,0.14)', text: '#334155', ring: 'rgba(100,116,139,0.35)' },
]

export const COLOR_BY_ID = Object.fromEntries(COLOR_PALETTE.map((c) => [c.id, c]))

// Defaults: matchean los colores históricos de la app.
//   evento     → azul (era bg-primary)
//   tarea      → violeta (era bg-secondary)
//   recordatorio → ámbar (siempre lo fue)
export const DEFAULT_PREFS = Object.freeze({
  event:    'blue',
  task:     'violet',
  reminder: 'amber',
})

const VALID_KINDS = ['event', 'task', 'reminder']

function keyFor(userId) {
  return userId ? `focus_color_prefs_${userId}` : 'focus_color_prefs'
}

export function getColorPrefs(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFS }
    return {
      event:    COLOR_BY_ID[parsed.event]    ? parsed.event    : DEFAULT_PREFS.event,
      task:     COLOR_BY_ID[parsed.task]     ? parsed.task     : DEFAULT_PREFS.task,
      reminder: COLOR_BY_ID[parsed.reminder] ? parsed.reminder : DEFAULT_PREFS.reminder,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function savePrefs(prefs, userId) {
  try { localStorage.setItem(keyFor(userId), JSON.stringify(prefs)) } catch {}
}

export function setColorPref(kind, colorId, userId) {
  if (!VALID_KINDS.includes(kind)) return false
  if (!COLOR_BY_ID[colorId]) return false
  const prefs = getColorPrefs(userId)
  if (prefs[kind] === colorId) return false
  prefs[kind] = colorId
  savePrefs(prefs, userId)
  // Disparamos un evento custom para que las vistas suscriptas re-renderen
  // sin necesidad de levantar el state a un context global. Ligero y suficiente
  // para una preferencia que cambia a baja frecuencia.
  try { window.dispatchEvent(new CustomEvent('focus:color-prefs-changed', { detail: { kind, colorId } })) } catch {}
  return true
}

export function resetColorPrefs(userId) {
  savePrefs({ ...DEFAULT_PREFS }, userId)
  try { window.dispatchEvent(new CustomEvent('focus:color-prefs-changed', { detail: { reset: true } })) } catch {}
}

// Helper: dado un evento o tarea, devuelve el id de la paleta que le toca
// según las prefs del usuario y su tipo. Centraliza la decisión "esto es
// recordatorio vs evento" para que no la tenga que duplicar cada vista.
export function colorIdForEvent(event, prefs, isReminder) {
  if (!prefs) return DEFAULT_PREFS.event
  return isReminder ? prefs.reminder : prefs.event
}

export function colorIdForTask(prefs) {
  return prefs?.task ?? DEFAULT_PREFS.task
}

// Hook ligero: lee prefs y se re-renderiza cuando cambian (vía evento custom).
// Usar dentro de los componentes de vista. Sin dependencias de context.
import { useEffect, useState } from 'react'
export function useColorPrefs(userId) {
  const [prefs, setPrefs] = useState(() => getColorPrefs(userId))
  useEffect(() => { setPrefs(getColorPrefs(userId)) }, [userId])
  useEffect(() => {
    const onChange = () => setPrefs(getColorPrefs(userId))
    window.addEventListener('focus:color-prefs-changed', onChange)
    return () => window.removeEventListener('focus:color-prefs-changed', onChange)
  }, [userId])
  return prefs
}

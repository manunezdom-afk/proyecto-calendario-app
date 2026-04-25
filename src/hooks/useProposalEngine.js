// ── useProposalEngine ──────────────────────────────────────────────────────
// Corre los detectores de proposalDetectors.js y empuja sugerencias reales a
// la bandeja vía addSuggestion. Mantiene los "sets de cosas ya propuestas"
// en localStorage para no spamear al usuario con la misma propuesta cada
// vez que abre la app o cambia algo.
//
// Diseño:
//  · Las claves de dedup viven en localStorage (no en estado React) para
//    sobrevivir reloads y pestañas paralelas.
//  · El hook se ejecuta en un useEffect que depende de events/tasks, así
//    los detectores corren cada vez que esos arrays cambian (incluyendo
//    refetch del backend, no solo creaciones locales).
//  · Las propuestas pasan por la pipeline existente (addSuggestion →
//    bandeja → applySuggestion al aprobar), así que aprovechan toda la
//    infraestructura de approve/reject ya construida.

import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  detectConflicts,
  detectRecurringCandidates,
  detectEveningReview,
} from '../utils/proposalDetectors'

const SEEN_KEYS_STORAGE_KEY = 'focus_proposal_seen_keys'
const MAX_SEEN_KEYS = 500 // cap para que el set no crezca infinito

function keyForUser(userId) {
  return userId ? `${SEEN_KEYS_STORAGE_KEY}_${userId}` : SEEN_KEYS_STORAGE_KEY
}

function loadSeen(userId) {
  try {
    const raw = localStorage.getItem(keyForUser(userId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function saveSeen(set, userId) {
  try {
    // Cap el tamaño: si pasa el max, mantenemos solo las últimas MAX_SEEN_KEYS.
    // Las claves se insertan en orden, así que toArray().slice(-MAX) es FIFO
    // suficiente para evitar growth unbounded.
    const arr = Array.from(set).slice(-MAX_SEEN_KEYS)
    localStorage.setItem(keyForUser(userId), JSON.stringify(arr))
  } catch {}
}

export function useProposalEngine({ events, tasks, addSuggestion, enabled = true }) {
  const { user } = useAuth()
  const seenRef = useRef(loadSeen(user?.id))
  const lastUserIdRef = useRef(user?.id)

  // Recargar el set cuando cambia el usuario (logout/login).
  useEffect(() => {
    if (lastUserIdRef.current !== user?.id) {
      seenRef.current = loadSeen(user?.id)
      lastUserIdRef.current = user?.id
    }
  }, [user?.id])

  // Detectores reactivos a events/tasks. Throttle implícito: react ya batchea
  // los re-renders, y el set de "seen" evita re-proponer aunque corra muchas
  // veces. No hace falta debouncing explícito.
  useEffect(() => {
    if (!enabled) return
    if (!Array.isArray(events) && !Array.isArray(tasks)) return

    const seen = seenRef.current
    const proposals = []

    // A) Conflictos
    if (Array.isArray(events) && events.length >= 2) {
      proposals.push(...detectConflicts(events, seen))
    }

    // B) Recurrencia
    if (Array.isArray(events) && events.length >= 3) {
      proposals.push(...detectRecurringCandidates(events, seen))
    }

    // C) Cierre del día — usa una clave dedicada en lugar del set general,
    // pero la incluimos en el mismo set para simplicidad. La clave incluye
    // la fecha del día, así que se "renueva" automáticamente cada día.
    if (Array.isArray(tasks) && tasks.length > 0) {
      const lastEveningKey = Array.from(seen).find((k) => k.startsWith('evening|'))
      const lastEveningDate = lastEveningKey ? lastEveningKey.split('|')[1] : null
      proposals.push(...detectEveningReview(tasks, lastEveningDate))
    }

    if (proposals.length === 0) return

    for (const { key, suggestion } of proposals) {
      if (seen.has(key)) continue
      addSuggestion(suggestion)
      seen.add(key)
    }
    saveSeen(seen, user?.id)
  }, [events, tasks, addSuggestion, enabled, user?.id])
}

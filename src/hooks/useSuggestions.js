import { useState, useEffect, useMemo, useCallback } from 'react'
import { dataService } from '../services/dataService'
import { logSignal } from '../services/signalsService'
import { useAuth } from '../context/AuthContext'
import { uid } from '../utils/uid'

// ── useSuggestions ──────────────────────────────────────────────────────────
// Gestiona la bandeja de sugerencias que Nova genera en "modo propuesta".
// El usuario aprueba/rechaza antes de que la acción se aplique al calendario.
export function useSuggestions() {
  const { user } = useAuth()

  const [suggestions, setSuggestions] = useState(() =>
    dataService.getCachedSuggestions()
  )

  useEffect(() => {
    if (!user) return
    dataService
      .fetchSuggestions(user.id)
      .then((cloud) => {
        setSuggestions(cloud)
        dataService.setCachedSuggestions(cloud)
      })
      .catch((err) => console.warn('[Focus] ⚠️ suggestions fetch', err))
  }, [user?.id])

  useEffect(() => {
    dataService.setCachedSuggestions(suggestions)
  }, [suggestions])

  const pending = useMemo(
    () => suggestions.filter((s) => s.status === 'pending'),
    [suggestions]
  )

  const pendingCount = pending.length

  const addSuggestion = useCallback(
    (suggestion) => {
      const full = {
        id: suggestion.id || uid('sug'),
        status: 'pending',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        ...suggestion,
      }
      setSuggestions((prev) => [full, ...prev])
      if (user) dataService.upsertSuggestion(full, user.id).catch(console.warn)
      return full
    },
    [user]
  )

  const markResolved = useCallback(
    (id, status) => {
      setSuggestions((prev) => {
        const target = prev.find((s) => s.id === id)
        const next = prev.map((s) =>
          s.id === id ? { ...s, status, resolvedAt: new Date().toISOString() } : s
        )
        const updated = next.find((s) => s.id === id)
        if (updated && user) dataService.upsertSuggestion(updated, user.id).catch(console.warn)
        // Señal: qué tipo de sugerencia aprobó/rechazó — clave para que Nova aprenda
        if (target) {
          logSignal(
            status === 'approved' ? 'suggestion_approved' : 'suggestion_rejected',
            { kind: target.kind || 'unknown', reason: target.reason || null }
          )
        }
        return next
      })
    },
    [user]
  )

  const approveSuggestion = useCallback((id) => markResolved(id, 'approved'), [markResolved])
  const rejectSuggestion = useCallback((id) => markResolved(id, 'rejected'), [markResolved])

  const deleteSuggestion = useCallback(
    (id) => {
      setSuggestions((prev) => prev.filter((s) => s.id !== id))
      if (user) dataService.deleteSuggestion(id, user.id).catch(console.warn)
    },
    [user]
  )

  const clearResolved = useCallback(() => {
    setSuggestions((prev) => {
      const resolvedIds = prev.filter((s) => s.status !== 'pending').map((s) => s.id)
      if (user) {
        resolvedIds.forEach((id) => dataService.deleteSuggestion(id, user.id).catch(console.warn))
      }
      return prev.filter((s) => s.status === 'pending')
    })
  }, [user])

  return {
    suggestions,
    pending,
    pendingCount,
    addSuggestion,
    approveSuggestion,
    rejectSuggestion,
    deleteSuggestion,
    clearResolved,
  }
}

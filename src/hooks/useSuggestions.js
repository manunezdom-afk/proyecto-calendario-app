import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { dataService } from '../services/dataService'
import { logSignal } from '../services/signalsService'
import { useAuth } from '../context/AuthContext'
import { prepareProposalBatch } from '../utils/pendingProposal.js'
import { advanceAccountEpoch, commitCachedCollection } from '../utils/verifiedMutation.js'

export function useSuggestions() {
  const { user } = useAuth()
  const epochRef = useRef(null)
  epochRef.current = advanceAccountEpoch(epochRef.current, user?.id)
  const collectionEpochRef = useRef(epochRef.current)
  const [suggestions, setSuggestionsState] = useState(() => dataService.getCachedSuggestions(user?.id))
  const suggestionsRef = useRef(suggestions)
  const versionRef = useRef(0)
  const setSuggestions = next => {
    suggestionsRef.current = next
    versionRef.current += 1
    setSuggestionsState(next)
  }
  const commit = next => collectionEpochRef.current === epochRef.current &&
    commitCachedCollection(next, value => dataService.setCachedSuggestions(value, user?.id), setSuggestions)

  useEffect(() => {
    const epoch = epochRef.current
    collectionEpochRef.current = epoch
    setSuggestions(dataService.getCachedSuggestions(user?.id))
    if (!user) return
    let cancelled = false
    const version = versionRef.current
    dataService.fetchSuggestions(user.id).then(cloud => {
      if (cancelled || epochRef.current !== epoch || versionRef.current !== version || !Array.isArray(cloud)) return
      setSuggestions(cloud)
      dataService.setCachedSuggestions(cloud, user.id)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [user?.id])

  const addSuggestion = useCallback(suggestion => {
    const full = { id: suggestion.id || crypto.randomUUID(), status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null, ...suggestion }
    const existing = suggestionsRef.current.find(item => item.id === full.id)
    if (existing) return existing
    if (!commit([full, ...suggestionsRef.current])) return null
    if (user) dataService.upsertSuggestion(full, user.id).catch(console.warn)
    return full
  }, [user?.id])

  const saveProposalBatch = useCallback((incoming, options = {}) => {
    const batch = prepareProposalBatch(suggestionsRef.current, incoming, options)
    if (!batch || !commit(batch.next)) return null
    if (user && batch.changed.length) dataService.upsertSuggestions(batch.changed, user.id).catch(console.warn)
    return batch.saved
  }, [user?.id])

  const markResolved = useCallback((id, status) => {
    const target = suggestionsRef.current.find(item => item.id === id)
    if (!target) return false
    const updated = { ...target, status, resolvedAt: new Date().toISOString() }
    if (!commit(suggestionsRef.current.map(item => item.id === id ? updated : item))) return false
    if (user) dataService.upsertSuggestion(updated, user.id).catch(console.warn)
    logSignal(status === 'approved' ? 'suggestion_approved' : 'suggestion_rejected', { kind: target.kind || 'unknown' })
    return true
  }, [user?.id])
  const approveSuggestion = useCallback(id => markResolved(id, 'approved'), [markResolved])
  const rejectSuggestion = useCallback(id => markResolved(id, 'rejected'), [markResolved])

  const deleteSuggestion = useCallback(id => {
    if (!suggestionsRef.current.some(item => item.id === id)) return false
    if (!commit(suggestionsRef.current.filter(item => item.id !== id))) return false
    if (user) dataService.deleteSuggestion(id, user.id).catch(console.warn)
    return true
  }, [user?.id])
  const clearResolved = useCallback(() => {
    const ids = suggestionsRef.current.filter(item => item.status !== 'pending').map(item => item.id)
    if (!commit(suggestionsRef.current.filter(item => item.status === 'pending'))) return false
    if (user) ids.forEach(id => dataService.deleteSuggestion(id, user.id).catch(console.warn))
    return true
  }, [user?.id])

  const visible = collectionEpochRef.current === epochRef.current ? suggestions : []
  const pending = useMemo(() => visible.filter(item => item.status === 'pending'), [visible])
  return { suggestions: visible, pending, pendingCount: pending.length, addSuggestion, saveProposalBatch, approveSuggestion, rejectSuggestion, deleteSuggestion, clearResolved }
}

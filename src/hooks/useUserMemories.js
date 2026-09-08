import { commitCachedCollection, advanceAccountEpoch } from '../utils/verifiedMutation.js'
import { useState, useEffect, useCallback, useRef } from 'react'
import { dataService } from '../services/dataService'
import { useAuth } from '../context/AuthContext'

const VALID_CATEGORIES = new Set([
  'fact', 'relationship', 'preference', 'goal', 'pain', 'routine', 'context',
])

function sanitize(input) {
  if (!input || typeof input !== 'object') return null
  const content = String(input.content ?? '').trim()
  if (!content) return null
  const category = VALID_CATEGORIES.has(input.category) ? input.category : 'fact'
  return {
    id: input.id ?? crypto.randomUUID(),
    category,
    subject: input.subject ? String(input.subject).trim().slice(0, 80) : null,
    content: content.slice(0, 500),
    confidence: ['high', 'medium', 'low'].includes(input.confidence) ? input.confidence : 'medium',
    source: ['conversation', 'inferred', 'user_edited'].includes(input.source) ? input.source : 'conversation',
    expiresAt: input.expiresAt ?? null,
    pinned: !!input.pinned,
    createdAt: input.createdAt ?? new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }
}

export function useUserMemories() {
  const { user } = useAuth()
  const accountEpochRef = useRef(null)
  accountEpochRef.current = advanceAccountEpoch(accountEpochRef.current, user?.id)
  const collectionEpochRef = useRef(accountEpochRef.current)
  const mutationVersionRef = useRef(0)
  const [memories, setMemoriesState] = useState(() => dataService.getCachedMemories(user?.id))
  const memoriesRef = useRef(memories)
  const setMemories = (next) => {
    const value = typeof next === 'function' ? next(memoriesRef.current) : next
    memoriesRef.current = value
    mutationVersionRef.current += 1
    setMemoriesState(value)
  }
  const commitMemories = (next) => {
    if (collectionEpochRef.current !== accountEpochRef.current) return false
    const saved = commitCachedCollection(next, value => dataService.setCachedMemories(value, user?.id), setMemories)
    if (saved && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('focus:memories-updated', { detail: { userId: user?.id, memories: next } }))
    return saved
  }
  useEffect(() => {
    const receive = event => {
      if (accountEpochRef.current.id === (user?.id || null) && event.detail?.userId === user?.id && Array.isArray(event.detail.memories)) setMemories(event.detail.memories)
    }
    window.addEventListener('focus:memories-updated', receive)
    return () => window.removeEventListener('focus:memories-updated', receive)
  }, [user?.id])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const epoch = accountEpochRef.current
    collectionEpochRef.current = epoch
    setMemories(dataService.getCachedMemories(user?.id))
    if (!user) { setLoaded(true); return }
    const version = mutationVersionRef.current
    let cancelled = false
    dataService.fetchMemories(user.id).then(cloud => {
      if (cancelled || accountEpochRef.current !== epoch) return
      if (Array.isArray(cloud) && mutationVersionRef.current === version) {
        setMemories(cloud)
        dataService.setCachedMemories(cloud, user.id)
      }
      setLoaded(true)
    }).catch(() => { if (!cancelled && accountEpochRef.current === epoch) setLoaded(true) })
    return () => { cancelled = true }
  }, [user?.id])

  const addMemory = useCallback((raw) => {
    const clean = sanitize(raw)
    if (!clean) return null
    const subject = clean.subject?.trim().toLowerCase() || null
    const existing = memoriesRef.current.find(memory => {
      if (memory.id === clean.id) return true
      if (memory.category !== clean.category) return false
      const currentSubject = memory.subject?.trim().toLowerCase() || null
      if (subject) return currentSubject === subject
      return !currentSubject && memory.content.toLowerCase() === clean.content.toLowerCase()
    })
    const saved = existing
      ? { ...existing, ...clean, id: existing.id, createdAt: existing.createdAt, pinned: existing.pinned }
      : clean
    const next = existing ? memoriesRef.current.map(memory => memory.id === existing.id ? saved : memory) : [saved, ...memoriesRef.current]
    if (!commitMemories(next)) return null
    if (user) dataService.upsertMemory(saved, user.id).catch(console.warn)
    return saved
  }, [user?.id])

  const updateMemory = useCallback((id, patch) => {
    const current = memoriesRef.current.find(memory => memory.id === id)
    if (!current) return null
    const next = sanitize({ ...current, ...patch, id, source: 'user_edited' })
    if (!next || !commitMemories(memoriesRef.current.map(memory => memory.id === id ? next : memory))) return null
    if (user) dataService.upsertMemory(next, user.id).catch(console.warn)
    return next
  }, [user?.id])

  const deleteMemory = useCallback((id) => {
    if (!memoriesRef.current.some(memory => memory.id === id)) return false
    if (!commitMemories(memoriesRef.current.filter(memory => memory.id !== id))) return false
    if (user) dataService.deleteMemory(id, user.id).catch(console.warn)
    return true
  }, [user?.id])

  const deleteMemories = useCallback((ids) => {
    if (!Array.isArray(ids) || !ids.length || !ids.every(id => memoriesRef.current.some(memory => memory.id === id))) return false
    if (!commitMemories(memoriesRef.current.filter(memory => !ids.includes(memory.id)))) return false
    if (user) ids.forEach(id => dataService.deleteMemory(id, user.id).catch(console.warn))
    return true
  }, [user?.id])

  const togglePin = useCallback((id) => {
    const current = memoriesRef.current.find(memory => memory.id === id)
    return current ? updateMemory(id, { pinned: !current.pinned }) : null
  }, [updateMemory])

  return { memories: collectionEpochRef.current === accountEpochRef.current ? memories : [], loaded, addMemory, updateMemory, deleteMemory, deleteMemories, togglePin }
}

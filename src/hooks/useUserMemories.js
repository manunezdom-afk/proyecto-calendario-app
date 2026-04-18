import { useState, useEffect, useCallback } from 'react'
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
  const [memories, setMemories] = useState(() => dataService.getCachedMemories())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user) { setLoaded(true); return }
    dataService.fetchMemories(user.id)
      .then(cloud => {
        if (Array.isArray(cloud)) {
          setMemories(cloud)
          dataService.setCachedMemories(cloud)
        }
        setLoaded(true)
      })
      .catch(err => {
        console.warn('[Focus] ⚠️ No se pudieron cargar memorias', err)
        setLoaded(true)
      })
  }, [user?.id])

  useEffect(() => {
    dataService.setCachedMemories(memories)
  }, [memories])

  const addMemory = useCallback((raw) => {
    const clean = sanitize(raw)
    if (!clean) return null
    setMemories(prev => {
      const existing = prev.find(m =>
        m.content.toLowerCase() === clean.content.toLowerCase()
        && m.category === clean.category
      )
      if (existing) {
        return prev.map(m => m.id === existing.id ? { ...m, lastSeenAt: clean.lastSeenAt } : m)
      }
      return [clean, ...prev]
    })
    if (user) dataService.upsertMemory(clean, user.id).catch(console.warn)
    return clean
  }, [user?.id])

  const updateMemory = useCallback((id, patch) => {
    setMemories(prev => {
      const idx = prev.findIndex(m => m.id === id)
      if (idx < 0) return prev
      const next = sanitize({ ...prev[idx], ...patch, id, source: 'user_edited' })
      if (!next) return prev
      const copy = [...prev]
      copy[idx] = next
      if (user) dataService.upsertMemory(next, user.id).catch(console.warn)
      return copy
    })
  }, [user?.id])

  const deleteMemory = useCallback((id) => {
    setMemories(prev => prev.filter(m => m.id !== id))
    if (user) dataService.deleteMemory(id, user.id).catch(console.warn)
  }, [user?.id])

  const togglePin = useCallback((id) => {
    setMemories(prev => {
      const target = prev.find(m => m.id === id)
      if (!target) return prev
      const next = { ...target, pinned: !target.pinned }
      if (user) dataService.upsertMemory(next, user.id).catch(console.warn)
      return prev.map(m => m.id === id ? next : m)
    })
  }, [user?.id])

  return { memories, loaded, addMemory, updateMemory, deleteMemory, togglePin }
}

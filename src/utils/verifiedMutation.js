// Mutation callers may confirm only after the synchronous local cache accepts
// the complete collection. Cloud synchronization remains a separate operation.
export function writeJsonCache(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true } catch { return false }
}

export function commitCachedCollection(next, write, publish) {
  if (!Array.isArray(next) || write(next) !== true) return false
  publish(next)
  return true
}

// Keep local pending values until the cloud contains the same persisted fields.
// Merely finding an ID does not acknowledge an edit.
export function mergePendingCollection(cloud, pending, valueKey, fields) {
  const keep = []
  for (const [id, entry] of pending) {
    const local = entry[valueKey]
    const remote = cloud.find(item => item.id === id)
    const matches = remote && fields.every(key => JSON.stringify(remote[key] ?? null) === JSON.stringify(local[key] ?? null))
    if (matches) pending.delete(id)
    else keep.push(local)
  }
  const ids = new Set(keep.map(item => item.id))
  return { merged: [...cloud.filter(item => !ids.has(item.id)), ...keep], pendingToKeep: keep }
}

export function advanceAccountEpoch(previous, userId) {
  const id = userId || null
  return previous?.id === id ? previous : { id, generation: (previous?.generation || 0) + 1 }
}

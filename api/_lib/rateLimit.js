const _rl = new Map()

export function rateLimited(ip, { max = 30, windowMs = 60_000 } = {}) {
  const now = Date.now()
  // This is only a bounded coarse IP shield. The database admission ledger
  // enforces per-user limits across workers independently of this cache.
  if (_rl.size >= 5000) {
    for (const [key, entry] of _rl) if (entry.reset < now) _rl.delete(key)
    if (_rl.size >= 5000) _rl.delete(_rl.keys().next().value)
  }
  const e = _rl.get(ip)
  if (!e || now > e.reset) {
    _rl.set(ip, { count: 1, reset: now + windowMs })
    return false
  }
  if (e.count >= max) return true
  e.count++
  return false
}

export function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  )
}

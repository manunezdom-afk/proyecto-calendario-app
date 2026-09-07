// POST /api/auth/delete-account
// Explicitly confirmed removal of the authenticated account. Hard deletion of
// auth.users triggers the private-data ON DELETE CASCADE foreign keys, including
// native/web push subscriptions and focus_events/focus_tasks.
// device_pairings is the exception: migration 002 uses ON DELETE SET NULL and
// stores email/token_hash, so those rows must be removed before the auth user.
// No successful response is returned when required cleanup or deletion fails.

import { rateLimited, clientIp } from '../_lib/rateLimit.js'
import { rejectCrossSiteUnsafe, setCorsHeaders } from '../_lib/security.js'
import { getSupabaseAdmin, getUserIdFromAuth } from '../_supabaseAdmin.js'

export const maxDuration = 30

// Dependency injection keeps endpoint contract tests independent of credentials,
// network requests, and destructive operations on a real Supabase installation.
export function createDeleteAccountHandler({
  resolveUserId = getUserIdFromAuth,
  getAdmin = getSupabaseAdmin,
  isRateLimited = rateLimited,
} = {}) {
  return async function handler(req, res) {
    setCorsHeaders(req, res, { methods: 'POST, OPTIONS' })
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    if (rejectCrossSiteUnsafe(req, res)) return
    if (isRateLimited(`delete-account:${clientIp(req)}`, { max: 5, windowMs: 60_000 })) {
      return res.status(429).json({ error: 'rate_limited' })
    }

    try {
      const userId = await resolveUserId(req)
      if (!userId) return res.status(401).json({ error: 'auth_required' })
      if (String(req.body?.confirm || '').trim() !== 'DELETE') {
        return res.status(400).json({ error: 'missing_confirmation' })
      }
      const admin = getAdmin()
      if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

      const { error: cleanupError } = await admin.from('device_pairings').delete().eq('user_id', userId)
      // PostgreSQL 42P01 confirms the optional table does not exist. A schema
      // cache error (PGRST205), permission failure, or timeout does not prove that
      // personal data is absent, so those errors must stop account deletion.
      if (cleanupError && cleanupError.code !== '42P01') {
        console.error('[delete-account] pairing cleanup failed')
        return res.status(500).json({ error: 'cleanup_failed' })
      }

      // Supabase auth-js GoTrueAdminApi.deleteUser(id, shouldSoftDelete = false):
      // true anonymizes the auth row instead of deleting it and does not provide
      // the FK cascade this endpoint promises. Explicit false requests hard delete.
      const { error } = await admin.auth.admin.deleteUser(userId, false)
      if (error) {
        console.error('[delete-account] auth deletion failed')
        return res.status(500).json({ error: 'delete_failed' })
      }
      return res.status(200).json({ ok: true })
    } catch {
      console.error('[delete-account] unexpected failure')
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createDeleteAccountHandler()

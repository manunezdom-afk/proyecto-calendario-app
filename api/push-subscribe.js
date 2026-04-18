// POST /api/push-subscribe
// Guarda o actualiza la Web Push subscription del usuario en Supabase.
// Body: { subscription: { endpoint, keys: { p256dh, auth } }, user_agent? }
// Auth: Bearer <access_token> de Supabase en el header Authorization.

import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const { subscription, user_agent = null } = req.body || {}
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'invalid_subscription' })
  }

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  try {
    const { error } = await admin
      .from('push_subscriptions')
      .upsert({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: user_agent ? String(user_agent).slice(0, 200) : null,
        last_used_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' })

    if (error) {
      console.warn('[push-subscribe] upsert error', error)
      return res.status(500).json({ error: 'db_error', message: error.message })
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[push-subscribe]', err)
    return res.status(500).json({ error: 'internal' })
  }
}

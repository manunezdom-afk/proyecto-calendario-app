// POST /api/push-unsubscribe
// Borra una suscripción por endpoint (propiedad del usuario autenticado).

import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const { endpoint } = req.body || {}
  if (!endpoint) return res.status(400).json({ error: 'missing_endpoint' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  try {
    const { error } = await admin
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
    if (error) return res.status(500).json({ error: 'db_error', message: error.message })
    return res.status(200).json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: 'internal' })
  }
}

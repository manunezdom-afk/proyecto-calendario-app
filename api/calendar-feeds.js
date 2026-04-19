/**
 * /api/calendar-feeds
 *
 * GET    → lista todos los feeds del usuario
 * POST   → crea un feed nuevo (body: { label, filter? })
 * DELETE → borra un feed por token (body: { token })
 *
 * Auth: Bearer <supabase_access_token> en header Authorization.
 */

import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'

function generateToken() {
  // 32 bytes = 256 bits, URL-safe base64
  const bytes = new Uint8Array(32)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let b64 = Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend' })

  if (req.method === 'GET') {
    const { data, error } = await admin
      .from('calendar_feeds')
      .select('token, label, filter, created_at, last_read_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: 'db_error' })
    return res.status(200).json({ feeds: data || [] })
  }

  if (req.method === 'POST') {
    const { label = 'Focus', filter = {} } = req.body || {}
    const token = generateToken()
    const { error } = await admin.from('calendar_feeds').insert({
      token, user_id: userId, label: String(label).slice(0, 80),
      filter,
    })
    if (error) return res.status(500).json({ error: 'db_error', message: error.message })
    return res.status(200).json({
      token,
      label,
      feed_url: `${req.headers.origin || ''}/api/ics-feed?token=${token}`,
    })
  }

  if (req.method === 'DELETE') {
    const { token } = req.body || {}
    if (!token) return res.status(400).json({ error: 'missing_token' })
    const { error } = await admin
      .from('calendar_feeds')
      .delete()
      .eq('user_id', userId)
      .eq('token', token)
    if (error) return res.status(500).json({ error: 'db_error' })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'method_not_allowed' })
}

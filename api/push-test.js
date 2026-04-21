// POST /api/push-test
// Envía una notificación de prueba a todas las suscripciones del usuario
// autenticado. Ignora dedup/sent_notifications — es para validar el flujo.
// Auth: Bearer <access_token> de Supabase.
// Respuesta incluye el detalle de cuántas fueron enviadas/fallaron para debug.

import webpush from 'web-push'
import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'

function configureWebPush() {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL || 'mailto:admin@focus.app'
  if (!pub || !priv) return false
  webpush.setVapidDetails(email, pub, priv)
  return true
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  if (!configureWebPush()) {
    return res.status(503).json({ error: 'vapid_not_configured' })
  }

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (error) return res.status(500).json({ error: 'db_error', message: error.message })
  if (!subs?.length) return res.status(404).json({ error: 'no_subscriptions_for_user' })

  const payload = {
    title: 'Notificación de prueba',
    body: 'Si ves esto, el flujo push funciona de punta a punta.',
    url: '/',
    tag: 'focus-test',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { kind: 'test' },
  }

  const results = []
  const deadEndpoints = []

  await Promise.all(subs.map(async (row) => {
    const sub = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), {
        TTL: 60,
        urgency: 'high',
        contentEncoding: 'aes128gcm',
      })
      results.push({ endpoint: row.endpoint.slice(0, 60) + '…', ok: true })
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        deadEndpoints.push(row.endpoint)
      }
      results.push({
        endpoint: row.endpoint.slice(0, 60) + '…',
        ok: false,
        statusCode: err?.statusCode,
        body: err?.body?.toString?.().slice(0, 200),
      })
    }
  }))

  if (deadEndpoints.length > 0) {
    await admin.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
  }

  const sent = results.filter(r => r.ok).length
  return res.status(200).json({
    ok: sent > 0,
    sent,
    failed: results.length - sent,
    subscriptions: results.length,
    results,
  })
}

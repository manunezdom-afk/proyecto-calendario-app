// POST /api/push — endpoint consolidado para Web Push.
// Se unificó con los antiguos /api/push-subscribe, /api/push-unsubscribe,
// /api/push-snooze y /api/push-test para respetar el límite de 12 funciones
// serverless del plan Hobby de Vercel.
//
// Body: { action: 'subscribe' | 'unsubscribe' | 'snooze' | 'test', ... }
// Auth (Bearer Supabase) requerido para subscribe, unsubscribe y test.
// Snooze se deja sin auth porque lo llama el service worker sin token.

import webpush from 'web-push'
import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const body = req.body || {}
  const action = typeof body.action === 'string' ? body.action : ''

  switch (action) {
    case 'subscribe':   return handleSubscribe(req, res, body)
    case 'unsubscribe': return handleUnsubscribe(req, res, body)
    case 'snooze':      return handleSnooze(req, res, body)
    case 'test':        return handleTest(req, res, body)
    case 'health':      return handleHealth(req, res, body)
    default:            return res.status(400).json({ error: 'invalid_action' })
  }
}

async function handleSubscribe(req, res, body) {
  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const { subscription, user_agent = null } = body
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
      console.warn('[push:subscribe] upsert error', error)
      return res.status(500).json({ error: 'db_error', message: error.message })
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[push:subscribe]', err)
    return res.status(500).json({ error: 'internal' })
  }
}

async function handleUnsubscribe(req, res, body) {
  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const { endpoint } = body
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
  } catch {
    return res.status(500).json({ error: 'internal' })
  }
}

async function handleSnooze(req, res, body) {
  // El SW no adjunta token, igual que antes; eventId + endpoint son prueba suficiente.
  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
  if (!eventId || !ID_RE.test(eventId)) {
    return res.status(400).json({ error: 'missing_eventId' })
  }

  const parsed = parseInt(body.minutes, 10)
  const minutes = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 10, 1440))

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  try {
    await admin.from('sent_notifications')
      .update({ sent_at: snoozeUntil })
      .eq('event_id', eventId)
    return res.status(200).json({ ok: true, snoozeUntil, minutes })
  } catch (err) {
    console.error('[push:snooze]', err)
    return res.status(500).json({ error: 'internal' })
  }
}

// health — devuelve cuántas suscripciones tiene el usuario en el backend.
// Lo usa el cliente al abrir la app: si el backend reporta 0 pero el navegador
// dice que hay PushManager.getSubscription() local, significa que la
// suscripción fue revocada (APNs 410 → delete en el cron). En ese caso el
// cliente debe re-suscribirse con endpoint fresco.
//
// Además devolvemos si el endpoint que pasó el cliente en `endpoint` está
// presente, para que el cliente verifique específicamente SU endpoint
// (útil cuando hay varios dispositivos del mismo usuario).
async function handleHealth(req, res, body) {
  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('endpoint, user_agent, last_used_at')
    .eq('user_id', userId)

  if (error) return res.status(500).json({ error: 'db_error', message: error.message })

  const subscriptionCount = subs?.length ?? 0
  const currentEndpoint = typeof body.endpoint === 'string' ? body.endpoint : null
  const currentPresent = currentEndpoint
    ? subs?.some((s) => s.endpoint === currentEndpoint)
    : null

  return res.status(200).json({
    ok: true,
    subscriptionCount,
    currentPresent, // true | false | null
  })
}

async function handleTest(req, res) {
  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL || 'mailto:admin@focus.app'
  if (!pub || !priv) return res.status(503).json({ error: 'vapid_not_configured' })
  webpush.setVapidDetails(email, pub, priv)

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
    const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), {
        TTL: 60, urgency: 'high', contentEncoding: 'aes128gcm',
      })
      results.push({ endpoint: row.endpoint.slice(0, 60) + '…', ok: true })
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) deadEndpoints.push(row.endpoint)
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

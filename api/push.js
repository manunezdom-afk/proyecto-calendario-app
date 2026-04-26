// POST /api/push — endpoint consolidado para Web Push.
// Se unificó con los antiguos /api/push-subscribe, /api/push-unsubscribe,
// /api/push-snooze y /api/push-test para respetar el límite de 12 funciones
// serverless del plan Hobby de Vercel.
//
// Body: { action: 'subscribe' | 'unsubscribe' | 'native_subscribe' |
//         'native_unsubscribe' | 'snooze' | 'test', ... }
// Auth (Bearer Supabase) requerido para subscribe, unsubscribe, native_* y test.
// Snooze se deja sin auth porque lo llama el service worker sin token.

import webpush from 'web-push'
import { getSupabaseAdmin, getUserIdFromAuth } from './_supabaseAdmin.js'
import { getApnsConfig, normalizeApnsToken, sendApnsNotification } from './_lib/apns.js'
import { rejectCrossSiteUnsafe, setCorsHeaders } from './_lib/security.js'

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS' })
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (rejectCrossSiteUnsafe(req, res)) return

  const body = req.body || {}
  const action = typeof body.action === 'string' ? body.action : ''

  switch (action) {
    case 'subscribe':   return handleSubscribe(req, res, body)
    case 'unsubscribe': return handleUnsubscribe(req, res, body)
    case 'native_subscribe':   return handleNativeSubscribe(req, res, body)
    case 'native_unsubscribe': return handleNativeUnsubscribe(req, res, body)
    case 'snooze':      return handleSnooze(req, res, body)
    case 'test':        return handleTest(req, res, body)
    case 'health':      return handleHealth(req, res, body)
    case 'renew':       return handleRenew(req, res, body)
    default:            return res.status(400).json({ error: 'invalid_action' })
  }
}

async function handleNativeSubscribe(req, res, body) {
  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const token = normalizeApnsToken(body.token)
  if (!token) return res.status(400).json({ error: 'invalid_native_token' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const config = getApnsConfig()
  const environment = body.environment === 'development' ? 'development' : config.environment
  const bundleId = typeof body.bundle_id === 'string' && body.bundle_id.trim()
    ? body.bundle_id.trim()
    : config.bundleId

  const { error } = await admin
    .from('native_push_tokens')
    .upsert({
      user_id: userId,
      token,
      platform: body.platform === 'android' ? 'android' : 'ios',
      environment,
      bundle_id: bundleId,
      user_agent: typeof body.user_agent === 'string' ? body.user_agent.slice(0, 200) : null,
      last_used_at: new Date().toISOString(),
    }, { onConflict: 'token' })

  if (error) return res.status(500).json({ error: 'db_error', message: error.message })
  return res.status(200).json({ ok: true, native: true })
}

async function handleNativeUnsubscribe(req, res, body) {
  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const token = normalizeApnsToken(body.token)
  if (!token) return res.status(400).json({ error: 'invalid_native_token' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const { error } = await admin
    .from('native_push_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('token', token)

  if (error) return res.status(500).json({ error: 'db_error', message: error.message })
  return res.status(200).json({ ok: true })
}

// handleRenew — reemplaza una suscripción expirada por una nueva, autenticando
// por posesión del endpoint viejo. El SW dispara pushsubscriptionchange sin
// acceso al JWT del usuario (corre aislado del main thread, sin sesión
// Supabase). Conocer el endpoint viejo — que es una URL opaca larga emitida
// por FCM/APNs solo al dispositivo suscrito — es prueba suficiente de que
// quien llama era el dueño de esa sub. Si el endpoint viejo no existe en la
// tabla, rechazamos. Esto cierra la fuga en la que APNs/FCM rotan la sub, el
// SW crea una nueva, pero el backend se queda con la vieja (muerta) y ya nadie
// recibe notificaciones hasta que el usuario abre la PWA otra vez.
async function handleRenew(req, res, body) {
  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const oldEndpoint = typeof body.old_endpoint === 'string' ? body.old_endpoint : null
  const sub = body.subscription
  if (!oldEndpoint) return res.status(400).json({ error: 'missing_old_endpoint' })
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: 'invalid_subscription' })
  }

  // Resolver dueño del endpoint viejo
  const { data: oldRow, error: findErr } = await admin
    .from('push_subscriptions')
    .select('user_id')
    .eq('endpoint', oldEndpoint)
    .maybeSingle()
  if (findErr) return res.status(500).json({ error: 'db_error', message: findErr.message })
  if (!oldRow?.user_id) return res.status(404).json({ error: 'old_endpoint_not_found' })

  const userId = oldRow.user_id

  try {
    // Upsert por endpoint (la nueva puede colisionar si raro caso)
    const { error: upErr } = await admin
      .from('push_subscriptions')
      .upsert({
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: typeof body.user_agent === 'string' ? body.user_agent.slice(0, 200) : null,
        last_used_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' })
    if (upErr) return res.status(500).json({ error: 'db_error', message: upErr.message })

    // Borrar la sub vieja (solo si es distinta a la nueva)
    if (oldEndpoint !== sub.endpoint) {
      await admin.from('push_subscriptions').delete().eq('endpoint', oldEndpoint)
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[push:renew]', err)
    return res.status(500).json({ error: 'internal' })
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
  // Autenticamos por posesión del endpoint push. El SW, aunque corra sin JWT,
  // sí tiene acceso a su propia PushSubscription — adjunta el endpoint en el
  // body. Lo resolvemos a user_id y snoozamos SOLO la notificación de ese
  // usuario. Antes se cotejaba solo por event_id, lo que permitía a cualquiera
  // que adivinara un event_id reprogramar notificaciones ajenas.
  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
  if (!eventId || !ID_RE.test(eventId)) {
    return res.status(400).json({ error: 'missing_eventId' })
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : null
  if (!endpoint) return res.status(400).json({ error: 'missing_endpoint' })

  const parsed = parseInt(body.minutes, 10)
  const minutes = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 10, 1440))

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  // Resolver owner por endpoint
  const { data: subRow, error: subErr } = await admin
    .from('push_subscriptions')
    .select('user_id')
    .eq('endpoint', endpoint)
    .maybeSingle()
  if (subErr) return res.status(500).json({ error: 'db_error', message: subErr.message })
  if (!subRow?.user_id) return res.status(404).json({ error: 'endpoint_not_found' })

  const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  try {
    await admin.from('sent_notifications')
      .update({ sent_at: snoozeUntil })
      .eq('event_id', eventId)
      .eq('user_id', subRow.user_id)
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

  let nativeTokenCount = 0
  let currentNativePresent = null
  try {
    const currentNativeToken = normalizeApnsToken(body.native_token)
    const { data: nativeTokens } = await admin
      .from('native_push_tokens')
      .select('token')
      .eq('user_id', userId)
    nativeTokenCount = nativeTokens?.length ?? 0
    currentNativePresent = currentNativeToken
      ? nativeTokens?.some((row) => row.token === currentNativeToken)
      : null
  } catch {}

  // Última entrega (best-effort): si la tabla notification_deliveries no
  // existe, el query devuelve error y mandamos `lastDelivery: null`.
  let lastDelivery = null
  try {
    const { data: lastRows } = await admin
      .from('notification_deliveries')
      .select('status, status_code, payload_title, sent_at')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .limit(1)
    if (lastRows?.[0]) {
      lastDelivery = {
        status: lastRows[0].status,
        statusCode: lastRows[0].status_code,
        title: lastRows[0].payload_title,
        sentAt: lastRows[0].sent_at,
      }
    }
  } catch {}

  return res.status(200).json({
    ok: true,
    subscriptionCount,
    nativeTokenCount,
    currentPresent, // true | false | null
    currentNativePresent, // true | false | null
    lastDelivery,   // { status, statusCode, title, sentAt } | null
  })
}

async function handleTest(req, res) {
  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (error) return res.status(500).json({ error: 'db_error', message: error.message })

  let nativeTokens = []
  try {
    const { data } = await admin
      .from('native_push_tokens')
      .select('token, environment, bundle_id')
      .eq('user_id', userId)
    nativeTokens = data || []
  } catch {}

  if (!subs?.length && !nativeTokens.length) {
    return res.status(404).json({ error: 'no_subscriptions_for_user' })
  }

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
  const deadNativeTokens = []

  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL || 'mailto:admin@focus.app'

  if (subs?.length) {
    if (pub && priv) {
      webpush.setVapidDetails(email, pub, priv)
      await Promise.all(subs.map(async (row) => {
        const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }
        try {
          await webpush.sendNotification(sub, JSON.stringify(payload), {
            TTL: 60, urgency: 'high', contentEncoding: 'aes128gcm',
          })
          results.push({ channel: 'web', endpoint: row.endpoint.slice(0, 60) + '…', ok: true })
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) deadEndpoints.push(row.endpoint)
          results.push({
            channel: 'web',
            endpoint: row.endpoint.slice(0, 60) + '…',
            ok: false,
            statusCode: err?.statusCode,
            body: err?.body?.toString?.().slice(0, 200),
          })
        }
      }))
    } else {
      subs.forEach((row) => results.push({
        channel: 'web',
        endpoint: row.endpoint.slice(0, 60) + '…',
        ok: false,
        error: 'vapid_not_configured',
      }))
    }
  }

  if (nativeTokens.length) {
    const apnsConfig = getApnsConfig()
    await Promise.all(nativeTokens.map(async (row) => {
      const result = await sendApnsNotification({
        token: row.token,
        payload,
        config: {
          ...apnsConfig,
          bundleId: row.bundle_id || apnsConfig.bundleId,
          environment: row.environment || apnsConfig.environment,
        },
      }).catch((err) => ({
        ok: false,
        statusCode: null,
        error: String(err?.message || err),
      }))
      if (!result.ok && (result.statusCode === 410 || /Unregistered|BadDeviceToken/i.test(result.error || ''))) {
        deadNativeTokens.push(row.token)
      }
      results.push({
        channel: 'apns',
        token: `${row.token.slice(0, 8)}…`,
        ok: result.ok,
        statusCode: result.statusCode,
        error: result.error,
      })
    }))
  }

  if (deadEndpoints.length > 0) {
    await admin.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
  }
  if (deadNativeTokens.length > 0) {
    await admin.from('native_push_tokens').delete().in('token', deadNativeTokens)
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

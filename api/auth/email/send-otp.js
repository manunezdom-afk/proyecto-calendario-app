// POST /api/auth/email/send-otp
// Bypasea el SMTP por defecto de Supabase: genera el OTP via admin.generateLink
// y lo entregamos vía Resend desde nuestro propio dominio. Resuelve dos
// problemas crónicos del SMTP por defecto: el límite de ~3-4 emails/hora del
// proyecto y la reputación de mail.app.supabase.io que cae a Spam.
//
// Body: { email }
// Response: { ok: true } | { error }
//
// Env vars requeridas: RESEND_API_KEY, EMAIL_FROM (ej "Focus <noreply@usefocus.me>").
// Si faltan, devolvemos 503 — la UI ya humaniza errores.

import { getSupabaseAdmin } from '../../_supabaseAdmin.js'
import { rateLimited, clientIp } from '../../_lib/rateLimit.js'
import { rejectCrossSiteUnsafe, setCorsHeaders } from '../../_lib/security.js'

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildEmail(otp) {
  const safe = escapeHtml(otp)
  const subject = `Tu código de Focus: ${otp}`
  const text = [
    'Tu código para iniciar sesión en Focus es:',
    '',
    `    ${otp}`,
    '',
    'Vence en una hora. Si no lo solicitaste, ignora este correo.',
  ].join('\n')
  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="440" style="max-width:440px;background:#ffffff;border-radius:20px;padding:32px;box-shadow:0 1px 3px rgba(15,23,42,.06)">
          <tr><td style="font-size:14px;color:#64748b;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Focus</td></tr>
          <tr><td style="padding-top:16px;font-size:20px;font-weight:700;line-height:1.3">Tu código para iniciar sesión</td></tr>
          <tr><td style="padding-top:24px">
            <div style="background:#f1f5f9;border-radius:14px;padding:18px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:.25em;color:#0f172a">${safe}</div>
          </td></tr>
          <tr><td style="padding-top:20px;font-size:14px;color:#475569;line-height:1.55">Pega o escribe este código en la app para entrar. Vence en una hora.</td></tr>
          <tr><td style="padding-top:24px;font-size:12px;color:#94a3b8;line-height:1.5">Si no solicitaste este código, ignora este correo. Nadie podrá iniciar sesión sin él.</td></tr>
        </table>
        <div style="padding-top:16px;font-size:11px;color:#94a3b8">usefocus.me</div>
      </td></tr>
    </table>
  </body>
</html>`
  return { subject, text, html }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS' })
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (rejectCrossSiteUnsafe(req, res)) return

  const ip = clientIp(req)
  if (rateLimited(`otp-ip:${ip}`, { max: 8, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' })
  }

  // Cap por email para que un atacante no pueda spamear la bandeja de un
  // usuario rotando la IP. 3/min se alinea con el cooldown de 60s del UI.
  if (rateLimited(`otp-email:${email}`, { max: 3, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!apiKey || !from) {
    console.error('[send-otp] missing RESEND_API_KEY or EMAIL_FROM')
    return res.status(503).json({ error: 'email_not_configured' })
  }

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_backend_supabase' })

  // Idempotente: si ya existe, Supabase devuelve "already registered" y
  // seguimos. email_confirm:true porque la verificación del OTP cumple el
  // mismo rol que el click en un magic link de confirmación.
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (createErr) {
    const msg = String(createErr.message || '').toLowerCase()
    const alreadyExists =
      msg.includes('already') || msg.includes('exists') || msg.includes('registered') ||
      Number(createErr.status) === 422
    if (!alreadyExists) {
      console.error('[send-otp] createUser', createErr)
      return res.status(500).json({ error: 'user_create_failed' })
    }
  }

  // generateLink({type:'magiclink'}) NO envía email — solo devuelve el OTP y
  // el hashed_token. El email lo mandamos nosotros via Resend.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const otp = linkData?.properties?.email_otp
  if (linkErr || !otp) {
    console.error('[send-otp] generateLink', linkErr)
    return res.status(500).json({ error: 'otp_generation_failed' })
  }

  const { subject, text, html } = buildEmail(otp)
  let resp
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [email], subject, text, html }),
    })
  } catch (err) {
    console.error('[send-otp] resend network', err)
    return res.status(502).json({ error: 'email_send_failed' })
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    console.error('[send-otp] resend http', resp.status, body.slice(0, 300))
    return res.status(502).json({ error: 'email_send_failed' })
  }

  return res.status(200).json({ ok: true })
}

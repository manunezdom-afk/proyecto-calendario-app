// Inbox cross-app: Kairos envía aquí los eventos que el usuario crea allá
// para que aparezcan como sugerencias en Focus. Nova las propone al usuario,
// que aprueba o rechaza antes de que entren a su calendario.
//
// POST /api/kairos/inbox
//   body { focusCode, event: { title, date, time, description, section, icon } }
//
// Auth: NO requiere Bearer del usuario — basta con el focusCode (que es
// público por diseño y el usuario controla regenerándolo desde Ajustes). Las
// sugerencias quedan en estado pending: nada se aplica al calendario hasta
// que el dueño las apruebe.
//
// Para evitar abuso desde IPs maliciosas mantenemos rate limit estricto por
// IP + por focusCode. Si alguien spamea sugerencias falsas, basta con que el
// usuario regenere el código.

import { setCorsHeaders, rejectCrossSiteUnsafe } from '../_lib/security.js'
import { rateLimited, clientIp } from '../_lib/rateLimit.js'
import { getSupabaseAdmin } from '../_supabaseAdmin.js'

export const maxDuration = 10

const SECTIONS = new Set(['Mañana', 'Tarde', 'Noche'])
const ICONS = new Set([
  'auto_awesome', 'school', 'work', 'fitness_center', 'restaurant',
  'event', 'medical_services', 'flight', 'self_improvement', 'book',
])

function clampString(value, max) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function validateEvent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = clampString(raw.title, 200)
  if (!title) return null
  const date = clampString(raw.date, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const time = clampString(raw.time, 32) || null
  const description = clampString(raw.description, 500) || null
  const section = SECTIONS.has(raw.section) ? raw.section : null
  const icon = ICONS.has(raw.icon) ? raw.icon : 'auto_awesome'
  return { title, date, time, description, section, icon }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS' })

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (rejectCrossSiteUnsafe(req, res)) return

  if (rateLimited(clientIp(req), { max: 60, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limit' })
  }

  const { focusCode, event } = req.body || {}
  const code = String(focusCode || '').trim().toUpperCase()
  if (!code || code.length < 4 || code.length > 32) {
    return res.status(400).json({ error: 'invalid_code' })
  }

  // Rate limit adicional por código: 30 sugerencias por hora por focusCode
  // protege al usuario aún si el atacante rota IPs.
  if (rateLimited(`kairos:${code}`, { max: 30, windowMs: 60 * 60_000 })) {
    return res.status(429).json({ error: 'rate_limit_code' })
  }

  const validated = validateEvent(event)
  if (!validated) return res.status(400).json({ error: 'invalid_event' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_supabase_admin' })

  try {
    const { data: link, error: linkErr } = await admin
      .from('kairos_links')
      .select('user_id')
      .eq('focus_code', code)
      .maybeSingle()
    if (linkErr || !link?.user_id) {
      // Devolvemos 404 sin pista del estado interno: si el código no existe
      // o nunca fue vinculado, la respuesta es la misma.
      return res.status(404).json({ error: 'unknown_code' })
    }

    const id = `kairos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const previewParts = [validated.date]
    if (validated.time) previewParts.push(validated.time)
    previewParts.push('Kairos')

    const { error: insErr } = await admin.from('suggestions').insert({
      id,
      user_id:       link.user_id,
      kind:          'add_event',
      payload:       {
        title:       validated.title,
        date:        validated.date,
        time:        validated.time,
        description: validated.description,
        section:     validated.section,
        icon:        validated.icon,
        source:      'kairos',
      },
      preview_title: `Crear: ${validated.title}`,
      preview_body:  previewParts.join(' · '),
      preview_icon:  validated.icon,
      reason:        'Sugerencia recibida desde Kairos.',
      status:        'pending',
      batch_id:      `kairos-${validated.date}`,
    })
    if (insErr) {
      console.error('[kairos/inbox] insert failed:', insErr.message)
      return res.status(500).json({ error: 'insert_failed' })
    }

    return res.status(200).json({ ok: true, suggestionId: id })
  } catch (err) {
    console.error('[kairos/inbox] unexpected:', err?.message || err)
    return res.status(500).json({ error: 'internal_error' })
  }
}

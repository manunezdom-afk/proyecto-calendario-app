// Vínculo Focus ↔ Kairos.
//
// GET  /api/kairos/link  → devuelve el focus_code del usuario (lo crea si no
//                          existe). Requiere Bearer token de Supabase.
// POST /api/kairos/link  → body { kairosCode } guarda el código de la cuenta
//                          de Kairos vinculada para que el usuario lo vea en
//                          Ajustes y pueda confirmar el vínculo.
// PATCH /api/kairos/link → regenera el focus_code (revoca el anterior).
//
// El focus_code es identificador, no secreto: 6 caracteres alfanuméricos
// legibles (sin O/0/I/1) para evitar que el usuario lo confunda al copiarlo.

import { setCorsHeaders, rejectCrossSiteUnsafe } from '../_lib/security.js'
import { rateLimited, clientIp } from '../_lib/rateLimit.js'
import { getSupabaseAdmin, getUserIdFromAuth } from '../_supabaseAdmin.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

export const maxDuration = 10

function generateCode() {
  const arr = new Uint8Array(CODE_LENGTH)
  // Web Crypto está disponible en Node 18+. Si no, fallback a Math.random.
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < CODE_LENGTH; i += 1) arr[i] = Math.floor(Math.random() * 256)
  }
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length]
  }
  return out
}

async function ensureFocusCode(admin, userId) {
  const { data: existing } = await admin
    .from('kairos_links')
    .select('focus_code, kairos_code, linked_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing?.focus_code) return existing

  // Reintentamos hasta 5 veces si hay colisión con focus_code (UNIQUE).
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const focusCode = generateCode()
    const { data, error } = await admin
      .from('kairos_links')
      .insert({ user_id: userId, focus_code: focusCode })
      .select('focus_code, kairos_code, linked_at')
      .single()
    if (!error && data) return data
    // Cualquier otro error: salimos del loop. Colisión típica trae código
    // 23505 (unique_violation) — seguimos.
    if (error && error.code !== '23505') {
      throw error
    }
  }
  throw new Error('focus_code_generation_failed')
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, POST, PATCH, OPTIONS' })

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (rejectCrossSiteUnsafe(req, res)) return

  if (rateLimited(clientIp(req), { max: 30, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'rate_limit' })
  }

  const userId = await getUserIdFromAuth(req)
  if (!userId) return res.status(401).json({ error: 'auth_required' })

  const admin = getSupabaseAdmin()
  if (!admin) return res.status(503).json({ error: 'no_supabase_admin' })

  try {
    if (req.method === 'GET') {
      const link = await ensureFocusCode(admin, userId)
      return res.status(200).json({
        focusCode: link.focus_code,
        kairosCode: link.kairos_code || null,
        linkedAt:   link.linked_at || null,
      })
    }

    if (req.method === 'POST') {
      const { kairosCode } = req.body || {}
      const cleaned = String(kairosCode || '').trim().toUpperCase().replace(/\s+/g, '')
      if (!cleaned || cleaned.length < 4 || cleaned.length > 32) {
        return res.status(400).json({ error: 'invalid_code' })
      }
      // Aseguramos que la fila exista antes de actualizar el kairos_code.
      await ensureFocusCode(admin, userId)
      const { data, error } = await admin
        .from('kairos_links')
        .update({
          kairos_code: cleaned,
          linked_at:   new Date().toISOString(),
          updated_at:  new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select('focus_code, kairos_code, linked_at')
        .single()
      if (error) {
        console.error('[kairos] link update failed:', error.message)
        return res.status(500).json({ error: 'link_failed' })
      }
      return res.status(200).json({
        focusCode: data.focus_code,
        kairosCode: data.kairos_code,
        linkedAt:   data.linked_at,
      })
    }

    if (req.method === 'PATCH') {
      // Regenera el focus_code — invalida el anterior. El kairos_code se
      // mantiene salvo que el usuario también lo borre (clear=true).
      const { clear } = req.body || {}
      const newCode = generateCode()
      const update = {
        focus_code: newCode,
        updated_at: new Date().toISOString(),
      }
      if (clear) {
        update.kairos_code = null
        update.linked_at   = null
      }
      const { data, error } = await admin
        .from('kairos_links')
        .upsert({ user_id: userId, ...update })
        .select('focus_code, kairos_code, linked_at')
        .single()
      if (error) {
        console.error('[kairos] regenerate failed:', error.message)
        return res.status(500).json({ error: 'regenerate_failed' })
      }
      return res.status(200).json({
        focusCode: data.focus_code,
        kairosCode: data.kairos_code,
        linkedAt:   data.linked_at,
      })
    }

    return res.status(405).json({ error: 'method_not_allowed' })
  } catch (err) {
    console.error('[kairos/link] unexpected:', err?.message || err)
    return res.status(500).json({ error: 'internal_error' })
  }
}

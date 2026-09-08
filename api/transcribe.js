import { getUserIdFromAuth } from './_supabaseAdmin.js'
import { rejectCrossSiteUnsafe, setCorsHeaders } from './_lib/security.js'

// Native Focus uses on-device speech recognition. The legacy paid endpoint
// stays closed until media duration can be verified before a cost reservation;
// file size alone cannot bound minutes of compressed audio.
export default async function handler(req, res) {
  setCorsHeaders(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (rejectCrossSiteUnsafe(req, res)) return
  if (!await getUserIdFromAuth(req)) return res.status(401).json({ error: 'auth_required' })
  res.setHeader('Cache-Control', 'no-store')
  return res.status(503).json({ error: 'voice_ai_unavailable',
    message: 'La transcripción en servidor está pausada. Puedes escribir o usar el dictado local de Focus en iPhone.' })
}

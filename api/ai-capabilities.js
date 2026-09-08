import { setCorsHeaders } from './_lib/security.js'

// Consent boundary during coordinated deployments. Clients read this before
// sending any conversation to the server. No key, user data or model tier leaks.
// This identifies deployed code, not provider availability or billing health.
export default function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, OPTIONS' })
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
  return res.status(200).json({ runtime: 'focus-openai-v1', chat_provider: 'openai' })
}

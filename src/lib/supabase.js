import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('[Focus] Supabase env vars missing — running in offline/demo mode.')
}

export const supabase = url && key ? createClient(url, key) : null

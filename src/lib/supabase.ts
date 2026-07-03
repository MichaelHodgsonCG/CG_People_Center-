import { createClient } from '@supabase/supabase-js'

// Single browser client, anon key + RLS only. Service-role keys never reach
// the browser; server-side work belongs in edge functions.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env and fill in values.',
  )
}

// detectSessionInUrl is off: the ONLY way tokens arrive via URL is the CGOPS
// SSO handoff fragment, consumed deterministically by cgopsSso.ts — two
// parsers racing over the same fragment is how sessions get dropped.
export const supabase = createClient(url, anonKey, {
  auth: { detectSessionInUrl: false },
})

import { createClient } from '@supabase/supabase-js'
import { markActivity } from './sessionActivity'

// Single browser client, anon key + RLS only. Service-role keys never reach
// the browser; server-side work belongs in edge functions.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env and fill in values.',
  )
}

// Counts data/API calls as user activity for the platform inactivity timeout
// (see SessionTimeoutManager). Auth-endpoint traffic is excluded: supabase-js
// refreshes tokens on its own schedule, and counting that would keep an idle
// session alive forever. (Verbatim from CGOPS src/lib/supabase.ts — CGOPS is
// the platform authority for session timeout.)
const activityTrackingFetch: typeof fetch = (input, init) => {
  const target =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!target.includes('/auth/v1/')) markActivity()
  return fetch(input, init)
}

// detectSessionInUrl is off: the ONLY way tokens arrive via URL is the CGOPS
// SSO handoff fragment, consumed deterministically by cgopsSso.ts — two
// parsers racing over the same fragment is how sessions get dropped.
export const supabase = createClient(url, anonKey, {
  auth: { detectSessionInUrl: false },
  global: { fetch: activityTrackingFetch },
})

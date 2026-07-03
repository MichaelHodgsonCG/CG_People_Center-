// Phase A CGOPS SSO handoff — receiving side (compatibility only).
//
// CGOPS launches People Center in a new tab with session tokens in the URL
// fragment:
//
//   https://<people-center>/#cgops_sso=1&access_token=...&refresh_token=...
//
// Both apps run against the same CGOPS Supabase project, so the tokens drop
// straight into this app's Supabase client via setSession() — no legacy
// auth, no signup path, no auth triggers; users exist only in CGOPS.
//
// The fragment is removed from the address bar IMMEDIATELY after parsing,
// success or failure: fragments never reach servers, but they do land in
// browser history and are readable by anything inspecting location. A failed
// handoff simply leaves no session, and App redirects back to CGOPS.

import { supabase } from '../../lib/supabase'

export type SsoHandoffResult = 'consumed' | 'none' | 'failed'

export async function consumeCgopsSsoHandoff(): Promise<SsoHandoffResult> {
  const hash = window.location.hash
  if (!hash.includes('cgops_sso=1')) return 'none'

  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const isHandoff = params.get('cgops_sso') === '1'
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')

  // Strip the fragment before doing anything else with the tokens.
  history.replaceState(null, '', window.location.pathname + window.location.search)

  if (!isHandoff) return 'none'
  if (!accessToken || !refreshToken) {
    console.error('CGOPS SSO handoff: fragment present but tokens missing')
    return 'failed'
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (error) {
    console.error('CGOPS SSO handoff failed:', error.message)
    return 'failed'
  }
  return 'consumed'
}

import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { UserProfile } from '../../types'

// Session + app profile in one hook. The app's role detection reads
// people_center_user_profiles.role through this hook and nothing else — no
// cached role state. A missing row or a fetch error is SURFACED
// (profileError / profile === null shows in the user menu), never swallowed.
//
// TODO(cgops-authority): people_center_user_profiles is a TEMPORARY
// compatibility layer after the CGOPS lift-and-shift — CGOPS profiles are
// the identity/role authority. This is the app's ONLY profile query; Phase B
// of docs/RUNBOOK_CGOPS_LIFT_AND_SHIFT.md repoints it at the CGOPS profile
// table (with a role mapping) and then drops the People Center tables.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setProfileError(null)
      return
    }
    let cancelled = false
    supabase
      .from('people_center_user_profiles')
      .select('*')
      .eq('auth_user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setProfile(null)
          setProfileError(error.message)
        } else {
          setProfile((data as UserProfile | null) ?? null)
          setProfileError(
            data
              ? null
              : 'No people_center_user_profiles row for this login — run the admin bootstrap SQL (README).',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [session])

  return { session, profile, profileError, loading }
}

export async function signOut() {
  await supabase.auth.signOut()
}

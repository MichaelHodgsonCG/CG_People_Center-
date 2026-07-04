// Users panel (admin-only) — the role-and-linkage surface for the identity
// workflow: CGOPS invites create the login, the signup trigger auto-links
// the directory person by email and lands at viewer (migration
// 20260708090000); THIS screen is where an admin deliberately elevates a
// role or fixes a missed link. No SQL-editor step remains in onboarding.
//
// Phase B note: when CGOPS profiles become the only identity store, this
// panel's write path repoints there — the workflow (elevation is a
// deliberate admin act, in one place) stays identical.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertTriangle, CheckCircle2, Link2, UserCog } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { actorFrom, recordAudit } from '../../lib/activity'
import type { AppRole, UserProfile } from '../../types'

const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  executive: 'Executive (HQ)',
  regional_leader: 'Regional leader',
  location_leader: 'Location leader',
  viewer: 'Viewer (read-only)',
}

interface PersonOption {
  id: string
  full_name: string
  email: string | null
}

interface Draft {
  role: AppRole
  person_id: string | null
}

export function UsersView({
  session,
  profile,
}: {
  session: Session
  profile: UserProfile | null
}) {
  const actor = actorFrom(profile, session)
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [people, setPeople] = useState<PersonOption[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    Promise.all([
      supabase
        .from('people_center_user_profiles')
        .select('*')
        .order('email'),
      supabase
        .from('people_center_people')
        .select('id, full_name, email')
        .neq('status', 'departed')
        .order('full_name'),
    ])
      .then(([p, ppl]) => {
        if (p.error) throw p.error
        if (ppl.error) throw ppl.error
        setProfiles((p.data as UserProfile[]) ?? [])
        setPeople((ppl.data as PersonOption[]) ?? [])
        setDrafts({})
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const personName = useMemo(
    () => new Map(people.map((p) => [p.id, p.full_name])),
    [people],
  )

  function draftFor(row: UserProfile): Draft {
    return drafts[row.id] ?? { role: row.role, person_id: row.person_id }
  }

  function setDraft(row: UserProfile, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [row.id]: { ...draftFor(row), ...patch } }))
    setSavedId(null)
  }

  function isDirty(row: UserProfile): boolean {
    const d = drafts[row.id]
    return !!d && (d.role !== row.role || d.person_id !== row.person_id)
  }

  async function save(row: UserProfile) {
    const d = draftFor(row)
    setSavingId(row.id)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('people_center_user_profiles')
        .update({
          role: d.role,
          person_id: d.person_id,
          updated_by_name: actor.name,
        })
        .eq('id', row.id)
        .select('id')
      if (err) throw err
      if (!data || data.length === 0) {
        throw new Error('The database did not accept this change (admin-only).')
      }
      await recordAudit(
        actor,
        'update',
        'user_profile',
        row.id,
        row.email,
        `Role ${row.role} → ${d.role}` +
          (d.person_id !== row.person_id
            ? `; linked person ${d.person_id ? personName.get(d.person_id) ?? d.person_id : 'cleared'}`
            : ''),
      )
      setSavedId(row.id)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingId(null)
    }
  }

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading users…</p>
  if (error && profiles.length === 0) {
    return <p className="p-6 text-sm text-danger">Could not load users: {error}</p>
  }

  const unlinked = profiles.filter((p) => !p.person_id).length

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-medium">
        <UserCog className="h-5 w-5 text-charcoal/60" /> Users
      </h2>
      <p className="mb-4 max-w-2xl text-sm text-charcoal/60">
        Logins are created by inviting people through CGOPS; each one appears
        here automatically, linked to their directory person by email and set
        to read-only. Elevating a role is a deliberate act — it happens here
        and nowhere else. (Uploads and syncs never grant access.)
      </p>

      <p className="mb-3 text-xs uppercase tracking-wide text-charcoal/50">
        {profiles.length} user{profiles.length === 1 ? '' : 's'}
        {unlinked > 0 && (
          <span className="ml-2 text-warning">
            · {unlinked} not linked to a directory person
          </span>
        )}
      </p>

      {error && (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-surface-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
              <th className="px-4 py-3 font-medium">Login</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Directory person</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((row) => {
              const d = draftFor(row)
              return (
                <tr key={row.id} className="border-b border-surface-line/60 align-top last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{row.display_name ?? row.email}</p>
                    {row.display_name && (
                      <p className="text-xs text-charcoal/50">{row.email}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={d.role}
                      onChange={(e) => setDraft(row, { role: e.target.value as AppRole })}
                      className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {!d.person_id && (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                      )}
                      <select
                        value={d.person_id ?? ''}
                        onChange={(e) =>
                          setDraft(row, { person_id: e.target.value || null })
                        }
                        className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
                      >
                        <option value="">— not linked —</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name}
                            {p.email ? ` (${p.email})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {isDirty(row) ? (
                      <button
                        onClick={() => void save(row)}
                        disabled={savingId === row.id}
                        className="rounded-md bg-cg-orange px-3 py-1.5 text-xs font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
                      >
                        {savingId === row.id ? 'Saving…' : 'Save'}
                      </button>
                    ) : savedId === row.id ? (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                      </span>
                    ) : row.person_id ? (
                      <span className="flex items-center gap-1 text-xs text-charcoal/40">
                        <Link2 className="h-3.5 w-3.5" /> linked
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-charcoal/45">
        Every change here is written to the audit log. This screen manages the
        Phase A compatibility profiles; when Phase B makes CGOPS the single
        identity store, the same workflow moves to CGOPS Admin Center.
      </p>
    </div>
  )
}

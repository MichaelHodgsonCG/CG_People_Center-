import { useEffect, useMemo, useState } from 'react'
import { Search, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface DirectoryPerson {
  id: string
  full_name: string
  preferred_name: string | null
  status: 'active' | 'leave' | 'departed'
  person_kind: 'manager' | 'emerging_leader' | 'key_team_member'
  position_assignments: {
    is_primary: boolean
    ended_on: string | null
    positions: { name: string } | null
    locations: { name: string } | null
  }[]
}

const KIND_LABELS: Record<DirectoryPerson['person_kind'], string> = {
  manager: 'Manager',
  emerging_leader: 'Emerging leader',
  key_team_member: 'Key team member',
}

function currentPrimary(person: DirectoryPerson) {
  return (
    person.position_assignments.find((a) => a.is_primary && !a.ended_on) ??
    person.position_assignments.find((a) => !a.ended_on) ??
    null
  )
}

export function DirectoryView({ isAdmin }: { isAdmin?: boolean }) {
  const [people, setPeople] = useState<DirectoryPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('people')
      .select(
        `id, full_name, preferred_name, status, person_kind,
         position_assignments ( is_primary, ended_on,
           positions ( name ), locations ( name ) )`,
      )
      .neq('status', 'departed')
      .order('full_name')
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else setPeople((data as unknown as DirectoryPerson[]) ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const locations = useMemo(() => {
    const names = new Set<string>()
    for (const p of people) {
      const loc = currentPrimary(p)?.locations?.name
      if (loc) names.add(loc)
    }
    return [...names].sort()
  }, [people])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people.filter((p) => {
      const primary = currentPrimary(p)
      if (q && !p.full_name.toLowerCase().includes(q)) return false
      if (locationFilter && primary?.locations?.name !== locationFilter) return false
      if (kindFilter && p.person_kind !== kindFilter) return false
      return true
    })
  }, [people, query, locationFilter, kindFilter])

  if (loading) {
    return <p className="p-6 text-sm text-charcoal/50">Loading directory…</p>
  }
  if (error) {
    return <p className="p-6 text-sm text-danger">Could not load directory: {error}</p>
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal/40" />
          <input
            type="search"
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-surface-line bg-surface py-2 pl-9 pr-3 text-sm focus:border-charcoal focus:outline-none"
          />
        </div>
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="rounded-md border border-surface-line bg-surface px-3 py-2 text-sm"
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="rounded-md border border-surface-line bg-surface px-3 py-2 text-sm"
        >
          <option value="">All kinds</option>
          {Object.entries(KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <p className="mb-3 text-xs uppercase tracking-wide text-charcoal/50">
        {filtered.length} of {people.length} people
      </p>

      {people.length === 0 ? (
        <div className="rounded-xl border border-surface-line bg-surface p-10 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-charcoal/30" />
          <h3 className="mb-1 text-sm font-medium">No people yet</h3>
          <p className="mx-auto mb-4 max-w-sm text-sm text-charcoal/60">
            The directory fills from a leadership population sync.
            {isAdmin
              ? ' Run the Push roster sync to bring in the current leadership population.'
              : ' An administrator runs the sync from Data Sources.'}
          </p>
          {isAdmin && (
            <p className="text-sm font-medium text-cg-orange">
              Data Sources → Push roster → choose file
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-surface-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Kind</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const primary = currentPrimary(p)
                return (
                  <tr key={p.id} className="border-b border-surface-line/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{p.full_name}</td>
                    <td className="px-4 py-2.5">{primary?.positions?.name ?? '—'}</td>
                    <td className="px-4 py-2.5">{primary?.locations?.name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">
                        {KIND_LABELS[p.person_kind]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 capitalize">{p.status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

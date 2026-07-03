import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  Users,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PersonPanel } from '../people/PersonPanel'
import type { UserProfile } from '../../types'

interface DirectoryPerson {
  id: string
  full_name: string
  preferred_name: string | null
  status: 'active' | 'leave' | 'departed'
  person_kind: 'manager' | 'emerging_leader' | 'key_team_member'
  data_quality_status: 'ok' | 'needs_review'
  data_quality_note: string | null
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

type SortKey = 'name' | 'position' | 'location' | 'kind' | 'status'

function sortValue(person: DirectoryPerson, key: SortKey): string {
  const primary = currentPrimary(person)
  switch (key) {
    case 'name':
      return person.full_name
    case 'position':
      return primary?.positions?.name ?? ''
    case 'location':
      return primary?.locations?.name ?? ''
    case 'kind':
      return KIND_LABELS[person.person_kind]
    case 'status':
      return person.status
  }
}

interface DirectoryViewProps {
  session: Session
  profile: UserProfile | null
  isAdmin?: boolean
}

export function DirectoryView({ session, profile, isAdmin }: DirectoryViewProps) {
  const [people, setPeople] = useState<DirectoryPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [positionFilter, setPositionFilter] = useState<string[]>([])
  const [locationFilter, setLocationFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = useCallback(() => {
    supabase
      .from('people_center_people')
      .select(
        `id, full_name, preferred_name, status, person_kind,
         data_quality_status, data_quality_note,
         position_assignments:people_center_position_assignments ( is_primary, ended_on,
           positions:people_center_positions ( name ),
           locations:people_center_locations ( name ) )`,
      )
      .neq('status', 'departed')
      .order('full_name')
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setPeople((data as unknown as DirectoryPerson[]) ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const locations = useMemo(() => {
    const names = new Set<string>()
    for (const p of people) {
      const loc = currentPrimary(p)?.locations?.name
      if (loc) names.add(loc)
    }
    return [...names].sort()
  }, [people])

  const positions = useMemo(() => {
    const names = new Set<string>()
    for (const p of people) {
      const pos = currentPrimary(p)?.positions?.name
      if (pos) names.add(pos)
    }
    return [...names].sort()
  }, [people])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people.filter((p) => {
      const primary = currentPrimary(p)
      if (q && !p.full_name.toLowerCase().includes(q)) return false
      if (
        positionFilter.length > 0 &&
        !positionFilter.includes(primary?.positions?.name ?? '')
      )
        return false
      if (locationFilter && primary?.locations?.name !== locationFilter) return false
      if (kindFilter && p.person_kind !== kindFilter) return false
      return true
    })
  }, [people, query, positionFilter, locationFilter, kindFilter])

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      // Blanks (no position/location) always sink to the bottom.
      if (av === '' && bv !== '') return 1
      if (bv === '' && av !== '') return -1
      const cmp = av.localeCompare(bv)
      if (cmp !== 0) return cmp * dir
      return a.full_name.localeCompare(b.full_name)
    })
  }, [filtered, sortKey, sortDir])

  const needsReviewCount = useMemo(
    () => people.filter((p) => p.data_quality_status === 'needs_review').length,
    [people],
  )

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

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
        <PositionMultiSelect
          options={positions}
          selected={positionFilter}
          onChange={setPositionFilter}
        />
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
        {needsReviewCount > 0 && (
          <span className="ml-2 text-warning">
            · {needsReviewCount} need{needsReviewCount === 1 ? 's' : ''} review
          </span>
        )}
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
                <SortableHeader label="Name" sortAs="name" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Position" sortAs="position" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Location" sortAs="location" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Kind" sortAs="kind" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Status" sortAs="status" current={sortKey} dir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const primary = currentPrimary(p)
                return (
                  <tr
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className="cursor-pointer border-b border-surface-line/60 last:border-0 hover:bg-surface-muted/60"
                  >
                    <td className="px-4 py-2.5 font-medium">
                      <span className="flex items-center gap-2">
                        {p.full_name}
                        {p.data_quality_status === 'needs_review' && (
                          <span
                            title={p.data_quality_note ?? 'Imported with review flags'}
                            className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
                          >
                            <AlertTriangle className="h-3 w-3" /> Needs review
                          </span>
                        )}
                      </span>
                    </td>
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

      {selectedId && (
        <PersonPanel
          personId={selectedId}
          session={session}
          profile={profile}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}

function SortableHeader({
  label,
  sortAs,
  current,
  dir,
  onSort,
}: {
  label: string
  sortAs: SortKey
  current: SortKey
  dir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}) {
  const active = current === sortAs
  return (
    <th className="px-4 py-3 font-medium">
      <button
        onClick={() => onSort(sortAs)}
        className={`flex items-center gap-1 uppercase tracking-wide hover:text-charcoal ${
          active ? 'text-charcoal' : ''
        }`}
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  )
}

/** Multi-pick position filter. Empty selection means "everyone" so all
 * managers stay visible by default; picking positions narrows the list. */
function PositionMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)

  function toggle(name: string) {
    onChange(
      selected.includes(name)
        ? selected.filter((s) => s !== name)
        : [...selected, name],
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-surface-line bg-surface px-3 py-2 text-sm sm:w-auto"
      >
        {selected.length === 0
          ? 'All positions'
          : `${selected.length} position${selected.length === 1 ? '' : 's'}`}
        <ChevronDown className="h-4 w-4 text-charcoal/50" />
      </button>
      {open && (
        <>
          <button
            aria-label="Close position filter"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-surface-line bg-surface p-1.5 shadow-lg">
            <button
              onClick={() => onChange([])}
              className="mb-1 w-full rounded px-2 py-1.5 text-left text-sm font-medium hover:bg-surface-muted"
            >
              All positions (clear)
            </button>
            {options.map((name) => (
              <label
                key={name}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(name)}
                  onChange={() => toggle(name)}
                />
                {name}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

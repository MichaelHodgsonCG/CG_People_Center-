import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  UserPlus,
  Users,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { actorFrom } from '../../lib/activity'
import { can, toPermissionUser } from '../../permissions'
import { PersonPanel } from '../people/PersonPanel'
import {
  addIncomingHire,
  fetchReferenceOptions,
  type ReferenceOption,
} from '../people/api'
import type { UserProfile } from '../../types'

interface DirectoryPerson {
  id: string
  full_name: string
  preferred_name: string | null
  status: 'active' | 'leave' | 'departed' | 'incoming'
  person_kind: 'manager' | 'emerging_leader' | 'key_team_member'
  hire_date: string | null
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

// Prefer a real open assignment over the sync pipeline's 'Needs Position
// Review' placeholder when a fixed review import still carries both.
const PLACEHOLDER_POSITION = 'Needs Position Review'

function currentPrimary(person: DirectoryPerson) {
  const open = person.position_assignments.filter((a) => !a.ended_on)
  const real = open.filter((a) => a.positions?.name !== PLACEHOLDER_POSITION)
  return (
    real.find((a) => a.is_primary) ??
    real[0] ??
    open.find((a) => a.is_primary) ??
    open[0] ??
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
  const user = profile ? toPermissionUser(profile) : null
  const actor = actorFrom(profile, session)
  const canAddHire = isAdmin || can(user, 'create', 'person')
  const [addingHire, setAddingHire] = useState(false)
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
        `id, full_name, preferred_name, status, person_kind, hire_date,
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

      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-charcoal/50">
          {filtered.length} of {people.length} people
          {needsReviewCount > 0 && (
            <span className="ml-2 text-warning">
              · {needsReviewCount} need{needsReviewCount === 1 ? 's' : ''} review
            </span>
          )}
        </p>
        {canAddHire && (
          <button
            onClick={() => setAddingHire((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
          >
            <UserPlus className="h-3.5 w-3.5" /> Add incoming hire
          </button>
        )}
      </div>

      {addingHire && (
        <IncomingHireForm
          people={people}
          onDone={() => {
            setAddingHire(false)
            load()
          }}
          onCancel={() => setAddingHire(false)}
          actor={actor}
        />
      )}

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
                    <td className="px-4 py-2.5">
                      {p.status === 'incoming' ? (
                        <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
                          Incoming{p.hire_date ? ` · starts ${p.hire_date}` : ''}
                        </span>
                      ) : (
                        <span className="capitalize">{p.status}</span>
                      )}
                    </td>
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

// Add a signed-but-not-started hire (migration 20260707090000): appears in
// the roster immediately as "Incoming · starts <date>", becomes active when
// the Push roster sync matches them (or an admin flips their status).
function IncomingHireForm({
  people,
  actor,
  onDone,
  onCancel,
}: {
  people: DirectoryPerson[]
  actor: ReturnType<typeof actorFrom>
  onDone: () => void
  onCancel: () => void
}) {
  const [options, setOptions] = useState<{
    positions: ReferenceOption[]
    locations: ReferenceOption[]
  } | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [positionId, setPositionId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [personKind, setPersonKind] = useState<DirectoryPerson['person_kind']>('manager')
  const [managerId, setManagerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchReferenceOptions().then(setOptions).catch((e: Error) => setError(e.message))
  }, [])

  const duplicate = useMemo(() => {
    const key = fullName.trim().toLowerCase()
    return key.length > 0 && people.some((p) => p.full_name.trim().toLowerCase() === key)
  }, [fullName, people])

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
          await addIncomingHire(actor, {
            fullName: fullName.trim(),
            email: email.trim() || null,
            positionId,
            positionName: options?.positions.find((p) => p.id === positionId)?.name ?? '?',
            locationId,
            locationName: options?.locations.find((l) => l.id === locationId)?.name ?? '?',
            startDate,
            personKind,
            managerPersonId: managerId || null,
          })
          onDone()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
          setSaving(false)
        }
      }}
      className="mb-4 space-y-3 rounded-xl border border-surface-line bg-surface p-4"
    >
      <p className="text-xs text-charcoal/60">
        For people who've signed but aren't in Push yet. They appear in the
        roster as <b>Incoming</b> with their start date; when a later Push
        roster sync finds the same name, this record is activated instead of
        duplicated.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-charcoal/50">
            Full name *
          </span>
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-md border border-surface-line px-2 py-1.5 text-sm"
          />
          {duplicate && (
            <span className="mt-1 block text-xs text-warning">
              Someone with this exact name is already in the directory.
            </span>
          )}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-charcoal/50">
            Start date *
          </span>
          <input
            required
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-surface-line px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-charcoal/50">
            Position *
          </span>
          <select
            required
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">— position —</option>
            {options?.positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-charcoal/50">
            Location *
          </span>
          <select
            required
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">— location —</option>
            {options?.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-charcoal/50">
            Kind
          </span>
          <select
            value={personKind}
            onChange={(e) => setPersonKind(e.target.value as DirectoryPerson['person_kind'])}
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            {Object.entries(KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-charcoal/50">
            Reports to (optional)
          </span>
          <select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">— reporting line —</option>
            {people
              .filter((p) => p.status !== 'incoming')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-charcoal/50">
            Email (optional)
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-surface-line px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Add incoming hire'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
        >
          Cancel
        </button>
      </div>
    </form>
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

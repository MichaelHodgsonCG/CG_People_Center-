// Bench & Risk — the executive altitude (PRODUCT_BRIEF.md §3.13), computed
// live so it can never go stale. V1 signals run on data that exists today:
// succession coverage, key-seat depth, location leadership coverage, and
// development-conversation staleness from notes. The readiness distribution
// column lights up when Phase 3 ships readiness assessments.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertTriangle, Plus, Trash2, Users } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { fetchReferenceOptions, type ReferenceOption } from '../people/api'
import type { UserProfile } from '../../types'
import {
  addCandidate,
  createSlot,
  deleteSlot,
  fetchConversationStaleness,
  fetchLocationCoverage,
  fetchPeopleOptions,
  fetchPeopleStats,
  fetchSlots,
  removeCandidate,
  type ConversationStaleness,
  type LocationCoverage,
  type PeopleStats,
  type PersonOption,
  type SuccessionSlot,
} from './api'

function slotLabel(s: SuccessionSlot): string {
  return `${s.positions?.name ?? '?'} — ${s.locations?.name ?? s.regions?.name ?? '?'}`
}

function coverage(s: SuccessionSlot): { label: string; cls: string } {
  const n = s.candidates.length
  if (n === 0) return { label: 'No successors', cls: 'bg-danger/10 text-danger' }
  if (n === 1) return { label: '1 deep', cls: 'bg-warning/10 text-warning' }
  return { label: `${n} deep`, cls: 'bg-success/10 text-success' }
}

interface BenchViewProps {
  session: Session
  profile: UserProfile | null
}

export function BenchView({ session, profile }: BenchViewProps) {
  const actor = actorFrom(profile, session)
  const [slots, setSlots] = useState<SuccessionSlot[]>([])
  const [locations, setLocations] = useState<LocationCoverage[]>([])
  const [staleness, setStaleness] = useState<ConversationStaleness | null>(null)
  const [stats, setStats] = useState<PeopleStats | null>(null)
  const [people, setPeople] = useState<PersonOption[]>([])
  const [options, setOptions] = useState<{ positions: ReferenceOption[]; locations: ReferenceOption[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    Promise.all([
      fetchSlots(),
      fetchLocationCoverage(),
      fetchConversationStaleness(),
      fetchPeopleStats(),
      fetchPeopleOptions(),
      fetchReferenceOptions(),
    ])
      .then(([s, lc, cs, ps, po, refs]) => {
        setSlots(s)
        setLocations(lc)
        setStaleness(cs)
        setStats(ps)
        setPeople(po)
        setOptions(refs)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const riskLocations = useMemo(
    () => locations.filter((l) => !l.hasGm || !l.hasChefDeCuisine),
    [locations],
  )

  // Successors lined up per location, across all of its seats (GM seat
  // first, then by rank), deduplicated for display beside the location.
  const successorsByLocation = useMemo(() => {
    const map = new Map<string, string[]>()
    const ordered = [...slots].sort((a, b) =>
      (a.positions?.name === 'General Manager' ? 0 : 1) -
      (b.positions?.name === 'General Manager' ? 0 : 1),
    )
    for (const slot of ordered) {
      if (!slot.location_id) continue
      const names = map.get(slot.location_id) ?? []
      for (const c of slot.candidates) {
        const n = c.people?.full_name
        if (n && !names.includes(n)) names.push(n)
      }
      map.set(slot.location_id, names)
    }
    return map
  }, [slots])
  const thinSlots = useMemo(() => slots.filter((s) => s.candidates.length < 2), [slots])

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading bench…</p>
  if (error) return <p className="p-6 text-sm text-danger">Could not load bench: {error}</p>

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Leadership population" value={stats?.active ?? 0} />
        <Kpi
          label="Succession seats < 2 deep"
          value={thinSlots.length}
          tone={thinSlots.length > 0 ? 'warn' : 'ok'}
          hint={`${slots.length} seat(s) planned`}
        />
        <Kpi
          label="Locations missing GM or Chef de Cuisine"
          value={riskLocations.length}
          tone={riskLocations.length > 0 ? 'danger' : 'ok'}
        />
        <Kpi
          label="Stale development conversations"
          value={(staleness?.never ?? 0) + (staleness?.stale90 ?? 0)}
          tone="warn"
          hint={`${staleness?.never ?? 0} never · ${staleness?.stale90 ?? 0} >90 days`}
        />
      </div>

      <p className="text-xs text-charcoal/40">
        Readiness distribution joins this dashboard when readiness assessments
        ship (Phase 3). Everything shown is computed live — nothing is stored.
      </p>

      {/* Succession */}
      <section className="rounded-xl border border-surface-line bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold">Succession planning</h2>
        <p className="mb-4 text-xs text-charcoal/50">
          One seat per key position per location or region. Coverage is
          computed from ranked successors. Visible to executives and admins
          only.
        </p>
        <NewSlotForm
          options={options}
          people={people}
          onCreate={async (positionId, locationId, incumbentId, label) => {
            await createSlot(actor, positionId, locationId, null, incumbentId, label)
            load()
          }}
        />
        {slots.length === 0 ? (
          <p className="mt-3 text-sm text-charcoal/50">
            No seats planned yet — start with the 16 General Manager seats.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {slots.map((s) => (
              <SlotCard
                key={s.id}
                slot={s}
                people={people}
                onAddCandidate={async (personId, rank) => {
                  await addCandidate(actor, s.id, personId, rank, slotLabel(s))
                  load()
                }}
                onRemoveCandidate={async (candidateId) => {
                  await removeCandidate(actor, candidateId, slotLabel(s))
                  load()
                }}
                onDelete={async () => {
                  if (window.confirm(`Delete seat "${slotLabel(s)}"?`)) {
                    await deleteSlot(actor, s.id, slotLabel(s))
                    load()
                  }
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Location coverage */}
      <section className="rounded-xl border border-surface-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">Location leadership coverage</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">GM</th>
                <th className="px-3 py-2 font-medium">Chef de Cuisine</th>
                <th className="px-3 py-2 font-medium">Leaders</th>
                <th className="px-3 py-2 font-medium">Successors lined up</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.locationId} className="border-b border-surface-line/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{l.locationName}</td>
                  <td className="px-3 py-2">{l.hasGm ? '✓' : <Missing />}</td>
                  <td className="px-3 py-2">{l.hasChefDeCuisine ? '✓' : <Missing />}</td>
                  <td className="px-3 py-2">{l.leaders}</td>
                  <td className="px-3 py-2 text-charcoal/70">
                    {(successorsByLocation.get(l.locationId) ?? []).join(', ') || (
                      <span className="text-charcoal/35">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Missing() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
      <AlertTriangle className="h-3 w-3" /> missing
    </span>
  )
}

function Kpi({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: number
  tone?: 'ok' | 'warn' | 'danger'
  hint?: string
}) {
  const toneCls =
    tone === 'danger' && value > 0
      ? 'text-danger'
      : tone === 'warn' && value > 0
        ? 'text-warning'
        : 'text-charcoal'
  return (
    <div className="rounded-xl border border-surface-line bg-surface p-3">
      <p className={`text-2xl font-semibold ${toneCls}`}>{value}</p>
      <p className="text-xs text-charcoal/60">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-charcoal/40">{hint}</p>}
    </div>
  )
}

function NewSlotForm({
  options,
  people,
  onCreate,
}: {
  options: { positions: ReferenceOption[]; locations: ReferenceOption[] } | null
  people: PersonOption[]
  onCreate: (positionId: string, locationId: string, incumbentId: string | null, label: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [positionId, setPositionId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [incumbentId, setIncumbentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover"
      >
        <Plus className="h-4 w-4" /> Plan a seat
      </button>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const label = `${options?.positions.find((p) => p.id === positionId)?.name ?? '?'} — ${
        options?.locations.find((l) => l.id === locationId)?.name ?? '?'
      }`
      await onCreate(positionId, locationId, incumbentId || null, label)
      setOpen(false)
      setPositionId('')
      setLocationId('')
      setIncumbentId('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-md border border-surface-line p-3">
      <select required value={positionId} onChange={(e) => setPositionId(e.target.value)}
        className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm">
        <option value="">— position —</option>
        {options?.positions.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <select required value={locationId} onChange={(e) => setLocationId(e.target.value)}
        className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm">
        <option value="">— location —</option>
        {options?.locations.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <select value={incumbentId} onChange={(e) => setIncumbentId(e.target.value)}
        className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm">
        <option value="">— incumbent (optional) —</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>{p.full_name}</option>
        ))}
      </select>
      <button type="submit" disabled={saving}
        className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50">
        {saving ? 'Saving…' : 'Create seat'}
      </button>
      <button type="button" onClick={() => setOpen(false)}
        className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted">
        Cancel
      </button>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </form>
  )
}

function SlotCard({
  slot,
  people,
  onAddCandidate,
  onRemoveCandidate,
  onDelete,
}: {
  slot: SuccessionSlot
  people: PersonOption[]
  onAddCandidate: (personId: string, rank: number) => Promise<void>
  onRemoveCandidate: (candidateId: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [candidateId, setCandidateId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cov = coverage(slot)
  const nextRank = (slot.candidates[slot.candidates.length - 1]?.rank ?? 0) + 1

  return (
    <li className="rounded-md border border-surface-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{slotLabel(slot)}</p>
          <p className="text-xs text-charcoal/50">
            Incumbent: {slot.incumbent?.full_name ?? 'vacant'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cov.cls}`}>{cov.label}</span>
          <button onClick={() => void onDelete()} aria-label="Delete seat"
            className="rounded p-1 text-charcoal/40 hover:text-danger">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {slot.candidates.length > 0 && (
        <ol className="mt-2 space-y-1">
          {slot.candidates.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-xs text-charcoal/40">#{c.rank}</span>
              <Users className="h-3.5 w-3.5 text-charcoal/40" />
              {c.people?.full_name ?? c.person_id}
              <button
                onClick={() => onRemoveCandidate(c.id).catch((e: Error) => setError(e.message))}
                aria-label="Remove candidate"
                className="rounded p-0.5 text-charcoal/30 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-2 flex items-center gap-2">
        <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)}
          className="rounded-md border border-surface-line bg-surface px-2 py-1 text-xs">
          <option value="">— add successor —</option>
          {people
            .filter((p) => !slot.candidates.some((c) => c.person_id === p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
        </select>
        <button
          disabled={!candidateId}
          onClick={() =>
            onAddCandidate(candidateId, nextRank)
              .then(() => setCandidateId(''))
              .catch((e: Error) => setError(e.message))
          }
          className="rounded-md border border-surface-line px-2 py-1 text-xs hover:bg-surface-muted disabled:opacity-40"
        >
          Add at #{nextRank}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </li>
  )
}

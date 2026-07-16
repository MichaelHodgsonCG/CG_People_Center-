// Upcoming locations (Phase 2). Slice 1: a read-only projection of the New
// Restaurant Center's `opening_sites` (planned restaurants + their handover /
// soft-opening / opening dates + a staffing-deadline countdown). Slice 2:
// admins/executives slate who will fill each upcoming site's leadership roles
// (people_center_opening_placements) — planned leaders + gaps, shown per site.
// The opening_sites read is open to any authenticated user; the planning
// section is admin/executive-only (RLS + the canPlan gate below).

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { CalendarClock, ExternalLink, Plus, Store, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { actorFrom } from '../../lib/activity'
import {
  fetchManagerCandidates,
  fetchReferenceOptions,
  type ManagerCandidate,
  type ReferenceOption,
} from '../people/api'
import {
  addOpeningPlacement,
  fetchOpeningPlacements,
  removeOpeningPlacement,
  type OpeningPlacement,
} from './api'
import type { UserProfile } from '../../types'

interface OpeningSite {
  id: string
  name: string
  concept: string | null
  address: string | null
  opening_date: string | null
  handover_date: string | null
  soft_opening_date: string | null
  status: string | null
  handover_status: string | null
  construction_note: string | null
  construction_link: string | null
  notes: string | null
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${dateStr}T00:00:00`)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function countdown(days: number | null): { text: string; tone: 'danger' | 'warning' | 'info' | 'muted' } {
  if (days === null) return { text: 'not scheduled', tone: 'muted' }
  if (days < 0) return { text: `${Math.abs(days)}d ago`, tone: 'muted' }
  if (days === 0) return { text: 'today', tone: 'danger' }
  const tone = days <= 45 ? 'danger' : days <= 120 ? 'warning' : 'info'
  return { text: `in ${days} day${days === 1 ? '' : 's'}`, tone }
}

const TONE_CLASS: Record<'danger' | 'warning' | 'info' | 'muted', string> = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  muted: 'bg-surface-muted text-charcoal/50',
}

interface UpcomingViewProps {
  session: Session
  profile: UserProfile | null
}

export function UpcomingView({ session, profile }: UpcomingViewProps) {
  const actor = actorFrom(profile, session)
  // Planning section (slice 2) is admin/executive only, matching the RLS on
  // people_center_opening_placements.
  const canPlan = profile?.role === 'admin' || profile?.role === 'executive'

  const [sites, setSites] = useState<OpeningSite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Slice-2 planning state.
  const [placements, setPlacements] = useState<OpeningPlacement[]>([])
  const [positions, setPositions] = useState<ReferenceOption[]>([])
  const [people, setPeople] = useState<ManagerCandidate[]>([])
  const [addingSiteId, setAddingSiteId] = useState<string | null>(null)
  const [newPos, setNewPos] = useState('')
  const [newPerson, setNewPerson] = useState('')
  const [busy, setBusy] = useState(false)
  const [planErr, setPlanErr] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('opening_sites')
      .select(
        `id, name, concept, address, opening_date, handover_date, soft_opening_date,
         status, handover_status, construction_note, construction_link, notes`,
      )
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setSites((data as unknown as OpeningSite[]) ?? [])
        setLoading(false)
      })
  }, [])

  const loadPlacements = useCallback(() => {
    fetchOpeningPlacements().then(setPlacements).catch((e: Error) => setPlanErr(e.message))
  }, [])

  useEffect(() => {
    if (!canPlan) return
    loadPlacements()
    fetchReferenceOptions()
      .then((o) => setPositions(o.positions))
      .catch((e: Error) => setPlanErr(e.message))
    fetchManagerCandidates()
      .then(setPeople)
      .catch((e: Error) => setPlanErr(e.message))
  }, [canPlan, loadPlacements])

  const sorted = useMemo(() => {
    const key = (s: OpeningSite) => s.handover_date ?? s.opening_date ?? null
    return [...sites].sort((a, b) => {
      const ak = key(a)
      const bk = key(b)
      if (ak && bk) return ak.localeCompare(bk)
      if (ak) return -1
      if (bk) return 1
      return a.name.localeCompare(b.name)
    })
  }, [sites])

  // Placements grouped by site, each list ordered by role seniority (level).
  const placementsBySite = useMemo(() => {
    const map = new Map<string, OpeningPlacement[]>()
    for (const p of placements) {
      const arr = map.get(p.opening_site_id) ?? []
      arr.push(p)
      map.set(p.opening_site_id, arr)
    }
    for (const arr of map.values()) {
      arr.sort(
        (a, b) =>
          (a.position?.level ?? Infinity) - (b.position?.level ?? Infinity) ||
          (a.position?.name ?? '').localeCompare(b.position?.name ?? ''),
      )
    }
    return map
  }, [placements])

  const startAdd = useCallback((siteId: string) => {
    setAddingSiteId(siteId)
    setNewPos('')
    setNewPerson('')
    setPlanErr(null)
  }, [])

  async function saveAdd(site: OpeningSite) {
    if (!newPos) return
    setBusy(true)
    setPlanErr(null)
    try {
      await addOpeningPlacement(
        actor,
        site.id,
        site.name,
        newPos,
        positions.find((p) => p.id === newPos)?.name ?? 'role',
        newPerson || null,
        newPerson ? people.find((m) => m.id === newPerson)?.full_name ?? null : null,
      )
      setAddingSiteId(null)
      loadPlacements()
    } catch (e) {
      setPlanErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(pl: OpeningPlacement) {
    const label = `${pl.position?.name ?? 'Role'} — ${pl.person?.full_name ?? 'TBD'}`
    setPlanErr(null)
    try {
      await removeOpeningPlacement(actor, pl.id, label)
      loadPlacements()
    } catch (e) {
      setPlanErr(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading upcoming locations…</p>
  if (error)
    return <p className="p-6 text-sm text-danger">Could not load upcoming locations: {error}</p>

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Store className="h-5 w-5 text-cg-orange" /> Upcoming locations
        </h2>
        <p className="mt-1 text-sm text-charcoal/60">
          Planned restaurants and their opening timeline, from the New Restaurant
          Center. The <span className="font-medium">handover date</span> is the
          staffing deadline — leadership and team should be in place by then.
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-surface-line bg-surface p-10 text-center">
          <CalendarClock className="mx-auto mb-3 h-8 w-8 text-charcoal/30" />
          <h3 className="mb-1 text-sm font-medium">No upcoming locations</h3>
          <p className="mx-auto max-w-sm text-sm text-charcoal/60">
            The New Restaurant Center has no planned sites yet. New sites added
            there appear here automatically.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sorted.map((s) => {
            const handover = countdown(daysUntil(s.handover_date))
            const sitePlacements = placementsBySite.get(s.id) ?? []
            return (
              <li
                key={s.id}
                className="flex flex-col rounded-xl border border-surface-line bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.name}</p>
                    {s.concept && <p className="text-xs text-charcoal/50">{s.concept}</p>}
                  </div>
                  {s.status && (
                    <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] capitalize text-charcoal/60">
                      {s.status.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[handover.tone]}`}
                  >
                    Staffing deadline {handover.text}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <DateCell label="Handover" value={fmtDate(s.handover_date)} />
                  <DateCell label="Soft open" value={fmtDate(s.soft_opening_date)} />
                  <DateCell label="Opening" value={fmtDate(s.opening_date)} />
                </dl>

                {(s.construction_note || s.notes) && (
                  <p className="mt-3 text-xs text-charcoal/60">{s.construction_note ?? s.notes}</p>
                )}
                {s.construction_link && (
                  <a
                    href={s.construction_link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-cg-orange hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Construction tracker
                  </a>
                )}

                {/* Slice 2: planned leadership (admin/executive only) */}
                {canPlan && (
                  <div className="mt-3 border-t border-surface-line pt-3">
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-charcoal/45">
                      Planned leadership
                    </p>
                    <ul className="space-y-1">
                      {sitePlacements.length === 0 && (
                        <li className="text-xs text-charcoal/40">No one slated yet.</li>
                      )}
                      {sitePlacements.map((pl) => (
                        <li
                          key={pl.id}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="min-w-0 truncate">
                            <span className="text-charcoal/60">
                              {pl.position?.name ?? 'Role'}
                            </span>
                            {' — '}
                            {pl.person ? (
                              <span className="font-medium">{pl.person.full_name}</span>
                            ) : (
                              <span className="italic text-warning">TBD (gap)</span>
                            )}
                          </span>
                          <button
                            onClick={() => void remove(pl)}
                            aria-label="Remove slated leader"
                            className="shrink-0 rounded p-0.5 text-charcoal/30 hover:text-danger"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>

                    {addingSiteId === s.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <select
                          value={newPos}
                          onChange={(e) => setNewPos(e.target.value)}
                          className="rounded-md border border-surface-line bg-surface px-2 py-1 text-xs"
                        >
                          <option value="">— role —</option>
                          {positions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={newPerson}
                          onChange={(e) => setNewPerson(e.target.value)}
                          className="rounded-md border border-surface-line bg-surface px-2 py-1 text-xs"
                        >
                          <option value="">— TBD (gap) —</option>
                          {people.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.full_name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => void saveAdd(s)}
                          disabled={busy || !newPos}
                          className="rounded-md bg-cg-orange px-2 py-1 text-xs font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
                        >
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setAddingSiteId(null)}
                          className="rounded-md border border-surface-line px-2 py-1 text-xs hover:bg-surface-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startAdd(s.id)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-cg-orange hover:underline"
                      >
                        <Plus className="h-3 w-3" /> Add slated leader
                      </button>
                    )}
                    {planErr && addingSiteId === s.id && (
                      <p className="mt-1 text-xs text-danger">{planErr}</p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function DateCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-muted/50 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-charcoal/45">{label}</dt>
      <dd className="text-xs font-medium">{value}</dd>
    </div>
  )
}

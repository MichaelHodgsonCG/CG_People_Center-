// Gap analysis (Phase 3, v1). Pick a location → required "ideal restaurant"
// roster vs. who's actually there (open sites) or slated (opening sites), with
// the shortfall per role. Admin/executive can edit the required counts inline.
// (.docx export is a follow-up slice.)

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ClipboardList, Download, Settings2 } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { downloadGapDocx } from './docx'
import {
  fetchFillForLocation,
  fetchGapLocations,
  fetchManagementPositions,
  fetchRoleRequirements,
  setRoleRequirement,
  type Fill,
  type GapLocation,
  type MgmtPosition,
  type RoleRequirement,
} from './api'
import type { UserProfile } from '../../types'

interface GapViewProps {
  session: Session
  profile: UserProfile | null
}

export function GapView({ session, profile }: GapViewProps) {
  const actor = actorFrom(profile, session)
  const canEdit = profile?.role === 'admin' || profile?.role === 'executive'

  const [reqs, setReqs] = useState<RoleRequirement[]>([])
  const [mgmt, setMgmt] = useState<MgmtPosition[]>([])
  const [locations, setLocations] = useState<GapLocation[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [fill, setFill] = useState<Map<string, Fill>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [exporting, setExporting] = useState(false)

  const loadReqs = useCallback(() => {
    fetchRoleRequirements().then(setReqs).catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    Promise.all([fetchRoleRequirements(), fetchManagementPositions(), fetchGapLocations()])
      .then(([r, m, locs]) => {
        setReqs(r)
        setMgmt(m)
        setLocations(locs)
        // Default to the first upcoming site (new-restaurant readiness focus).
        const firstOpening = locs.find((l) => l.status === 'opening')
        setSelectedId(firstOpening?.id ?? locs[0]?.id ?? '')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const selected = locations.find((l) => l.id === selectedId)
  const upcoming = selected?.status === 'opening'

  useEffect(() => {
    if (!selectedId || !selected) return
    fetchFillForLocation(selectedId, selected.status === 'opening')
      .then(setFill)
      .catch((e: Error) => setError(e.message))
  }, [selectedId, selected])

  // One report row per required role (required_count > 0), ordered by seniority.
  const rows = useMemo(() => {
    return reqs
      .filter((r) => r.required_count > 0)
      .map((r) => {
        const f = fill.get(r.position_id) ?? { count: 0, names: [] }
        return {
          ...r,
          current: f.count,
          names: f.names,
          gap: Math.max(0, r.required_count - f.count),
        }
      })
  }, [reqs, fill])

  const totals = useMemo(() => {
    const required = rows.reduce((s, r) => s + r.required_count, 0)
    const filled = rows.reduce((s, r) => s + Math.min(r.current, r.required_count), 0)
    const gap = rows.reduce((s, r) => s + r.gap, 0)
    return { required, filled, gap }
  }, [rows])

  async function exportDocx() {
    if (!selected || rows.length === 0) return
    setExporting(true)
    setError(null)
    try {
      await downloadGapDocx({
        locationName: selected.name,
        upcoming,
        rows: rows.map((r) => ({
          position_name: r.position_name,
          required_count: r.required_count,
          current: r.current,
          gap: r.gap,
          names: r.names,
        })),
        totals,
        generatedOn: new Date().toLocaleDateString(),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading gap analysis…</p>
  if (error) return <p className="p-6 text-sm text-danger">Could not load gap analysis: {error}</p>

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardList className="h-5 w-5 text-cg-orange" /> Gap analysis
          </h2>
          <p className="mt-1 text-sm text-charcoal/60">
            Required management roster vs. {upcoming ? 'who is slated' : 'who is in seat'} —
            the shortfall per role.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowConfig((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
          >
            <Settings2 className="h-3.5 w-3.5" /> Required roster
          </button>
        )}
      </div>

      {showConfig && canEdit && (
        <RequirementsEditor
          mgmt={mgmt}
          reqs={reqs}
          actor={actor}
          onSaved={() => {
            loadReqs()
            setShowConfig(false)
          }}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs uppercase tracking-wide text-charcoal/50">Location</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-md border border-surface-line bg-surface px-3 py-2 text-sm"
        >
          <optgroup label="Upcoming">
            {locations
              .filter((l) => l.status === 'opening')
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Open">
            {locations
              .filter((l) => l.status === 'open')
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </optgroup>
        </select>
        {upcoming && (
          <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
            upcoming — showing slated
          </span>
        )}
        <button
          onClick={() => void exportDocx()}
          disabled={exporting || rows.length === 0}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> {exporting ? 'Preparing…' : 'Download .docx'}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 text-center font-medium">Required</th>
              <th className="px-4 py-3 text-center font-medium">
                {upcoming ? 'Slated' : 'In seat'}
              </th>
              <th className="px-4 py-3 text-center font-medium">Gap</th>
              <th className="px-4 py-3 font-medium">{upcoming ? 'Slated' : 'People'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.position_id} className="border-b border-surface-line/60 last:border-0">
                <td className="px-4 py-2.5 font-medium">{r.position_name}</td>
                <td className="px-4 py-2.5 text-center">{r.required_count}</td>
                <td className="px-4 py-2.5 text-center">{r.current}</td>
                <td className="px-4 py-2.5 text-center">
                  {r.gap > 0 ? (
                    <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                      short {r.gap}
                    </span>
                  ) : (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                      OK
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-charcoal/60">
                  {r.names.join(', ') || (upcoming ? 'not yet named' : '—')}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-surface-line bg-surface-muted/40 text-sm font-medium">
              <td className="px-4 py-2.5">Total</td>
              <td className="px-4 py-2.5 text-center">{totals.required}</td>
              <td className="px-4 py-2.5 text-center">{totals.filled}</td>
              <td className="px-4 py-2.5 text-center">
                {totals.gap > 0 ? (
                  <span className="text-danger">short {totals.gap}</span>
                ) : (
                  <span className="text-success">fully staffed</span>
                )}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function RequirementsEditor({
  mgmt,
  reqs,
  actor,
  onSaved,
}: {
  mgmt: MgmtPosition[]
  reqs: RoleRequirement[]
  actor: ReturnType<typeof actorFrom>
  onSaved: () => void
}) {
  const reqByPos = useMemo(
    () => new Map(reqs.map((r) => [r.position_id, r.required_count])),
    [reqs],
  )
  const [edits, setEdits] = useState<Map<string, number>>(new Map())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const value = (id: string) => edits.get(id) ?? reqByPos.get(id) ?? 0

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      for (const [posId, count] of edits) {
        if (count === (reqByPos.get(posId) ?? 0)) continue
        const name = mgmt.find((m) => m.id === posId)?.name ?? 'role'
        await setRoleRequirement(actor, posId, name, count)
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-cg-orange/40 bg-cg-orange-soft/30 p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal/50">
        Required roster (base template — applies to every restaurant)
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {mgmt.map((m) => (
          <label key={m.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-charcoal/70">{m.name}</span>
            <input
              type="number"
              min={0}
              value={value(m.id)}
              onChange={(e) => {
                const n = Math.max(0, parseInt(e.target.value || '0', 10))
                setEdits((prev) => new Map(prev).set(m.id, n))
              }}
              className="w-16 rounded-md border border-surface-line bg-surface px-2 py-1 text-center text-sm"
            />
          </label>
        ))}
      </div>
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      <button
        onClick={() => void save()}
        disabled={saving}
        className="mt-3 rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save roster'}
      </button>
    </div>
  )
}

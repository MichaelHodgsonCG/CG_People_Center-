// Upload a filled-in gap Excel → preview → apply as slated leaders. Resolves
// Location/Role/person by name (existing person links; unknown name is added as
// a new candidate), then sets each location+role succession seat's incumbent.
// Preview first — nothing is written until "Apply".

import { useState } from 'react'
import { UploadCloud, X } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import {
  applyAssignments,
  fetchGapLocations,
  fetchManagementPositions,
  fetchPeopleForMatch,
  fetchSlotIndex,
  type ApplyResult,
} from './api'
import { parseAssignmentXlsx, type ResolvedAssignment } from './importXlsx'

const ACTION_CLASS: Record<ResolvedAssignment['action'], string> = {
  link: 'bg-success/10 text-success',
  create: 'bg-warning/10 text-warning',
  error: 'bg-danger/10 text-danger',
}
const ACTION_LABEL: Record<ResolvedAssignment['action'], string> = {
  link: 'Link existing',
  create: 'New candidate',
  error: 'Skip',
}

export function ImportPanel({
  actor,
  onClose,
  onApplied,
}: {
  actor: ReturnType<typeof actorFrom>
  onClose: () => void
  onApplied: () => void
}) {
  const [rows, setRows] = useState<ResolvedAssignment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)

  const applicable = rows?.filter((r) => r.action !== 'error') ?? []
  const errorCount = rows?.filter((r) => r.action === 'error').length ?? 0

  async function onFile(file: File) {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const [locations, positions, people] = await Promise.all([
        fetchGapLocations(),
        fetchManagementPositions(),
        fetchPeopleForMatch(),
      ])
      const parsed = await parseAssignmentXlsx(file, { locations, positions, people })
      if (parsed.length === 0) {
        setError('No filled-in "Assign to" cells found in the sheet.')
        setRows(null)
      } else {
        setRows(parsed)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRows(null)
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!rows) return
    setBusy(true)
    setError(null)
    try {
      const slotIndex = await fetchSlotIndex()
      const r = await applyAssignments(actor, applicable, slotIndex)
      setResult(r)
      onApplied()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-charcoal/30 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border border-surface-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-surface-line p-4">
          <div>
            <h3 className="font-semibold">Upload filled gap report</h3>
            <p className="text-xs text-charcoal/55">
              Fill the “Assign to” column in the exported Excel, then upload it to
              record slated leaders.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-charcoal/40 hover:text-charcoal">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

          {result ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-success">Applied.</p>
              <ul className="text-charcoal/70">
                <li>{result.slotsSet} seat(s) set</li>
                <li>{result.linked} linked to existing people</li>
                <li>{result.created} new candidate(s) added</li>
              </ul>
              {result.errors.length > 0 && (
                <div className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
                  {result.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}
              <button
                onClick={onClose}
                className="mt-2 rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover"
              >
                Done
              </button>
            </div>
          ) : !rows ? (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-surface-line px-4 py-10 text-center hover:bg-surface-muted/40">
              <UploadCloud className="h-8 w-8 text-charcoal/30" />
              <span className="text-sm font-medium">
                {busy ? 'Reading…' : 'Choose an .xlsx file'}
              </span>
              <span className="text-xs text-charcoal/50">
                Use the company-wide report you downloaded, with the “Assign to”
                column filled in.
              </span>
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onFile(f)
                }}
              />
            </label>
          ) : (
            <>
              <p className="mb-2 text-sm">
                <span className="font-medium">{applicable.length}</span> to apply
                {errorCount > 0 && (
                  <span className="text-charcoal/50"> · {errorCount} skipped</span>
                )}
              </p>
              <div className="max-h-80 overflow-y-auto rounded-md border border-surface-line">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
                      <th className="px-3 py-2 font-medium">Location</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">Person</th>
                      <th className="px-3 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-surface-line/60 last:border-0">
                        <td className="px-3 py-2">{r.locationName}</td>
                        <td className="px-3 py-2">{r.roleName}</td>
                        <td className="px-3 py-2">{r.personName}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTION_CLASS[r.action]}`}>
                            {ACTION_LABEL[r.action]}
                          </span>
                          {r.note && <span className="ml-2 text-[11px] text-charcoal/50">{r.note}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void apply()}
                  disabled={busy || applicable.length === 0}
                  className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
                >
                  {busy ? 'Applying…' : `Apply ${applicable.length}`}
                </button>
                <button
                  onClick={() => setRows(null)}
                  className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
                >
                  Choose another file
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

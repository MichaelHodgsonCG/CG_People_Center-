import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  Upload,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { actorFrom, type Actor } from '../../lib/activity'
import type { UserProfile } from '../../types'
import { readXlsx } from './pipeline/transports/xlsxFile'
import { normalize } from './pipeline/normalize'
import { classify, summarize } from './pipeline/classify'
import { loadMappings } from './pipeline/mappingLoader'
import { commitBatch } from './pipeline/commit'
import {
  confirmLink,
  fetchPendingLinks,
  rejectLink,
  type PendingLink,
} from './pipeline/links'
import {
  fetchPositionsAdmin,
  syncPositionsFromCgops,
  updatePositionConfig,
  type PositionAdminRow,
  type PositionSyncResult,
} from './positions'
import type { ClassifiedRow } from './pipeline/types'
import { DevPathsPanel } from './DevPathsPanel'

const SOURCE = 'push_roster'

// Supabase/PostgREST errors are plain objects, not Error instances — String()
// on them prints "[object Object]" and hides the real reason. Read their
// message/details/hint before falling back.
function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    return o.message || o.details || o.hint || JSON.stringify(o)
  }
  return String(e)
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'preview'; fileName: string; classified: ClassifiedRow[] }
  | { kind: 'committing' }
  | { kind: 'done'; batchId: string; summary: ReturnType<typeof summarize> }
  | { kind: 'error'; message: string }

export function DataSourcesView({
  profile,
  session,
}: {
  profile: UserProfile | null
  session: Session | null
}) {
  const actor = actorFrom(profile, session)
  const [source, setSource] = useState<'roster' | 'dev_paths' | 'positions'>('roster')
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  // Bumped after a commit so the pending-links panel re-checks for new matches.
  const [linksToken, setLinksToken] = useState(0)

  async function handleFile(file: File) {
    setStage({ kind: 'parsing' })
    try {
      // transport → normalize (redacts) → map/eligibility → review routing
      const records = await readXlsx(file)
      const rows = normalize(records)
      const mappings = await loadMappings(supabase, SOURCE)
      if (mappings.positions.size === 0) {
        throw new Error(
          `No position mappings found for source "${SOURCE}" — apply the Phase 1 migrations first.`,
        )
      }
      const classified = classify(rows, mappings)
      setStage({ kind: 'preview', fileName: file.name, classified })
    } catch (e) {
      setStage({ kind: 'error', message: errText(e) })
    }
  }

  async function handleCommit(fileName: string, classified: ClassifiedRow[]) {
    setStage({ kind: 'committing' })
    try {
      const result = await commitBatch(
        supabase,
        {
          source: SOURCE,
          transport: 'xlsx',
          fileName,
          fileNote: null,
          importedByPersonId: profile?.person_id ?? null,
          importedByName: profile?.display_name ?? profile?.email ?? 'unknown',
        },
        classified,
      )
      setStage({ kind: 'done', batchId: result.batchId, summary: result.summary })
      setLinksToken((t) => t + 1)
    } catch (e) {
      setStage({ kind: 'error', message: errText(e) })
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-5 flex gap-2 border-b border-surface-line pb-3">
        <button
          onClick={() => setSource('roster')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            source === 'roster'
              ? 'bg-charcoal text-white'
              : 'border border-surface-line hover:bg-surface-muted'
          }`}
        >
          Push roster
        </button>
        <button
          onClick={() => setSource('dev_paths')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            source === 'dev_paths'
              ? 'bg-charcoal text-white'
              : 'border border-surface-line hover:bg-surface-muted'
          }`}
        >
          Development paths
        </button>
        <button
          onClick={() => setSource('positions')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            source === 'positions'
              ? 'bg-charcoal text-white'
              : 'border border-surface-line hover:bg-surface-muted'
          }`}
        >
          Positions
        </button>
      </div>

      {source === 'dev_paths' && <DevPathsPanel profile={profile} />}
      {source === 'positions' && <PositionsPanel />}

      {source === 'roster' && (
        <>
      <h2 className="mb-1 text-lg font-medium">Data Sources — Push roster</h2>
      <p className="mb-6 text-sm text-charcoal/60">
        Excel export today; the same pipeline accepts a Push API response
        later. Salary and compensation fields are never read. Eligibility is
        decided by position configuration, not salary status.
      </p>

      <PendingLinksPanel actor={actor} token={linksToken} />

      {stage.kind === 'idle' && (
        <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-surface-line bg-white p-10 text-center hover:border-charcoal/40">
          <Upload className="h-8 w-8 text-charcoal/40" />
          <span className="text-sm font-medium">Choose the Push roster export (.xlsx)</span>
          <span className="text-xs text-charcoal/50">
            Nothing is written until you review and confirm
          </span>
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
        </label>
      )}

      {(stage.kind === 'parsing' || stage.kind === 'committing') && (
        <p className="p-6 text-sm text-charcoal/50">
          {stage.kind === 'parsing' ? 'Reading and classifying…' : 'Writing batch…'}
        </p>
      )}

      {stage.kind === 'preview' && (
        <PreviewPanel
          fileName={stage.fileName}
          classified={stage.classified}
          onCommit={() => void handleCommit(stage.fileName, stage.classified)}
          onCancel={() => setStage({ kind: 'idle' })}
        />
      )}

      {stage.kind === 'done' && (
        <div className="rounded-xl border border-surface-line bg-white p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-5 w-5 text-green-700" /> Sync committed
          </div>
          <SummaryLine label="Imported" value={stage.summary.imported} />
          <SummaryLine
            label="Imported flagged for review"
            value={stage.summary.importedForReview}
          />
          <SummaryLine label="Already present (unchanged)" value={stage.summary.duplicates} />
          <SummaryLine
            label="Possible matches to manual profiles"
            value={stage.summary.possibleMatch}
          />
          <SummaryLine label="Out of scope (recorded)" value={stage.summary.skipped} />
          {stage.summary.possibleMatch > 0 && (
            <p className="mt-3 flex items-center gap-1.5 rounded-md bg-cg-orange-soft px-3 py-2 text-xs text-charcoal/70">
              <Link2 className="h-3.5 w-3.5 text-cg-orange" />
              {stage.summary.possibleMatch} row(s) matched a manually-added
              profile and were held for linking — scroll up to Pending links to
              confirm or reject each.
            </p>
          )}
          <p className="mt-3 text-xs text-charcoal/50">Batch {stage.batchId}</p>
          <button
            onClick={() => setStage({ kind: 'idle' })}
            className="mt-4 rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            Run another sync
          </button>
        </div>
      )}

      {stage.kind === 'error' && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-6 text-sm">
          <p className="mb-2 font-medium text-danger">Sync failed</p>
          <p className="text-charcoal/70">{stage.message}</p>
          <button
            onClick={() => setStage({ kind: 'idle' })}
            className="mt-4 rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            Start over
          </button>
        </div>
      )}
        </>
      )}
    </div>
  )
}

function PreviewPanel({
  fileName,
  classified,
  onCommit,
  onCancel,
}: {
  fileName: string
  classified: ClassifiedRow[]
  onCommit: () => void
  onCancel: () => void
}) {
  const summary = summarize(classified)
  const review = classified.filter((c) => c.disposition === 'imported_for_review')

  return (
    <div className="rounded-xl border border-surface-line bg-white p-6">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium">
        <FileSpreadsheet className="h-5 w-5 text-charcoal/50" />
        {fileName}
      </div>
      <SummaryLine label="Source rows with a person" value={summary.rowCount} />
      <SummaryLine label="Will import" value={summary.imported} strong />
      <SummaryLine
        label="Will import flagged for review"
        value={summary.importedForReview}
        strong
      />
      <SummaryLine label="Out of scope (recorded, not imported)" value={summary.skipped} />

      {review.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Importing flagged for review ({review.length})
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-charcoal/70">
            {review.map((c) => (
              <li key={c.row.rowNumber}>
                <span className="font-medium">{c.row.displayName}</span>
                {c.row.companyName ? ` — ${c.row.companyName}` : ''}: {c.reviewNote}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex gap-3">
        <button
          onClick={onCommit}
          className="rounded-md bg-cg-orange px-4 py-2 text-sm font-medium text-white hover:bg-cg-orange-hover"
        >
          Commit {summary.imported + summary.importedForReview} people
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-surface-line px-4 py-2 text-sm hover:bg-surface-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function SummaryLine({
  label,
  value,
  strong,
}: {
  label: string
  value: number
  strong?: boolean
}) {
  return (
    <p className={`flex justify-between border-b border-surface-line/60 py-1.5 text-sm ${strong ? 'font-medium' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  )
}

interface PickPerson {
  id: string
  full_name: string
}

// Admin-confirmed linking (ADR 0011): Push rows whose name matched a manually-
// added profile wait here. Confirm links the Push identity to that profile
// (preserving its data); Reject imports the row as a brand-new person.
function PendingLinksPanel({ actor, token }: { actor: Actor; token: number }) {
  const [links, setLinks] = useState<PendingLink[] | null>(null)
  const [people, setPeople] = useState<PickPerson[]>([])
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchPendingLinks()
      .then((rows) => {
        setLinks(rows)
        setTargets((prev) => {
          const next = { ...prev }
          for (const r of rows) {
            if (!next[r.importRowId]) next[r.importRowId] = r.suggestedPersonId ?? ''
          }
          return next
        })
      })
      .catch((e: Error) => setError(e.message))
    supabase
      .from('people_center_people')
      .select('id, full_name')
      .neq('status', 'departed')
      .order('full_name')
      .then(({ data }) => setPeople((data as PickPerson[]) ?? []))
  }, [])

  useEffect(() => {
    load()
  }, [load, token])

  if (!links || links.length === 0) return null

  async function resolve(row: PendingLink, action: 'confirm' | 'reject') {
    setBusyId(row.importRowId)
    setError(null)
    try {
      if (action === 'confirm') {
        const personId = targets[row.importRowId]
        if (!personId) throw new Error('Pick which profile this is before confirming.')
        await confirmLink(actor, row.importRowId, personId)
      } else {
        await rejectLink(actor, row.importRowId)
      }
      load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-cg-orange/40 bg-cg-orange-soft/50 p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-charcoal">
        <Link2 className="h-4 w-4 text-cg-orange" /> Pending links ({links.length})
      </h3>
      <p className="mb-3 text-xs text-charcoal/60">
        These Push rows match a manually-added profile. Confirm to link the Push
        identity to that profile (its data is preserved — only the connection is
        added), or reject to bring the row in as a new person.
      </p>
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <ul className="space-y-3">
        {links.map((row) => (
          <li
            key={row.importRowId}
            className="rounded-lg border border-surface-line bg-surface p-3"
          >
            <div className="mb-2 text-sm">
              <span className="font-medium">{row.displayName}</span>
              <span className="text-charcoal/60">
                {row.primaryPosition ? ` · ${row.primaryPosition}` : ''}
                {row.companyName ? ` · ${row.companyName}` : ''}
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex flex-1 items-center gap-2 text-xs text-charcoal/60">
                Link to
                <select
                  value={targets[row.importRowId] ?? ''}
                  onChange={(e) =>
                    setTargets((prev) => ({ ...prev, [row.importRowId]: e.target.value }))
                  }
                  className="min-w-0 flex-1 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm text-charcoal"
                >
                  <option value="">— choose profile —</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button
                  disabled={busyId === row.importRowId}
                  onClick={() => void resolve(row, 'confirm')}
                  className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
                >
                  {busyId === row.importRowId ? '…' : 'Confirm link'}
                </button>
                <button
                  disabled={busyId === row.importRowId}
                  onClick={() => void resolve(row, 'reject')}
                  className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted disabled:opacity-50"
                >
                  Not a match
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const KIND_OPTIONS: { value: PositionAdminRow['default_person_kind']; label: string }[] = [
  { value: 'manager', label: 'Manager' },
  { value: 'emerging_leader', label: 'Emerging leader' },
  { value: 'key_team_member', label: 'Key team member' },
]

// The People Center side of the CGOPS position vocabulary (ADR 0012). "Sync
// from CGOPS" pulls the master; new CGOPS positions arrive hidden + ineligible
// and an admin curates them here. CGOPS owns name/description; this panel owns
// visibility, sync-eligibility, and default kind.
function PositionsPanel() {
  const [rows, setRows] = useState<PositionAdminRow[] | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<PositionSyncResult | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchPositionsAdmin()
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function sync() {
    setSyncing(true)
    setError(null)
    try {
      setResult(await syncPositionsFromCgops())
      load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setSyncing(false)
    }
  }

  async function patch(row: PositionAdminRow, p: Partial<PositionAdminRow>) {
    setSavingId(row.id)
    setError(null)
    // Optimistic — reflect immediately, roll back on failure.
    setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, ...p } : r)) ?? prev)
    try {
      await updatePositionConfig(row.id, p)
    } catch (e) {
      setError(errText(e))
      load()
    } finally {
      setSavingId(null)
    }
  }

  return (
    <>
      <h2 className="mb-1 text-lg font-medium">Data Sources — Positions</h2>
      <p className="mb-4 text-sm text-charcoal/60">
        Positions come from CGOPS (Operational Center → Positions). Sync pulls
        the master; CGOPS owns each position's name. People Center owns whether
        it's <b>shown</b> in pickers, whether holders are <b>eligible</b> for
        the roster sync, and the default <b>kind</b>. New CGOPS positions arrive
        hidden — turn on the ones you want (e.g. HQ roles).
      </p>

      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => void sync()}
          disabled={syncing}
          className="flex items-center gap-1.5 rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          <FileSpreadsheet className="h-4 w-4" />
          {syncing ? 'Syncing…' : 'Sync from CGOPS'}
        </button>
        {result && (
          <p className="text-xs text-charcoal/60">
            {result.created} new · {result.updated} refreshed · {result.linked} linked
          </p>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {!rows ? (
        <p className="p-2 text-sm text-charcoal/50">Loading positions…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-surface-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
                <th className="px-3 py-2.5 font-medium">Position</th>
                <th className="px-3 py-2.5 font-medium">CGOPS</th>
                <th className="px-3 py-2.5 font-medium">Show</th>
                <th className="px-3 py-2.5 font-medium">Roster-eligible</th>
                <th className="px-3 py-2.5 font-medium">Default kind</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b border-surface-line/60 last:border-0 ${
                    r.show_in_people_center ? '' : 'text-charcoal/40'
                  }`}
                >
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.external_ref ? (
                      <span className="text-success">linked</span>
                    ) : (
                      <span className="text-charcoal/40">local only</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={r.show_in_people_center}
                      disabled={savingId === r.id}
                      onChange={(e) =>
                        void patch(r, { show_in_people_center: e.target.checked })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={r.people_center_eligible}
                      disabled={savingId === r.id}
                      onChange={(e) =>
                        void patch(r, { people_center_eligible: e.target.checked })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={r.default_person_kind}
                      disabled={savingId === r.id}
                      onChange={(e) =>
                        void patch(r, {
                          default_person_kind:
                            e.target.value as PositionAdminRow['default_person_kind'],
                        })
                      }
                      className="rounded-md border border-surface-line bg-surface px-2 py-1 text-sm text-charcoal"
                    >
                      {KIND_OPTIONS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-charcoal/50">
        "Roster-eligible" decides whether a Push roster sync brings holders of
        this position into People Center — leave HQ / off-roster positions
        unchecked.
      </p>
    </>
  )
}

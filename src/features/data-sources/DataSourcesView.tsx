import { useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { UserProfile } from '../../types'
import { readXlsx } from './pipeline/transports/xlsxFile'
import { normalize } from './pipeline/normalize'
import { classify, summarize } from './pipeline/classify'
import { loadMappings } from './pipeline/mappingLoader'
import { commitBatch } from './pipeline/commit'
import type { ClassifiedRow } from './pipeline/types'

const SOURCE = 'push_roster'

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'preview'; fileName: string; classified: ClassifiedRow[] }
  | { kind: 'committing' }
  | { kind: 'done'; batchId: string; summary: ReturnType<typeof summarize> }
  | { kind: 'error'; message: string }

export function DataSourcesView({ profile }: { profile: UserProfile | null }) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })

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
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
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
    } catch (e) {
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <h2 className="mb-1 text-lg font-medium">Data Sources — Push roster</h2>
      <p className="mb-6 text-sm text-charcoal/60">
        Excel export today; the same pipeline accepts a Push API response
        later. Salary and compensation fields are never read. Eligibility is
        decided by position configuration, not salary status.
      </p>

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
          <SummaryLine label="Already present (unchanged)" value={stage.summary.duplicates} />
          <SummaryLine label="Needs review" value={stage.summary.needsReview} />
          <SummaryLine label="Out of scope (recorded)" value={stage.summary.skipped} />
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
  const review = classified.filter((c) => c.disposition === 'needs_review')

  return (
    <div className="rounded-xl border border-surface-line bg-white p-6">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium">
        <FileSpreadsheet className="h-5 w-5 text-charcoal/50" />
        {fileName}
      </div>
      <SummaryLine label="Source rows with a person" value={summary.rowCount} />
      <SummaryLine label="Will import" value={summary.imported} strong />
      <SummaryLine label="Needs review (recorded, not imported)" value={summary.needsReview} />
      <SummaryLine label="Out of scope (recorded, not imported)" value={summary.skipped} />

      {review.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Review queue ({review.length})
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
          Commit {summary.imported} people
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

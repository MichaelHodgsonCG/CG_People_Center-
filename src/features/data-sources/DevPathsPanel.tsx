// Development-path uploads (ADR 0010). Two modes, same drop target:
//   * master workbook (tabs = roles)   → template sync
//   * filled workbook (tabs = managers) → assessment import, with a
//     person-matching preview — nothing commits unreviewed.

import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  Upload,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { UserProfile } from '../../types'
import {
  parseDevPathWorkbook,
  type ParsedDevPathWorkbook,
} from './pipeline/devPath/parse'
import {
  commitAssessments,
  loadMatchingOptions,
  matchTabs,
  syncTemplates,
  type AssessmentCommitSummary,
  type MatchedTab,
  type PersonOption,
  type TemplateOption,
  type TemplateSyncSummary,
} from './pipeline/devPath/commit'

type Mode = 'template' | 'assessment'

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | {
      kind: 'template-preview'
      fileName: string
      parsed: ParsedDevPathWorkbook
    }
  | {
      kind: 'assessment-preview'
      fileName: string
      parsed: ParsedDevPathWorkbook
      tabs: MatchedTab[]
      templates: TemplateOption[]
      people: PersonOption[]
    }
  | { kind: 'committing' }
  | { kind: 'template-done'; results: TemplateSyncSummary[] }
  | { kind: 'assessment-done'; results: AssessmentCommitSummary[]; skippedTabs: number }
  | { kind: 'error'; message: string }

export function DevPathsPanel({ profile }: { profile: UserProfile | null }) {
  const [mode, setMode] = useState<Mode>('assessment')
  const [periodLabel, setPeriodLabel] = useState('F26')
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [progress, setProgress] = useState<string | null>(null)
  const actorName = profile?.display_name ?? profile?.email ?? 'unknown'

  async function handleFile(file: File) {
    setStage({ kind: 'parsing' })
    try {
      const parsed = await parseDevPathWorkbook(file)
      if (parsed.pathSheets.length === 0) {
        throw new Error(
          'No development-path sheets found in this workbook. ' +
            (parsed.skipped[0]?.reason ?? ''),
        )
      }
      if (mode === 'template') {
        setStage({ kind: 'template-preview', fileName: file.name, parsed })
      } else {
        const { templates, people } = await loadMatchingOptions(supabase)
        if (templates.length === 0) {
          throw new Error(
            'No path templates exist yet — sync the master workbook first (switch to "Master workbook" above).',
          )
        }
        const tabs = matchTabs(parsed.pathSheets, templates, people)
        setStage({
          kind: 'assessment-preview',
          fileName: file.name,
          parsed,
          tabs,
          templates,
          people,
        })
      }
    } catch (e) {
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function handleTemplateCommit(parsed: ParsedDevPathWorkbook) {
    setStage({ kind: 'committing' })
    setProgress(null)
    try {
      const results = await syncTemplates(
        supabase,
        parsed.pathSheets,
        actorName,
        setProgress,
      )
      setStage({ kind: 'template-done', results })
    } catch (e) {
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setProgress(null)
    }
  }

  async function handleAssessmentCommit(fileName: string, tabs: MatchedTab[]) {
    setStage({ kind: 'committing' })
    try {
      const ready = tabs.filter((t) => t.templateId && t.personId)
      const results = await commitAssessments(
        supabase,
        { periodLabel: periodLabel.trim() || 'F26', fileName, importedByName: actorName },
        ready,
      )
      setStage({
        kind: 'assessment-done',
        results,
        skippedTabs: tabs.length - ready.length,
      })
    } catch (e) {
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-medium">Data Sources — Development paths</h2>
      <p className="mb-4 text-sm text-charcoal/60">
        The quarterly development-path workbooks. Sync the master workbook when
        the questions change; upload a location's filled workbook (one tab per
        manager) to record scores. Re-uploads merge — existing quarters update,
        new ones add.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ModeButton
          active={mode === 'assessment'}
          onClick={() => {
            setMode('assessment')
            setStage({ kind: 'idle' })
          }}
        >
          Filled paths (tabs = managers)
        </ModeButton>
        <ModeButton
          active={mode === 'template'}
          onClick={() => {
            setMode('template')
            setStage({ kind: 'idle' })
          }}
        >
          Master workbook (tabs = roles)
        </ModeButton>
        {mode === 'assessment' && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-xs uppercase tracking-wide text-charcoal/50">Period</span>
            <input
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              className="w-20 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
            />
          </label>
        )}
      </div>

      {stage.kind === 'idle' && (
        <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-surface-line bg-white p-10 text-center hover:border-charcoal/40">
          <Upload className="h-8 w-8 text-charcoal/40" />
          <span className="text-sm font-medium">
            {mode === 'template'
              ? 'Choose the master development-path workbook (.xlsx)'
              : 'Choose a location’s filled development-path workbook (.xlsx)'}
          </span>
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
          {stage.kind === 'parsing' ? 'Reading workbook…' : progress ?? 'Writing…'}
        </p>
      )}

      {stage.kind === 'template-preview' && (
        <div className="rounded-xl border border-surface-line bg-white p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <FileSpreadsheet className="h-5 w-5 text-charcoal/50" /> {stage.fileName}
          </div>
          <ul className="mb-3 space-y-1.5 text-sm">
            {stage.parsed.pathSheets.map((s) => (
              <li key={s.tabName} className="flex justify-between border-b border-surface-line/60 py-1.5">
                <span className="font-medium">{s.tabName}</span>
                <span className="text-charcoal/60">
                  {s.sections.length} sections · {s.itemCount} items
                </span>
              </li>
            ))}
          </ul>
          <SkippedList skipped={stage.parsed.skipped} />
          <p className="mt-3 text-xs text-charcoal/50">
            Existing questions keep their history: matching items are kept,
            reworded ones are added, removed ones are deactivated — never
            deleted.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => void handleTemplateCommit(stage.parsed)}
              className="rounded-md bg-cg-orange px-4 py-2 text-sm font-medium text-white hover:bg-cg-orange-hover"
            >
              Sync {stage.parsed.pathSheets.length} role templates
            </button>
            <CancelButton onClick={() => setStage({ kind: 'idle' })} />
          </div>
        </div>
      )}

      {stage.kind === 'assessment-preview' && (
        <AssessmentPreview
          stage={stage}
          onChange={(tabs) => setStage({ ...stage, tabs })}
          onCommit={() => void handleAssessmentCommit(stage.fileName, stage.tabs)}
          onCancel={() => setStage({ kind: 'idle' })}
        />
      )}

      {stage.kind === 'template-done' && (
        <div className="rounded-xl border border-surface-line bg-white p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-5 w-5 text-green-700" /> Templates synced
          </div>
          <ul className="space-y-1.5 text-sm">
            {stage.results.map((r) => (
              <li key={r.templateId} className="border-b border-surface-line/60 py-1.5">
                <span className="font-medium">{r.title}</span>
                <span className="ml-2 text-charcoal/60">
                  {r.itemsCreated} new · {r.itemsUnchanged} unchanged
                  {r.itemsReactivated > 0 ? ` · ${r.itemsReactivated} reactivated` : ''}
                  {r.itemsDeactivated > 0 ? ` · ${r.itemsDeactivated} retired` : ''}
                </span>
              </li>
            ))}
          </ul>
          <ResetButton onClick={() => setStage({ kind: 'idle' })} />
        </div>
      )}

      {stage.kind === 'assessment-done' && (
        <div className="rounded-xl border border-surface-line bg-white p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-5 w-5 text-green-700" /> Paths imported
          </div>
          <ul className="space-y-1.5 text-sm">
            {stage.results.map((r) => (
              <li key={r.assessmentId} className="border-b border-surface-line/60 py-1.5">
                <span className="font-medium">{r.tabName}</span>
                <span className="ml-2 text-charcoal/60">
                  {r.scoresWritten} scores
                  {r.notesWritten > 0 ? ` · ${r.notesWritten} notes` : ''}
                </span>
                {r.itemsUnmatched > 0 && (
                  <p className="mt-1 text-xs text-warning">
                    {r.itemsUnmatched} scored line(s) didn’t match any known
                    question and were skipped — usually an older sheet; re-sync
                    the matching master version first, then re-upload.
                  </p>
                )}
              </li>
            ))}
          </ul>
          {stage.skippedTabs > 0 && (
            <p className="mt-2 text-xs text-charcoal/60">
              {stage.skippedTabs} tab(s) skipped (no person or role selected).
            </p>
          )}
          <ResetButton onClick={() => setStage({ kind: 'idle' })} />
        </div>
      )}

      {stage.kind === 'error' && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-6 text-sm">
          <p className="mb-2 font-medium text-danger">Upload failed</p>
          <p className="text-charcoal/70">{stage.message}</p>
          <ResetButton onClick={() => setStage({ kind: 'idle' })} label="Start over" />
        </div>
      )}
    </div>
  )
}

function AssessmentPreview({
  stage,
  onChange,
  onCommit,
  onCancel,
}: {
  stage: Extract<Stage, { kind: 'assessment-preview' }>
  onChange: (tabs: MatchedTab[]) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const ready = stage.tabs.filter((t) => t.templateId && t.personId)

  function update(i: number, patch: Partial<MatchedTab>) {
    onChange(stage.tabs.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }

  return (
    <div className="rounded-xl border border-surface-line bg-white p-6">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium">
        <ClipboardList className="h-5 w-5 text-charcoal/50" /> {stage.fileName}
      </div>
      <p className="mb-3 text-xs text-charcoal/60">
        Confirm who each tab belongs to. Tabs without a person (or role) are
        skipped, not lost — fix and re-upload anytime.
      </p>
      <div className="space-y-3">
        {stage.tabs.map((tab, i) => (
          <div
            key={tab.sheet.tabName}
            className="rounded-md border border-surface-line p-3"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{tab.sheet.tabName}</span>
              <span className="text-xs text-charcoal/50">
                {tab.sheet.scoreCount} scores in {tab.sheet.sections.length} sections
                {tab.sheet.restaurant ? ` · ${tab.sheet.restaurant}` : ''}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={tab.personId ?? ''}
                onChange={(e) => update(i, { personId: e.target.value || null })}
                className={`w-full rounded-md border bg-surface px-2 py-1.5 text-sm ${
                  tab.personId ? 'border-surface-line' : 'border-warning'
                }`}
              >
                <option value="">— who is this? —</option>
                {stage.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
              <select
                value={tab.templateId ?? ''}
                onChange={(e) => update(i, { templateId: e.target.value || null })}
                className={`w-full rounded-md border bg-surface px-2 py-1.5 text-sm ${
                  tab.templateId ? 'border-surface-line' : 'border-warning'
                }`}
              >
                <option value="">— which path? —</option>
                {stage.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
      <SkippedList skipped={stage.parsed.skipped} />
      <div className="mt-4 flex gap-3">
        <button
          onClick={onCommit}
          disabled={ready.length === 0}
          className="rounded-md bg-cg-orange px-4 py-2 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          Import {ready.length} of {stage.tabs.length} tabs
        </button>
        <CancelButton onClick={onCancel} />
      </div>
    </div>
  )
}

function SkippedList({ skipped }: { skipped: { tabName: string; reason: string }[] }) {
  if (skipped.length === 0) return null
  return (
    <div className="mt-3 rounded-md border border-surface-line bg-surface-muted/40 p-3">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-charcoal/60">
        <AlertTriangle className="h-3.5 w-3.5" /> Tabs not parsed
      </p>
      <ul className="space-y-0.5 text-xs text-charcoal/60">
        {skipped.map((s) => (
          <li key={s.tabName}>
            <span className="font-medium">{s.tabName}</span> — {s.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        active
          ? 'bg-charcoal text-white'
          : 'border border-surface-line hover:bg-surface-muted'
      }`}
    >
      {children}
    </button>
  )
}

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-surface-line px-4 py-2 text-sm hover:bg-surface-muted"
    >
      Cancel
    </button>
  )
}

function ResetButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="mt-4 rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
    >
      {label ?? 'Upload another'}
    </button>
  )
}

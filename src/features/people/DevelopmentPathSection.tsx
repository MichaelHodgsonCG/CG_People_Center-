// Cheat-sheet Development Path section (ADR 0010). A PROJECTION of the
// imported assessments — progress is computed here, never stored. RLS keeps
// this chain-visible (admin/executive or strict ancestors); everyone else
// gets no rows and the section simply doesn't render.

import { useEffect, useMemo, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface AssessmentRow {
  id: string
  period_label: string
  restaurant: string | null
  trainer_name: string | null
  updated_at: string
  template: { id: string; title: string } | null
  scores: { item_id: string; quarter: number; score: number }[]
}

interface SectionRow {
  id: string
  template_id: string
  phase: string | null
  title: string
  sort_order: number
  active: boolean
  items: { id: string; active: boolean }[]
}

export function DevelopmentPathSection({ personId }: { personId: string }) {
  const [assessments, setAssessments] = useState<AssessmentRow[]>([])
  const [sections, setSections] = useState<SectionRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    setAssessments([])
    setSections([])
    setSelectedId(null)
    supabase
      .from('people_center_dev_assessments')
      .select(
        `id, period_label, restaurant, trainer_name, updated_at,
         template:people_center_dev_path_templates ( id, title ),
         scores:people_center_dev_scores ( item_id, quarter, score )`,
      )
      .eq('person_id', personId)
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        const rows = (data as unknown as AssessmentRow[]) ?? []
        setAssessments(rows)
        setSelectedId(rows[0]?.id ?? null)
        const templateIds = [...new Set(rows.map((r) => r.template?.id).filter(Boolean))]
        if (templateIds.length > 0) {
          void supabase
            .from('people_center_dev_path_sections')
            .select(
              `id, template_id, phase, title, sort_order, active,
               items:people_center_dev_path_items ( id, active )`,
            )
            .in('template_id', templateIds as string[])
            .order('sort_order')
            .then(({ data: s }) => setSections((s as unknown as SectionRow[]) ?? []))
        }
      })
  }, [personId])

  const selected = assessments.find((a) => a.id === selectedId) ?? null

  const computed = useMemo(() => {
    if (!selected?.template) return null
    const scoreByItem = new Map<string, Map<number, number>>()
    for (const s of selected.scores) {
      const m = scoreByItem.get(s.item_id) ?? new Map<number, number>()
      m.set(s.quarter, s.score)
      scoreByItem.set(s.item_id, m)
    }
    const quarters = [1, 2, 3, 4]
    const rows = sections
      .filter((sec) => sec.template_id === selected.template!.id)
      .filter((sec) => sec.active || sec.items.some((i) => scoreByItem.has(i.id)))
      .map((sec) => {
        const activeCount = sec.items.filter((i) => i.active).length
        const perQuarter = quarters.map((q) => {
          let sum = 0
          let scored = 0
          for (const item of sec.items) {
            const v = scoreByItem.get(item.id)?.get(q)
            if (v !== undefined) {
              sum += v
              scored++
            }
          }
          const possible = 3 * Math.max(activeCount, scored)
          return scored > 0 ? { sum, possible } : null
        })
        return { section: sec, perQuarter }
      })

    const totals = quarters.map((_q, qi) => {
      let sum = 0
      let possible = 0
      let any = false
      for (const r of rows) {
        const cell = r.perQuarter[qi]
        if (cell) {
          sum += cell.sum
          possible += cell.possible
          any = true
        } else {
          const activeCount = r.section.items.filter((i) => i.active).length
          possible += 3 * activeCount
        }
      }
      return any ? { sum, possible } : null
    })
    const latestIdx = totals.reduce((acc, t, i) => (t ? i : acc), -1)
    return { rows, totals, latestIdx }
  }, [selected, sections])

  if (assessments.length === 0 || !computed) return null

  const latest = computed.latestIdx >= 0 ? computed.totals[computed.latestIdx] : null
  const pct =
    latest && latest.possible > 0 ? Math.round((latest.sum / latest.possible) * 100) : null

  return (
    <section className="rounded-xl border border-surface-line p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal/50">
          <TrendingUp className="h-3.5 w-3.5" /> Development path
        </h3>
        {assessments.length > 1 && (
          <select
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
            className="rounded-md border border-surface-line bg-surface px-2 py-1 text-xs"
          >
            {assessments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.template?.title ?? '?'} · {a.period_label}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="mb-3 text-xs text-charcoal/50">
        {selected?.template?.title} · {selected?.period_label}
        {selected?.restaurant ? ` · ${selected.restaurant}` : ''}
        {selected?.trainer_name ? ` · trained by ${selected.trainer_name}` : ''}
        {pct !== null && computed.latestIdx >= 0
          ? ` — QTR ${computed.latestIdx + 1}: ${pct}% of 'Trained & Able to Train Others'`
          : ''}
      </p>

      {pct !== null && (
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-cg-orange"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/40">
              <th className="py-1.5 pr-2 font-medium">Section</th>
              {[1, 2, 3, 4].map((q) => (
                <th key={q} className="px-2 py-1.5 text-right font-medium">
                  Q{q}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {computed.rows.map((r, i) => {
              const prevPhase = i > 0 ? computed.rows[i - 1].section.phase : undefined
              const showPhase = r.section.phase && r.section.phase !== prevPhase
              return (
                <PathRow
                  key={r.section.id}
                  phase={showPhase ? r.section.phase : null}
                  title={r.section.title}
                  perQuarter={r.perQuarter}
                />
              )
            })}
            <tr className="border-t border-surface-line font-medium">
              <td className="py-1.5 pr-2">Overall</td>
              {computed.totals.map((t, i) => (
                <td key={i} className="px-2 py-1.5 text-right tabular-nums">
                  {t ? `${t.sum}/${t.possible}` : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PathRow({
  phase,
  title,
  perQuarter,
}: {
  phase: string | null
  title: string
  perQuarter: ({ sum: number; possible: number } | null)[]
}) {
  return (
    <>
      {phase && (
        <tr>
          <td
            colSpan={5}
            className="pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-charcoal/40"
          >
            {phase}
          </td>
        </tr>
      )}
      <tr className="border-b border-surface-line/40 last:border-0">
        <td className="py-1 pr-2 text-charcoal/80">{titleCase(title)}</td>
        {perQuarter.map((cell, i) => (
          <td key={i} className="px-2 py-1 text-right tabular-nums text-charcoal/70">
            {cell ? `${cell.sum}/${cell.possible}` : '—'}
          </td>
        ))}
      </tr>
    </>
  )
}

function titleCase(s: string): string {
  const lower = s.toLowerCase()
  return lower.replace(/(^|[\s/&(-])[a-z]/g, (m) => m.toUpperCase())
}

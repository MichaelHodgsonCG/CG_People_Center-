// Org Chart — a live projection of people_center_people.manager_person_id
// (the graph ADR 0008 built), rendered as a collapsible tree rooted at the
// CEO. Stores nothing; clicking any person opens the cheat-sheet panel.
// People without a reporting line surface in their own bucket so gaps are
// visible instead of silently missing.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Crosshair,
  List,
  Network,
  Workflow,
  X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PersonPanel } from '../people/PersonPanel'
import type { UserProfile } from '../../types'
import './orgChart.css'

interface OrgPerson {
  id: string
  full_name: string
  status: 'active' | 'leave' | 'departed' | 'incoming' | 'candidate'
  person_kind: 'manager' | 'emerging_leader' | 'key_team_member'
  manager_person_id: string | null
  data_quality_status: 'ok' | 'needs_review'
  position_assignments: {
    is_primary: boolean
    ended_on: string | null
    positions: { name: string; level: number | null } | null
    locations: { name: string } | null
  }[]
}

interface TreeNode {
  person: OrgPerson
  children: TreeNode[]
  descendants: number
}

// The sync pipeline's placeholder for unresolved positions. When someone
// carries both an open placeholder and an open real assignment (a fixed
// review import whose placeholder was never ended), show the real one.
const PLACEHOLDER_POSITION = 'Needs Position Review'

function primaryOf(p: OrgPerson) {
  const open = p.position_assignments.filter((a) => !a.ended_on)
  const real = open.filter((a) => a.positions?.name !== PLACEHOLDER_POSITION)
  return (
    real.find((a) => a.is_primary) ??
    real[0] ??
    open.find((a) => a.is_primary) ??
    open[0] ??
    null
  )
}

// Seniority rank of a person's primary position (lower = more senior, per the
// position ranking template). People without a ranked position sort last so a
// missing level never jumps someone above real managers.
function levelOf(p: OrgPerson) {
  const lvl = primaryOf(p)?.positions?.level
  return lvl ?? Number.POSITIVE_INFINITY
}

function buildForest(people: OrgPerson[]): { roots: TreeNode[]; unassigned: OrgPerson[] } {
  const nodes = new Map<string, TreeNode>(
    people.map((p) => [p.id, { person: p, children: [], descendants: 0 }]),
  )
  const roots: TreeNode[] = []
  const unassigned: OrgPerson[] = []
  for (const p of people) {
    const node = nodes.get(p.id)!
    if (p.manager_person_id && nodes.has(p.manager_person_id)) {
      nodes.get(p.manager_person_id)!.children.push(node)
    } else if (p.manager_person_id) {
      // manager exists but is filtered out (e.g. departed) — treat as root
      roots.push(node)
    } else {
      roots.push(node)
    }
  }
  const count = (n: TreeNode): number => {
    // Siblings order by seniority (position level), then name as a tiebreaker.
    n.children.sort(
      (a, b) =>
        levelOf(a.person) - levelOf(b.person) ||
        a.person.full_name.localeCompare(b.person.full_name),
    )
    n.descendants = n.children.reduce((sum, c) => sum + 1 + count(c), 0)
    return n.descendants
  }
  roots.forEach(count)
  // People with no manager and no team are "unassigned" (reporting-line gaps),
  // not organizational roots.
  const trueRoots = roots.filter((r) => {
    if (r.children.length > 0) return true
    unassigned.push(r.person)
    return false
  })
  trueRoots.sort((a, b) => b.descendants - a.descendants)
  return { roots: trueRoots, unassigned }
}

interface OrgChartViewProps {
  session: Session
  profile: UserProfile | null
}

export function OrgChartView({ session, profile }: OrgChartViewProps) {
  const [people, setPeople] = useState<OrgPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'chart'>('list')
  // Focus mode: render the chart from this person down, hiding everything
  // above — the way to work with one region of a large chart.
  const [focusId, setFocusId] = useState<string | null>(null)
  // Per-node user override (true = collapsed); absent = the depth default.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map())
  const [allExpanded, setAllExpanded] = useState(false)

  const load = useCallback(() => {
    supabase
      .from('people_center_people')
      .select(
        `id, full_name, status, person_kind, manager_person_id, data_quality_status,
         position_assignments:people_center_position_assignments ( is_primary, ended_on,
           positions:people_center_positions ( name, level ),
           locations:people_center_locations ( name ) )`,
      )
      // Candidates are prospects, not org members — keep them out of the tree.
      .not('status', 'in', '(departed,candidate)')
      .order('full_name')
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setPeople((data as unknown as OrgPerson[]) ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const { roots, unassigned } = useMemo(() => buildForest(people), [people])

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])

  // The focused subtree, if any. Depth defaults become RELATIVE to the focus
  // person (they render at depth 0), so focusing a region opens its teams.
  const focusNode = useMemo(() => {
    if (!focusId) return null
    const stack = [...roots]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.person.id === focusId) return n
      stack.push(...n.children)
    }
    return null // person left the chart — fall back to the full view
  }, [roots, focusId])

  // Breadcrumb up the reporting line from the focus person (cycle-safe).
  const focusTrail = useMemo(() => {
    if (!focusNode) return []
    const trail: OrgPerson[] = []
    const seen = new Set<string>([focusNode.person.id])
    let cur = focusNode.person.manager_person_id
    while (cur && !seen.has(cur)) {
      const p = peopleById.get(cur)
      if (!p) break
      trail.unshift(p)
      seen.add(cur)
      cur = p.manager_person_id
    }
    return trail
  }, [focusNode, peopleById])

  const focus = useCallback((id: string | null) => {
    setFocusId(id)
    setOverrides(new Map()) // fresh depth defaults for the new vantage point
  }, [])

  const displayRoots = focusNode ? [focusNode] : roots

  // Default: location teams (depth >= 2) start collapsed unless "expand all";
  // explicit user toggles always win.
  const isCollapsed = useCallback(
    (id: string, depth: number, hasChildren: boolean) => {
      if (!hasChildren) return false
      const override = overrides.get(id)
      if (override !== undefined) return override
      return allExpanded ? false : depth >= 2
    },
    [overrides, allExpanded],
  )

  const toggle = useCallback(
    (id: string, depth: number) => {
      setOverrides((prev) => {
        const next = new Map(prev)
        next.set(id, !isCollapsed(id, depth, true))
        return next
      })
    },
    [isCollapsed],
  )

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading org chart…</p>
  if (error) return <p className="p-6 text-sm text-danger">Could not load org chart: {error}</p>

  return (
    <div className={`mx-auto w-full p-4 sm:p-6 ${view === 'chart' ? 'max-w-none' : 'max-w-4xl'}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-charcoal/50">
          {focusNode
            ? `${focusNode.descendants + 1} people under ${focusNode.person.full_name}`
            : `${people.length} people`}{' '}
          · live from reporting lines
        </p>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-surface-line">
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1 rounded-l-md px-2.5 py-1.5 text-xs ${
                view === 'list' ? 'bg-charcoal text-white' : 'hover:bg-surface-muted'
              }`}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button
              onClick={() => setView('chart')}
              className={`flex items-center gap-1 rounded-r-md px-2.5 py-1.5 text-xs ${
                view === 'chart' ? 'bg-charcoal text-white' : 'hover:bg-surface-muted'
              }`}
            >
              <Workflow className="h-3.5 w-3.5" /> Chart
            </button>
          </div>
          <button
            onClick={() => {
              setAllExpanded((v) => !v)
              setOverrides(new Map())
            }}
            className="rounded-md border border-surface-line px-2.5 py-1.5 text-xs hover:bg-surface-muted"
          >
            {allExpanded ? 'Collapse teams' : 'Expand all'}
          </button>
        </div>
      </div>

      {focusNode && (
        <div className="mb-3 flex flex-wrap items-center gap-1 rounded-md border border-surface-line bg-surface-muted/40 px-3 py-2 text-sm">
          <button
            onClick={() => focus(null)}
            className="font-medium text-cg-orange underline-offset-2 hover:underline"
          >
            Full chart
          </button>
          {focusTrail.map((p) => (
            <span key={p.id} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-charcoal/30" />
              <button
                onClick={() => focus(p.id)}
                className="underline-offset-2 hover:text-cg-orange hover:underline"
              >
                {p.full_name}
              </button>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-charcoal/30" />
            <span className="font-medium">{focusNode.person.full_name}</span>
          </span>
          <button
            onClick={() => focus(null)}
            aria-label="Back to full chart"
            className="ml-auto rounded p-0.5 text-charcoal/40 hover:text-charcoal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {roots.length === 0 ? (
        <div className="rounded-xl border border-surface-line bg-surface p-10 text-center">
          <Network className="mx-auto mb-3 h-8 w-8 text-charcoal/30" />
          <h3 className="mb-1 text-sm font-medium">No reporting lines yet</h3>
          <p className="mx-auto max-w-sm text-sm text-charcoal/60">
            Run the org graph bootstrap migration, or set managers from the
            person panel, and the chart draws itself.
          </p>
        </div>
      ) : view === 'list' ? (
        <div className="rounded-xl border border-surface-line bg-surface p-4">
          {displayRoots.map((r) => (
            <TreeRow
              key={r.person.id}
              node={r}
              depth={0}
              isCollapsed={isCollapsed}
              onToggle={toggle}
              onOpen={setSelectedId}
              onFocus={focus}
            />
          ))}
        </div>
      ) : (
        <div className="oc-tree overflow-x-auto rounded-xl border border-surface-line bg-surface p-6">
          {displayRoots.map((r) => (
            <ul key={r.person.id} className="min-w-max">
              <li>
                <ChartNode
                  node={r}
                  depth={0}
                  isCollapsed={isCollapsed}
                  onToggle={toggle}
                  onOpen={setSelectedId}
                  onFocus={focus}
                />
              </li>
            </ul>
          ))}
        </div>
      )}

      {!focusNode && unassigned.length > 0 && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> No reporting line ({unassigned.length})
          </h3>
          <ul className="space-y-1">
            {unassigned.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setSelectedId(p.id)}
                  className="text-sm text-charcoal/80 underline-offset-2 hover:text-cg-orange hover:underline"
                >
                  {p.full_name}
                </button>
                <span className="ml-2 text-xs text-charcoal/50">
                  {primaryOf(p)?.positions?.name ?? 'no position'}
                  {primaryOf(p)?.locations?.name ? ` — ${primaryOf(p)!.locations!.name}` : ''}
                </span>
              </li>
            ))}
          </ul>
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

function TreeRow({
  node,
  depth,
  isCollapsed,
  onToggle,
  onOpen,
  onFocus,
}: {
  node: TreeNode
  depth: number
  isCollapsed: (id: string, depth: number, hasChildren: boolean) => boolean
  onToggle: (id: string, depth: number) => void
  onOpen: (id: string) => void
  onFocus: (id: string) => void
}) {
  const p = node.person
  const primary = primaryOf(p)
  const hasChildren = node.children.length > 0
  const collapsedHere = isCollapsed(p.id, depth, hasChildren)

  return (
    <div>
      <div
        className="flex items-center gap-1.5 rounded-md py-1 pr-2 hover:bg-surface-muted/60"
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(p.id, depth)}
            aria-label={collapsedHere ? 'Expand team' : 'Collapse team'}
            className="rounded p-0.5 text-charcoal/50 hover:text-charcoal"
          >
            {collapsedHere ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button
          onClick={() => onOpen(p.id)}
          className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-left"
        >
          <span className="text-sm font-medium hover:text-cg-orange">{p.full_name}</span>
          <span className="truncate text-xs text-charcoal/50">
            {primary?.positions?.name ?? ''}
            {primary?.locations?.name ? ` — ${primary.locations.name}` : ''}
          </span>
          {p.status === 'incoming' && (
            <span className="rounded-full bg-info/10 px-1.5 text-[10px] font-medium text-info">
              incoming
            </span>
          )}
          {p.data_quality_status === 'needs_review' && (
            <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />
          )}
          {hasChildren && (
            <span className="rounded-full bg-surface-muted px-1.5 text-[10px] text-charcoal/50">
              {node.descendants}
            </span>
          )}
        </button>
        {hasChildren && (
          <button
            onClick={() => onFocus(p.id)}
            title="Focus here — show only this team, hide everything above"
            aria-label={`Focus on ${p.full_name}'s team`}
            className="rounded p-0.5 text-charcoal/25 hover:text-cg-orange"
          >
            <Crosshair className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {hasChildren && !collapsedHere && (
        <div>
          {node.children.map((c) => (
            <TreeRow
              key={c.person.id}
              node={c}
              depth={depth + 1}
              isCollapsed={isCollapsed}
              onToggle={onToggle}
              onOpen={onOpen}
              onFocus={onFocus}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Flow-chart node: a card, and (expanded) a <ul> generation below it. The
// connector lines are drawn entirely by orgChart.css.
function ChartNode({
  node,
  depth,
  isCollapsed,
  onToggle,
  onOpen,
  onFocus,
}: {
  node: TreeNode
  depth: number
  isCollapsed: (id: string, depth: number, hasChildren: boolean) => boolean
  onToggle: (id: string, depth: number) => void
  onOpen: (id: string) => void
  onFocus: (id: string) => void
}) {
  const p = node.person
  const primary = primaryOf(p)
  const hasChildren = node.children.length > 0
  const collapsedHere = isCollapsed(p.id, depth, hasChildren)

  return (
    <>
      <div className="inline-flex flex-col items-center rounded-lg border border-surface-line bg-white px-3 py-2 shadow-sm">
        <button
          onClick={() => onOpen(p.id)}
          className="max-w-44 text-sm font-medium leading-tight hover:text-cg-orange"
        >
          {p.full_name}
          {p.data_quality_status === 'needs_review' && (
            <AlertTriangle className="ml-1 inline h-3 w-3 text-warning" />
          )}
        </button>
        <span className="max-w-44 text-[11px] leading-tight text-charcoal/50">
          {primary?.positions?.name ?? '—'}
          {primary?.locations?.name ? ` · ${primary.locations.name}` : ''}
        </span>
        {p.status === 'incoming' && (
          <span className="rounded-full bg-info/10 px-1.5 text-[10px] font-medium text-info">
            incoming
          </span>
        )}
        {hasChildren && (
          <span className="mt-1 flex items-center gap-1">
            <button
              onClick={() => onToggle(p.id, depth)}
              className="flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-charcoal/60 hover:bg-surface-line/60"
            >
              {collapsedHere ? (
                <ChevronRight className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {node.descendants}
            </button>
            <button
              onClick={() => onFocus(p.id)}
              title="Focus here — show only this team, hide everything above"
              aria-label={`Focus on ${p.full_name}'s team`}
              className="rounded p-0.5 text-charcoal/25 hover:text-cg-orange"
            >
              <Crosshair className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
      {hasChildren && !collapsedHere && (
        <ul>
          {node.children.map((c) => (
            <li key={c.person.id}>
              <ChartNode
                node={c}
                depth={depth + 1}
                isCollapsed={isCollapsed}
                onToggle={onToggle}
                onOpen={onOpen}
                onFocus={onFocus}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

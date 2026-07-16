// Per-site planned org (Phase 2, slice 3). A modal that renders an upcoming
// restaurant's planned leadership as the standard restaurant hierarchy: seats
// come from the position template (default_reports_to), each filled with the
// slated leader (succession incumbent) or shown as an OPEN gap. A slated leader
// who currently holds a seat elsewhere gets a "moving from <site>" flag — so the
// knock-on vacancy is visible. Read-only; planning is edited in the Bench.

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, X } from 'lucide-react'
import {
  fetchCurrentPrimaries,
  fetchPositionTemplate,
  type CurrentPrimary,
  type TemplatePosition,
  type UpcomingSeat,
} from './api'

const norm = (s: string) => s.trim().toLowerCase()

interface OrgNode {
  positionId: string
  name: string
  level: number
  slatedName: string | null
  movingFrom: string | null // current site, when the slated leader works elsewhere
  children: OrgNode[]
}

export function PlannedOrgPanel({
  siteName,
  seats,
  onClose,
}: {
  siteName: string
  seats: UpcomingSeat[]
  onClose: () => void
}) {
  const [template, setTemplate] = useState<TemplatePosition[] | null>(null)
  const [current, setCurrent] = useState<Map<string, CurrentPrimary>>(new Map())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPositionTemplate().then(setTemplate).catch((e: Error) => setError(e.message))
    const ids = seats
      .map((s) => s.incumbent_person_id)
      .filter((id): id is string => Boolean(id))
    fetchCurrentPrimaries(ids).then(setCurrent).catch((e: Error) => setError(e.message))
  }, [seats])

  // Build the planned-org tree: every planned seat plus its template ancestors
  // up to the root (so a slated Chef de Cuisine with no GM shows an OPEN GM
  // above it), wired by default_reports_to_position_id.
  const roots = useMemo<OrgNode[]>(() => {
    if (!template) return []
    const tById = new Map(template.map((p) => [p.id, p]))
    const seatByPos = new Map<string, UpcomingSeat>()
    for (const s of seats) if (s.position_id) seatByPos.set(s.position_id, s)

    const included = new Set<string>()
    // Seed the full restaurant management roster (manager + people-center
    // eligible) so every management seat shows, filled or OPEN. Corporate roles
    // (eligible=false) and line/emerging roles (Supervisor, Chef de Partie) are
    // excluded. Then pull in any actually-slated position + its ancestors, so a
    // slot on a non-roster role still appears.
    for (const p of template) {
      if (p.default_person_kind === 'manager' && p.people_center_eligible) included.add(p.id)
    }
    for (const s of seats) {
      let pid: string | null | undefined = s.position_id
      while (pid && !included.has(pid)) {
        included.add(pid)
        pid = tById.get(pid)?.default_reports_to_position_id
      }
    }

    const nodes = new Map<string, OrgNode>()
    for (const pid of included) {
      const tp = tById.get(pid)
      const seat = seatByPos.get(pid)
      const cur = seat?.incumbent_person_id ? current.get(seat.incumbent_person_id) : undefined
      const movingFrom =
        cur?.location_name && norm(cur.location_name) !== norm(siteName)
          ? cur.location_name
          : null
      nodes.set(pid, {
        positionId: pid,
        name: tp?.name ?? 'Role',
        level: tp?.level ?? Number.POSITIVE_INFINITY,
        slatedName: seat?.incumbent_name ?? null,
        movingFrom,
        children: [],
      })
    }

    const tops: OrgNode[] = []
    for (const pid of included) {
      const parent = tById.get(pid)?.default_reports_to_position_id
      if (parent && nodes.has(parent)) nodes.get(parent)!.children.push(nodes.get(pid)!)
      else tops.push(nodes.get(pid)!)
    }
    const sortRec = (n: OrgNode) => {
      n.children.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      n.children.forEach(sortRec)
    }
    tops.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    tops.forEach(sortRec)
    return tops
  }, [template, seats, current, siteName])

  const gaps = useMemo(() => countGaps(roots), [roots])

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-charcoal/30 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-surface-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-surface-line p-4">
          <div>
            <h3 className="font-semibold">{siteName} — planned org</h3>
            <p className="text-xs text-charcoal/55">
              Slated leadership from the Bench · {gaps} open seat{gaps === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-charcoal/40 hover:text-charcoal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : !template ? (
            <p className="text-sm text-charcoal/50">Loading…</p>
          ) : roots.length === 0 ? (
            <p className="text-sm text-charcoal/55">
              No seats planned yet. Add them in Bench &amp; Risk and they'll shape
              this restaurant's org here.
            </p>
          ) : (
            <ul className="space-y-1">
              {roots.map((n) => (
                <SeatRow key={n.positionId} node={n} depth={0} />
              ))}
            </ul>
          )}
          <p className="mt-4 border-t border-surface-line pt-3 text-[11px] text-charcoal/45">
            <span className="font-medium text-warning">Moving</span> = the slated
            leader currently holds a seat elsewhere, so filling this one opens a
            vacancy there. Edit the plan in Bench &amp; Risk.
          </p>
        </div>
      </div>
    </div>
  )
}

function countGaps(nodes: OrgNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.slatedName ? 0 : 1) + countGaps(n.children), 0)
}

function SeatRow({ node, depth }: { node: OrgNode; depth: number }) {
  return (
    <>
      <li
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md py-1 text-sm"
        style={{ paddingLeft: `${depth * 1.1}rem` }}
      >
        <span className="text-charcoal/55">{node.name}</span>
        <span className="text-charcoal/30">—</span>
        {node.slatedName ? (
          <span className="font-medium">{node.slatedName}</span>
        ) : (
          <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
            OPEN
          </span>
        )}
        {node.movingFrom && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
            <ArrowRight className="h-3 w-3" /> moving from {node.movingFrom}
          </span>
        )}
      </li>
      {node.children.map((c) => (
        <SeatRow key={c.positionId} node={c} depth={depth + 1} />
      ))}
    </>
  )
}

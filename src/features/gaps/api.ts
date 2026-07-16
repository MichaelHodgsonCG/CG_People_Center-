// Gap analysis (Phase 3): required "ideal restaurant" roster vs. who's actually
// there (open locations) or slated (opening locations). Required counts live in
// people_center_role_requirements (admin/executive editable, one base template
// for v1). Reads reuse position assignments (open sites) and succession slots
// (opening sites).

import { supabase } from '../../lib/supabase'
import { recordAudit, type Actor } from '../../lib/activity'

export interface RoleRequirement {
  position_id: string
  position_name: string
  level: number | null
  required_count: number
}

interface RawReq {
  position_id: string
  required_count: number
  positions: { name: string; level: number | null } | null
}

export async function fetchRoleRequirements(): Promise<RoleRequirement[]> {
  const { data, error } = await supabase
    .from('people_center_role_requirements')
    .select('position_id, required_count, positions:people_center_positions ( name, level )')
  if (error) throw error
  return ((data as unknown as RawReq[]) ?? [])
    .map((r) => ({
      position_id: r.position_id,
      required_count: r.required_count,
      position_name: r.positions?.name ?? '?',
      level: r.positions?.level ?? null,
    }))
    .sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity))
}

export async function setRoleRequirement(
  actor: Actor,
  positionId: string,
  positionName: string,
  count: number,
): Promise<void> {
  const { error } = await supabase.from('people_center_role_requirements').upsert(
    {
      position_id: positionId,
      required_count: count,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    },
    { onConflict: 'position_id' },
  )
  if (error) throw error
  await recordAudit(
    actor,
    'update',
    'role_requirement',
    positionId,
    positionName,
    `Required count for ${positionName} set to ${count}`,
  )
}

export interface MgmtPosition {
  id: string
  name: string
  level: number | null
}

/** The restaurant management roster (manager + eligible) — the roles the
 * requirements editor lets you set counts for. */
export async function fetchManagementPositions(): Promise<MgmtPosition[]> {
  const { data, error } = await supabase
    .from('people_center_positions')
    .select('id, name, level, default_person_kind, people_center_eligible')
  if (error) throw error
  type Row = {
    id: string
    name: string
    level: number | null
    default_person_kind: string
    people_center_eligible: boolean
  }
  return ((data as unknown as Row[]) ?? [])
    .filter((p) => p.default_person_kind === 'manager' && p.people_center_eligible)
    .map((p) => ({ id: p.id, name: p.name, level: p.level }))
    .sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity))
}

export interface GapLocation {
  id: string
  name: string
  status: string // 'open' (existing) | 'opening' (upcoming)
}

export async function fetchGapLocations(): Promise<GapLocation[]> {
  const { data, error } = await supabase
    .from('people_center_locations')
    .select('id, name, status')
    .in('status', ['open', 'opening'])
    .order('name')
  if (error) throw error
  return (data as unknown as GapLocation[]) ?? []
}

export interface Fill {
  count: number
  names: string[]
}

/** Who fills each role at a location. Open site → active people currently
 * assigned there; opening site → slated leaders (succession incumbents). Keyed
 * by position_id. */
export async function fetchFillForLocation(
  locationId: string,
  upcoming: boolean,
): Promise<Map<string, Fill>> {
  const map = new Map<string, Fill>()
  const add = (positionId: string | null, name: string | null) => {
    if (!positionId) return
    const f = map.get(positionId) ?? { count: 0, names: [] }
    f.count += 1
    if (name) f.names.push(name)
    map.set(positionId, f)
  }

  if (upcoming) {
    const { data, error } = await supabase
      .from('people_center_succession_slots')
      .select(
        `position_id,
         incumbent:people_center_people!people_center_succession_slots_incumbent_person_id_fkey ( full_name )`,
      )
      .eq('location_id', locationId)
    if (error) throw error
    type Row = { position_id: string | null; incumbent: { full_name: string } | null }
    for (const r of (data as unknown as Row[]) ?? []) {
      if (r.incumbent?.full_name) add(r.position_id, r.incumbent.full_name)
    }
    return map
  }

  const { data, error } = await supabase
    .from('people_center_position_assignments')
    .select(
      `position_id, ended_on,
       person:people_center_people ( full_name, status )`,
    )
    .eq('location_id', locationId)
    .is('ended_on', null)
  if (error) throw error
  type Row = {
    position_id: string | null
    person: { full_name: string; status: string } | null
  }
  for (const r of (data as unknown as Row[]) ?? []) {
    // Employed people only (active or on leave) count as filling a seat.
    if (r.person && (r.person.status === 'active' || r.person.status === 'leave')) {
      add(r.position_id, r.person.full_name)
    }
  }
  return map
}

// Upcoming-locations planning data (Phase 2). We do NOT store a separate plan:
// the upcoming restaurants already exist in people_center_locations
// (status='opening') and the Bench/succession model already plots slated
// leaders into them. This reads those succession seats (so the Upcoming view can
// REFLECT the plan read-only), the position template (to shape the planned org),
// and the slated people's CURRENT seats (to flag knock-on moves). Editing stays
// in the Bench. Succession rows are admin/executive-only (RLS).

import { supabase } from '../../lib/supabase'

export interface UpcomingSeat {
  id: string
  location_name: string | null
  position_id: string | null
  position_name: string | null
  position_level: number | null
  incumbent_person_id: string | null
  incumbent_name: string | null
}

interface RawSeat {
  id: string
  position_id: string | null
  incumbent_person_id: string | null
  positions: { name: string; level: number | null } | null
  locations: { name: string; status: string | null } | null
  incumbent: { full_name: string } | null
}

/** Succession seats at locations that are still opening (the upcoming sites).
 * Same table + embeds the Bench uses, filtered to status='opening'. */
export async function fetchUpcomingSeats(): Promise<UpcomingSeat[]> {
  const { data, error } = await supabase
    .from('people_center_succession_slots')
    .select(
      `id, position_id, location_id, incumbent_person_id,
       positions:people_center_positions ( name, level ),
       locations:people_center_locations ( name, status ),
       incumbent:people_center_people!people_center_succession_slots_incumbent_person_id_fkey ( full_name )`,
    )
  if (error) throw error
  return ((data as unknown as RawSeat[]) ?? [])
    .filter((r) => r.locations?.status === 'opening')
    .map((r) => ({
      id: r.id,
      location_name: r.locations?.name ?? null,
      position_id: r.position_id,
      position_name: r.positions?.name ?? null,
      position_level: r.positions?.level ?? null,
      incumbent_person_id: r.incumbent_person_id,
      incumbent_name: r.incumbent?.full_name ?? null,
    }))
}

export interface TemplatePosition {
  id: string
  name: string
  level: number | null
  default_reports_to_position_id: string | null
}

/** The position ranking + reporting template (1b): shapes the planned-org tree. */
export async function fetchPositionTemplate(): Promise<TemplatePosition[]> {
  const { data, error } = await supabase
    .from('people_center_positions')
    .select('id, name, level, default_reports_to_position_id')
  if (error) throw error
  return (data as unknown as TemplatePosition[]) ?? []
}

export interface CurrentPrimary {
  location_name: string | null
  position_name: string | null
}

/** Each person's current open primary seat — used to flag "moving from <site>"
 * (the knock-on vacancy) when a slated leader already holds a role elsewhere. */
export async function fetchCurrentPrimaries(
  personIds: string[],
): Promise<Map<string, CurrentPrimary>> {
  const map = new Map<string, CurrentPrimary>()
  if (personIds.length === 0) return map
  const { data, error } = await supabase
    .from('people_center_position_assignments')
    .select(
      `person_id, is_primary, ended_on,
       positions:people_center_positions ( name ),
       locations:people_center_locations ( name )`,
    )
    .in('person_id', personIds)
    .is('ended_on', null)
  if (error) throw error
  type Row = {
    person_id: string
    is_primary: boolean
    positions: { name: string } | null
    locations: { name: string } | null
  }
  for (const r of (data as unknown as Row[]) ?? []) {
    // Prefer the primary assignment; otherwise keep the first open one.
    if (!map.has(r.person_id) || r.is_primary) {
      map.set(r.person_id, {
        location_name: r.locations?.name ?? null,
        position_name: r.positions?.name ?? null,
      })
    }
  }
  return map
}

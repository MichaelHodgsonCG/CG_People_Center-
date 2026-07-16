// Slated-incumbent (planned placement) data access for upcoming restaurants
// (Phase 2, slice 2). Rows live in people_center_opening_placements, keyed to a
// New Restaurant Center opening_site. RLS restricts all of this to
// admin/executive, so the whole planning section is gated to those roles.

import { supabase } from '../../lib/supabase'
import { recordAudit, type Actor } from '../../lib/activity'

export interface OpeningPlacement {
  id: string
  opening_site_id: string
  position_id: string
  person_id: string | null
  note: string | null
  position: { name: string; level: number | null } | null
  person: { full_name: string } | null
}

export async function fetchOpeningPlacements(): Promise<OpeningPlacement[]> {
  const { data, error } = await supabase
    .from('people_center_opening_placements')
    .select(
      `id, opening_site_id, position_id, person_id, note,
       position:people_center_positions ( name, level ),
       person:people_center_people ( full_name )`,
    )
  if (error) throw error
  return (data as unknown as OpeningPlacement[]) ?? []
}

/** Slate a person (or a gap, personId null) into a role at an upcoming site. */
export async function addOpeningPlacement(
  actor: Actor,
  siteId: string,
  siteName: string,
  positionId: string,
  positionName: string,
  personId: string | null,
  personName: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_opening_placements')
    .insert({
      opening_site_id: siteId,
      position_id: positionId,
      person_id: personId,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .select('id')
  if (error) throw error
  await recordAudit(
    actor,
    'create',
    'opening_placement',
    (data?.[0]?.id as string) ?? null,
    siteName,
    `Slated ${personName ?? 'TBD'} → ${positionName} at ${siteName}`,
  )
}

export async function removeOpeningPlacement(
  actor: Actor,
  id: string,
  label: string,
): Promise<void> {
  const { error } = await supabase
    .from('people_center_opening_placements')
    .delete()
    .eq('id', id)
  if (error) throw error
  await recordAudit(actor, 'delete', 'opening_placement', id, label, `Removed slated placement: ${label}`)
}

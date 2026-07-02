// Loads the vocabulary mapping tables for a source system. This is the only
// read the pipeline needs from the database before classification; the
// Supabase client is injected so the pipeline core stays pure.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LocationMappingEntry, MappingTables, PositionMappingEntry } from './types'

export async function loadMappings(
  supabase: SupabaseClient,
  sourceSystem: string,
): Promise<MappingTables> {
  const [positionsRes, locationsRes] = await Promise.all([
    supabase
      .from('position_mappings')
      .select(
        'source_value, positions ( id, name, people_center_eligible, default_person_kind )',
      )
      .eq('source_system', sourceSystem),
    supabase
      .from('location_mappings')
      .select('source_value, locations ( id, name )')
      .eq('source_system', sourceSystem),
  ])
  if (positionsRes.error) throw positionsRes.error
  if (locationsRes.error) throw locationsRes.error

  const positions = new Map<string, PositionMappingEntry>()
  for (const row of positionsRes.data ?? []) {
    const p = row.positions as unknown as {
      id: string
      name: string
      people_center_eligible: boolean
      default_person_kind: PositionMappingEntry['defaultPersonKind']
    } | null
    if (!p) continue
    positions.set(row.source_value, {
      positionId: p.id,
      positionName: p.name,
      eligible: p.people_center_eligible,
      defaultPersonKind: p.default_person_kind,
    })
  }

  const locations = new Map<string, LocationMappingEntry>()
  for (const row of locationsRes.data ?? []) {
    const l = row.locations as unknown as { id: string; name: string } | null
    if (!l) continue
    locations.set(row.source_value, {
      locationId: l.id,
      locationName: l.name,
    })
  }

  return { positions, locations }
}

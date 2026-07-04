// Bench & Risk + succession data access. Everything here is executive/admin
// surface — RLS enforces it; the permissions module mirrors it. Succession
// changes emit NO person-linked events (standing must not appear on
// timelines visible below the executive altitude); slot events carry a null
// person and pointers only.

import { supabase } from '../../lib/supabase'
import { recordAudit, recordEvent, type Actor } from '../../lib/activity'

export interface SuccessionCandidate {
  id: string
  slot_id: string
  person_id: string
  rank: number
  notes: string | null
  people: { full_name: string } | null
}

export interface SuccessionSlot {
  id: string
  position_id: string
  location_id: string | null
  region_id: string | null
  incumbent_person_id: string | null
  notes: string | null
  positions: { name: string } | null
  locations: { name: string } | null
  regions: { name: string } | null
  incumbent: { full_name: string } | null
  candidates: SuccessionCandidate[]
}

export async function fetchSlots(): Promise<SuccessionSlot[]> {
  const { data, error } = await supabase
    .from('people_center_succession_slots')
    .select(
      `id, position_id, location_id, region_id, incumbent_person_id, notes,
       positions:people_center_positions ( name ),
       locations:people_center_locations ( name ),
       regions:people_center_regions ( name ),
       incumbent:people_center_people!people_center_succession_slots_incumbent_person_id_fkey ( full_name ),
       candidates:people_center_succession_candidates ( id, slot_id, person_id, rank, notes,
         people:people_center_people ( full_name ) )`,
    )
    .order('created_at')
  if (error) throw error
  const slots = (data as unknown as SuccessionSlot[]) ?? []
  for (const s of slots) s.candidates.sort((a, b) => a.rank - b.rank)
  return slots
}

export async function createSlot(
  actor: Actor,
  positionId: string,
  locationId: string | null,
  regionId: string | null,
  incumbentPersonId: string | null,
  label: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_succession_slots')
    .insert({
      position_id: positionId,
      location_id: locationId,
      region_id: regionId,
      incumbent_person_id: incumbentPersonId,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .select('id')
    .single()
  if (error) throw error
  await recordAudit(actor, 'create', 'succession_slot', data.id as string, label, 'Created succession slot')
  await recordEvent(actor, 'succession.slot_created', null, 'succession_slot', data.id as string, { seat: label })
}

export async function addCandidate(
  actor: Actor,
  slotId: string,
  personId: string,
  rank: number,
  slotLabel: string,
): Promise<void> {
  const { error } = await supabase.from('people_center_succession_candidates').insert({
    slot_id: slotId,
    person_id: personId,
    rank,
    updated_by: actor.personId,
    updated_by_name: actor.name,
  })
  if (error) throw error
  // Audit yes; person-linked event NO (see header).
  await recordAudit(actor, 'create', 'succession_candidate', slotId, slotLabel, `Added candidate at rank ${rank}`)
}

export async function removeCandidate(actor: Actor, candidateId: string, slotLabel: string): Promise<void> {
  const { error } = await supabase
    .from('people_center_succession_candidates')
    .delete()
    .eq('id', candidateId)
  if (error) throw error
  await recordAudit(actor, 'delete', 'succession_candidate', candidateId, slotLabel, 'Removed candidate')
}

export async function deleteSlot(actor: Actor, slotId: string, label: string): Promise<void> {
  const { error } = await supabase
    .from('people_center_succession_slots')
    .delete()
    .eq('id', slotId)
  if (error) throw error
  await recordAudit(actor, 'delete', 'succession_slot', slotId, label, 'Deleted succession slot')
}

/** Set (or clear) a seat's incumbent — how upcoming locations record their
 * already-hired GM/Chef before Push assigns them there: the coverage grid
 * shows the incumbent as "(incoming)" until a real assignment exists. */
export async function setSlotIncumbent(
  actor: Actor,
  slotId: string,
  personId: string | null,
  label: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_succession_slots')
    .update({
      incumbent_person_id: personId,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .eq('id', slotId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The database did not accept this change (permissions).')
  }
  await recordAudit(
    actor,
    'update',
    'succession_slot',
    slotId,
    label,
    personId ? 'Set seat incumbent' : 'Cleared seat incumbent',
  )
}

// --- Bench signals (computed live; degrade gracefully pre-Phase 3) --------

export interface PositionColumn {
  id: string
  name: string
  department: string
  isKey: boolean
}

export interface CoverageGrid {
  locations: { id: string; name: string }[]
  /** People Center–eligible positions, i.e. the full FT management pipeline */
  positions: PositionColumn[]
  /** `${locationId}|${positionName}` → names of current holders */
  occupants: Record<string, string[]>
  /** locationId → open leadership assignments (any position) */
  leaders: Record<string, number>
}

export async function fetchCoverageGrid(): Promise<CoverageGrid> {
  const [locs, poss, assignments] = await Promise.all([
    supabase.from('people_center_locations').select('id, name').order('name'),
    supabase
      .from('people_center_positions')
      .select(
        'id, name, is_key_position, people_center_eligible, departments:people_center_departments ( name )',
      )
      .eq('people_center_eligible', true)
      .order('name'),
    supabase
      .from('people_center_position_assignments')
      .select(
        `location_id,
         positions:people_center_positions ( name ),
         people:people_center_people ( full_name, status )`,
      )
      .is('ended_on', null),
  ])
  if (locs.error) throw locs.error
  if (poss.error) throw poss.error
  if (assignments.error) throw assignments.error

  const occupants: Record<string, string[]> = {}
  const leaders: Record<string, number> = {}
  for (const a of (assignments.data ?? []) as unknown as {
    location_id: string
    positions: { name: string } | null
    people: { full_name: string; status: string } | null
  }[]) {
    if (!a.location_id || !a.people || a.people.status === 'departed') continue
    leaders[a.location_id] = (leaders[a.location_id] ?? 0) + 1
    if (!a.positions?.name) continue
    const key = `${a.location_id}|${a.positions.name}`
    const names = occupants[key] ?? []
    const display =
      a.people.status === 'incoming'
        ? `${a.people.full_name} (incoming)`
        : a.people.full_name
    if (!names.includes(display)) names.push(display)
    occupants[key] = names
  }

  return {
    locations: (locs.data ?? []) as { id: string; name: string }[],
    positions: ((poss.data ?? []) as unknown as {
      id: string
      name: string
      is_key_position: boolean
      departments: { name: string } | null
    }[]).map((p) => ({
      id: p.id,
      name: p.name,
      department: p.departments?.name ?? 'Management',
      isKey: p.is_key_position,
    })),
    occupants,
    leaders,
  }
}

export interface ConversationStaleness {
  total: number
  never: number
  stale90: number
}

/** "No development conversation in 90 days" — computed from the latest
 * leadership/development note per active person, at the caller's read level
 * (executives see all of it). */
export async function fetchConversationStaleness(): Promise<ConversationStaleness> {
  const [people, notes] = await Promise.all([
    supabase.from('people_center_people').select('id').eq('status', 'active'),
    supabase
      .from('people_center_notes')
      .select('person_id, noted_on')
      .in('category', ['leadership', 'development']),
  ])
  if (people.error) throw people.error
  if (notes.error) throw notes.error
  const latest = new Map<string, string>()
  for (const n of (notes.data ?? []) as { person_id: string; noted_on: string }[]) {
    const cur = latest.get(n.person_id)
    if (!cur || n.noted_on > cur) latest.set(n.person_id, n.noted_on)
  }
  const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  let never = 0
  let stale90 = 0
  const ids = ((people.data ?? []) as { id: string }[]).map((p) => p.id)
  for (const id of ids) {
    const last = latest.get(id)
    if (!last) never += 1
    else if (last < cutoff) stale90 += 1
  }
  return { total: ids.length, never, stale90 }
}

export interface PeopleStats {
  active: number
  needsReview: number
}

export async function fetchPeopleStats(): Promise<PeopleStats> {
  const { data, error } = await supabase
    .from('people_center_people')
    .select('status, data_quality_status')
  if (error) throw error
  const rows = (data ?? []) as { status: string; data_quality_status: string }[]
  return {
    active: rows.filter((r) => r.status === 'active').length,
    needsReview: rows.filter((r) => r.data_quality_status === 'needs_review').length,
  }
}

export interface PersonOption {
  id: string
  full_name: string
}

export async function fetchPeopleOptions(): Promise<PersonOption[]> {
  // Incoming hires included: they can hold a seat (incumbent) or sit on a
  // bench before their start date.
  const { data, error } = await supabase
    .from('people_center_people')
    .select('id, full_name')
    .in('status', ['active', 'incoming'])
    .order('full_name')
  if (error) throw error
  return (data as PersonOption[]) ?? []
}

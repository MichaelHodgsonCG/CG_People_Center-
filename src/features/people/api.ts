// Person detail + notes data access. Reads rely on RLS; the two sensitive
// note reads go through the AUDITED definer functions (D8) — calling them IS
// the audit event, so the panel calls them only for roles the database will
// actually serve (the permissions module mirrors that truth table).

import { supabase } from '../../lib/supabase'
import { recordAudit, recordEvent, type Actor } from '../../lib/activity'
import type { Note, NoteCategory, NoteVisibility } from '../../types'

export interface PersonAssignment {
  id: string
  is_primary: boolean
  started_on: string | null
  ended_on: string | null
  position_id: string
  location_id: string
  positions: { name: string } | null
  locations: { name: string } | null
}

export interface PersonDetail {
  id: string
  full_name: string
  preferred_name: string | null
  email: string | null
  phone: string | null
  status: 'active' | 'leave' | 'departed'
  person_kind: 'manager' | 'emerging_leader' | 'key_team_member'
  hire_date: string | null
  manager_person_id: string | null
  mentor_person_id: string | null
  home_city: string | null
  relocation_interest: 'open' | 'preferred' | 'not_open' | 'unknown'
  career_goals: string | null
  strengths: string | null
  risks: string | null
  data_quality_status: 'ok' | 'needs_review'
  data_quality_note: string | null
  departed_on: string | null
  position_assignments: PersonAssignment[]
}

export async function fetchPersonDetail(personId: string): Promise<PersonDetail> {
  const { data, error } = await supabase
    .from('people_center_people')
    .select(
      `id, full_name, preferred_name, email, phone, status, person_kind,
       hire_date, manager_person_id, mentor_person_id, home_city,
       relocation_interest, career_goals, strengths, risks,
       data_quality_status, data_quality_note, departed_on,
       position_assignments:people_center_position_assignments (
         id, is_primary, started_on, ended_on, position_id, location_id,
         positions:people_center_positions ( name ),
         locations:people_center_locations ( name ) )`,
    )
    .eq('id', personId)
    .single()
  if (error) throw error
  return data as unknown as PersonDetail
}

export async function fetchPersonName(personId: string): Promise<string | null> {
  const { data } = await supabase
    .from('people_center_people')
    .select('full_name')
    .eq('id', personId)
    .maybeSingle()
  return (data?.full_name as string | undefined) ?? null
}

/** Direct SELECT — RLS returns leadership/development at the caller's level
 * plus anything they authored. Relationship/restricted never appear here. */
export async function fetchNotes(personId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('people_center_notes')
    .select('*')
    .eq('person_id', personId)
    .order('noted_on', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as Note[]) ?? []
}

/** AUDITED read — one audit_log 'view' row per call (D8). */
export async function fetchRelationshipNotes(personId: string): Promise<Note[]> {
  const { data, error } = await supabase.rpc('people_center_get_relationship_notes', {
    p_person_id: personId,
  })
  if (error) throw error
  return (data as Note[]) ?? []
}

/** AUDITED read — one audit_log 'view' row per call (D8). */
export async function fetchRestrictedNotes(personId: string): Promise<Note[]> {
  const { data, error } = await supabase.rpc('people_center_get_restricted_notes', {
    p_person_id: personId,
  })
  if (error) throw error
  return (data as Note[]) ?? []
}

export interface TimelineEvent {
  id: string
  event_type: string
  entity_type: string | null
  context: Record<string, unknown>
  created_at: string
}

/** Per-person leadership timeline — a projection of people_center_events
 * (pointers only). RLS scopes it to admins/executives and strict ancestors;
 * others simply receive an empty stream. */
export async function fetchTimeline(personId: string): Promise<TimelineEvent[]> {
  const { data, error } = await supabase
    .from('people_center_events')
    .select('id, event_type, entity_type, context, created_at')
    .eq('person_id', personId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return (data as TimelineEvent[]) ?? []
}

export interface NewNote {
  personId: string
  personName: string
  category: NoteCategory
  visibility: NoteVisibility
  body: string
  voluntarilyShared: boolean
}

export async function addNote(actor: Actor, note: NewNote): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_notes')
    .insert({
      person_id: note.personId,
      author_person_id: actor.personId,
      author_auth_uid: actor.authUid,
      author_name: actor.name,
      category: note.category,
      visibility: note.visibility,
      body: note.body,
      voluntarily_shared: note.voluntarilyShared,
    })
    .select('id')
    .single()
  if (error) throw error

  await recordAudit(
    actor,
    'create',
    'note',
    data.id as string,
    note.personName,
    `Added ${note.category} note (${note.visibility})`,
  )
  // Domain event: pointers only, and NEVER for relationship or restricted
  // material (ADR 0003 / C3).
  if (note.category !== 'relationship' && note.visibility !== 'restricted') {
    await recordEvent(actor, 'note.added', note.personId, 'note', data.id as string, {
      category: note.category,
    })
  }
}

export interface ProfileEdits {
  preferred_name: string | null
  email: string | null
  phone: string | null
  status: PersonDetail['status']
  person_kind: PersonDetail['person_kind']
  home_city: string | null
  relocation_interest: PersonDetail['relocation_interest']
  career_goals: string | null
  strengths: string | null
  risks: string | null
}

export async function updatePersonProfile(
  actor: Actor,
  personId: string,
  personName: string,
  edits: ProfileEdits,
): Promise<void> {
  const { error } = await supabase
    .from('people_center_people')
    .update({ ...edits, updated_by: actor.personId, updated_by_name: actor.name })
    .eq('id', personId)
  if (error) throw error
  await recordAudit(actor, 'update', 'person', personId, personName, 'Updated profile')
}

export async function clearReviewFlag(
  actor: Actor,
  personId: string,
  personName: string,
): Promise<void> {
  const { error } = await supabase
    .from('people_center_people')
    .update({
      data_quality_status: 'ok',
      data_quality_note: null,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .eq('id', personId)
  if (error) throw error
  await recordAudit(
    actor,
    'update',
    'person',
    personId,
    personName,
    'Cleared data-quality review flag',
  )
}

/** Subject-request purge of relationship notes (retention policy §5).
 * Admin-only, enforced and audited inside the database function. */
export async function purgeRelationshipNotes(personId: string): Promise<number> {
  const { data, error } = await supabase.rpc('people_center_purge_relationship_notes', {
    p_person_id: personId,
  })
  if (error) throw error
  return (data as number) ?? 0
}

export interface ReferenceOption {
  id: string
  name: string
}

export async function fetchReferenceOptions(): Promise<{
  positions: ReferenceOption[]
  locations: ReferenceOption[]
}> {
  const [pos, loc] = await Promise.all([
    supabase.from('people_center_positions').select('id, name').order('name'),
    supabase.from('people_center_locations').select('id, name').order('name'),
  ])
  if (pos.error) throw pos.error
  if (loc.error) throw loc.error
  return {
    positions: (pos.data as ReferenceOption[]) ?? [],
    locations: (loc.data as ReferenceOption[]) ?? [],
  }
}

/** End the current primary assignment (history preserved) and set a new one. */
export async function reassignPrimary(
  actor: Actor,
  person: PersonDetail,
  positionId: string,
  locationId: string,
  positionName: string,
  locationName: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const currentPrimary = person.position_assignments.find(
    (a) => a.is_primary && !a.ended_on,
  )
  if (currentPrimary) {
    const { error } = await supabase
      .from('people_center_position_assignments')
      .update({ ended_on: today, updated_by_name: actor.name })
      .eq('id', currentPrimary.id)
    if (error) throw error
  }
  const { data, error } = await supabase
    .from('people_center_position_assignments')
    .insert({
      person_id: person.id,
      position_id: positionId,
      location_id: locationId,
      is_primary: true,
      started_on: today,
      updated_by_name: actor.name,
    })
    .select('id')
    .single()
  if (error) throw error

  await recordAudit(
    actor,
    'update',
    'position_assignment',
    data.id as string,
    person.full_name,
    `Primary assignment set to ${positionName} at ${locationName}`,
  )
  // Position change is a business-meaningful moment (ADR 0003).
  await recordEvent(actor, 'position.changed', person.id, 'position_assignment', data.id as string, {
    position: positionName,
    location: locationName,
  })
}

// Person detail + notes data access. Reads rely on RLS; the two sensitive
// note reads go through the AUDITED definer functions (D8) — for privileged
// (HQ) callers, calling them IS the audit event. Non-privileged callers get
// only the rows they authored themselves, with no audit row written, so the
// panel may call them for any role.

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
  status: 'active' | 'leave' | 'departed' | 'incoming' | 'candidate'
  person_kind: 'manager' | 'emerging_leader' | 'key_team_member'
  off_roster: boolean
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
       off_roster, hire_date, manager_person_id, mentor_person_id, home_city,
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
  off_roster: boolean
  home_city: string | null
  relocation_interest: PersonDetail['relocation_interest']
  career_goals: string | null
  strengths: string | null
  risks: string | null
}

/** RLS silently filters an UPDATE to zero rows when the caller's role lacks
 * the policy — PostgREST reports success either way. Every people write
 * checks the affected count so a blocked save FAILS LOUDLY instead of
 * pretending (the lesson from the vanishing-note bug, applied to writes). */
const PERMISSION_HINT =
  'The database did not accept this save — your role does not have ' +
  'people-edit permission there. Admins: check that migration ' +
  '20260704160000_executives_edit_people.sql has been applied.'

export async function updatePersonProfile(
  actor: Actor,
  personId: string,
  personName: string,
  edits: ProfileEdits,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_people')
    .update({ ...edits, updated_by: actor.personId, updated_by_name: actor.name })
    .eq('id', personId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error(PERMISSION_HINT)
  await recordAudit(actor, 'update', 'person', personId, personName, 'Updated profile')
}

export async function clearReviewFlag(
  actor: Actor,
  personId: string,
  personName: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_people')
    .update({
      data_quality_status: 'ok',
      data_quality_note: null,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .eq('id', personId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error(PERMISSION_HINT)
  await recordAudit(
    actor,
    'update',
    'person',
    personId,
    personName,
    'Cleared data-quality review flag',
  )
}

/** A person added by hand (ADR 0011): the HQ team (status 'active',
 * off_roster), a candidate not yet hired ('candidate'), or a signed-but-not-
 * started hire ('incoming'). Position/location are optional — an HQ role or a
 * candidate may have neither yet, and no assignment is created when either is
 * missing. A later Push sync matches by name: an 'incoming' record is
 * activated automatically; 'candidate'/off-roster records surface as an
 * admin-confirmed "possible match" so their manual data is preserved. */
export interface NewPerson {
  fullName: string
  email: string | null
  status: 'active' | 'incoming' | 'candidate'
  offRoster: boolean
  personKind: PersonDetail['person_kind']
  positionId: string | null
  positionName: string | null
  locationId: string | null
  locationName: string | null
  startDate: string | null // hire_date + the future-dated assignment start (incoming)
  managerPersonId: string | null
  homeCity?: string | null
}

function describeAdd(p: NewPerson): string {
  const label =
    p.status === 'incoming'
      ? 'Added incoming hire'
      : p.status === 'candidate'
        ? 'Added candidate'
        : p.offRoster
          ? 'Added HQ / off-roster person'
          : 'Added person'
  const where =
    p.positionName && p.locationName
      ? ` — ${p.positionName} at ${p.locationName}`
      : p.positionName
        ? ` — ${p.positionName}`
        : ''
  const starts = p.status === 'incoming' && p.startDate ? `, starts ${p.startDate}` : ''
  return `${label}${where}${starts}`
}

export async function addPerson(actor: Actor, p: NewPerson): Promise<string> {
  const { data, error } = await supabase
    .from('people_center_people')
    .insert({
      full_name: p.fullName,
      email: p.email,
      status: p.status,
      off_roster: p.offRoster,
      person_kind: p.personKind,
      // hire_date marks the roster only for a signed hire; a candidate has no
      // start date, HQ people predate the system.
      hire_date: p.status === 'incoming' ? p.startDate : null,
      manager_person_id: p.managerPersonId,
      home_city: p.homeCity ?? null,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '42501') throw new Error(PERMISSION_HINT)
    throw error
  }
  const personId = data.id as string

  if (p.positionId && p.locationId) {
    const { error: paErr } = await supabase
      .from('people_center_position_assignments')
      .insert({
        person_id: personId,
        position_id: p.positionId,
        location_id: p.locationId,
        is_primary: true,
        // an incoming hire's assignment is future-dated to their start; other
        // manual assignments have no known start (null).
        started_on: p.status === 'incoming' ? p.startDate : null,
        updated_by_name: actor.name,
      })
    if (paErr) throw paErr
  }

  await recordAudit(actor, 'create', 'person', personId, p.fullName, describeAdd(p))
  return personId
}

export interface IncomingHire {
  fullName: string
  email: string | null
  positionId: string
  positionName: string
  locationId: string
  locationName: string
  startDate: string // ISO date — stored as hire_date, marks the roster
  personKind: PersonDetail['person_kind']
  managerPersonId: string | null
}

/** Record a signed-but-not-started hire (migration 20260707090000). Thin
 * wrapper over addPerson for the common case; kept for call-site clarity. */
export async function addIncomingHire(actor: Actor, hire: IncomingHire): Promise<string> {
  return addPerson(actor, {
    fullName: hire.fullName,
    email: hire.email,
    status: 'incoming',
    offRoster: false,
    personKind: hire.personKind,
    positionId: hire.positionId,
    positionName: hire.positionName,
    locationId: hire.locationId,
    locationName: hire.locationName,
    startDate: hire.startDate,
    managerPersonId: hire.managerPersonId,
  })
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
    // Only positions People Center curates for its pickers (ADR 0012) — the
    // full CGOPS catalog (Server, Dishwasher, …) stays hidden.
    supabase
      .from('people_center_positions')
      .select('id, name')
      .eq('show_in_people_center', true)
      .order('name'),
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
    // Must fail loudly: if RLS filters this to zero rows, the insert below
    // would collide with the still-open primary (one-current-primary index)
    // and surface as a confusing duplicate-key error.
    const { data: ended, error } = await supabase
      .from('people_center_position_assignments')
      .update({ ended_on: today, updated_by_name: actor.name })
      .eq('id', currentPrimary.id)
      .select('id')
    if (error) throw error
    if (!ended || ended.length === 0) {
      throw new Error(
        'Could not end the current assignment — your role does not have ' +
          'assignment-edit permission in the database. Admins: check that ' +
          'migration 20260704160000_executives_edit_people.sql has been applied.',
      )
    }
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
  if (error) {
    if (error.code === '23505') {
      throw new Error(
        'This person already has a current primary assignment that could not ' +
          'be replaced. Open their panel again (the list may be stale) and ' +
          'retry; if it persists, an admin should end the extra open ' +
          'assignment.',
      )
    }
    throw error
  }

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

/** A person who can be picked as someone's manager: the reporting-line editor's
 * options. `manager_person_id` is returned so the caller can prune the subject's
 * own descendants and prevent a reporting cycle. */
export interface ManagerCandidate {
  id: string
  full_name: string
  manager_person_id: string | null
  /** "Name — Position · Location", for disambiguating people with similar names. */
  label: string
}

interface RawCandidate {
  id: string
  full_name: string
  manager_person_id: string | null
  position_assignments: {
    is_primary: boolean
    ended_on: string | null
    positions: { name: string } | null
    locations: { name: string } | null
  }[]
}

function candidateLabel(c: RawCandidate): string {
  const open = c.position_assignments.filter((a) => !a.ended_on)
  const primary = open.find((a) => a.is_primary) ?? open[0]
  const pos = primary?.positions?.name
  const loc = primary?.locations?.name
  const suffix = [pos, loc].filter(Boolean).join(' · ')
  return suffix ? `${c.full_name} — ${suffix}` : c.full_name
}

/** Everyone eligible to be a manager: active org members (same filter as the
 * org chart — departed and candidates excluded). */
export async function fetchManagerCandidates(): Promise<ManagerCandidate[]> {
  const { data, error } = await supabase
    .from('people_center_people')
    .select(
      `id, full_name, manager_person_id,
       position_assignments:people_center_position_assignments ( is_primary, ended_on,
         positions:people_center_positions ( name ),
         locations:people_center_locations ( name ) )`,
    )
    .not('status', 'in', '(departed,candidate)')
    .order('full_name')
  if (error) throw error
  return ((data as unknown as RawCandidate[]) ?? []).map((c) => ({
    id: c.id,
    full_name: c.full_name,
    manager_person_id: c.manager_person_id,
    label: candidateLabel(c),
  }))
}

/** Set (or clear, when managerId is null) a person's reporting line. Fails loud
 * if RLS filters the UPDATE to zero rows, and records the change on the
 * timeline — reporting-structure edits are business-meaningful moments. */
export async function setManager(
  actor: Actor,
  personId: string,
  personName: string,
  managerId: string | null,
  managerName: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_people')
    .update({
      manager_person_id: managerId,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .eq('id', personId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error(PERMISSION_HINT)
  const summary = managerId
    ? `Reporting line set to ${managerName ?? 'another manager'}`
    : 'Reporting line cleared (top of chart)'
  await recordAudit(actor, 'update', 'person', personId, personName, summary)
  await recordEvent(actor, 'reporting_line.changed', personId, 'person', personId, {
    manager_person_id: managerId,
    manager_name: managerName,
  })
}

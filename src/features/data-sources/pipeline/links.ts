// Admin-confirmed linking of Push rows to manually-added profiles (ADR 0011).
//
// When a roster sync finds a name that matches a hand-entered person who is
// not yet on the roster, it records a 'possible_match' import row instead of
// creating a duplicate. An admin then resolves each one from Data Sources:
//
//   * CONFIRM  — it is the same person. We stamp the correlation key
//     (external_refs.push_source_key) so every future sync recognises them,
//     fill in a primary assignment only if they had none, and NEVER overwrite
//     anything leadership already entered. The import row becomes 'duplicate'
//     (linked, unchanged).
//   * REJECT   — it is a different person. We import the Push row as a new
//     record, exactly as the sync would have. The import row becomes
//     'imported' / 'imported_for_review'.
//
// Everything here is admin-only in practice: import_rows carries legal names
// and is admin-only under RLS.

import { supabase } from '../../../lib/supabase'
import { recordAudit, recordEvent, type Actor } from '../../../lib/activity'
import { loadMappings } from './mappingLoader'
import { classify } from './classify'
import type { NormalizedRow } from './types'

const SOURCE = 'push_roster'

export interface PendingLink {
  importRowId: string
  batchId: string
  sourceKey: string
  displayName: string
  companyName: string | null
  primaryPosition: string | null
  reviewNote: string | null
  suggestedPersonId: string | null
  suggestedPersonName: string | null
  createdAt: string
}

interface RawRowRecord {
  id: string
  batch_id: string
  source_key: string
  raw: NormalizedRow
  review_note: string | null
  suggested_person_id: string | null
  person_id: string | null
  created_at: string
}

/** Unresolved possible matches, newest first, one per source person. A match
 * is resolved once ANY import row for its source_key has produced/linked a
 * person (person_id set) — confirm/reject both do that in place. */
export async function fetchPendingLinks(): Promise<PendingLink[]> {
  const { data: pending, error } = await supabase
    .from('people_center_import_rows')
    .select(
      'id, batch_id, source_key, raw, review_note, suggested_person_id, created_at',
    )
    .eq('disposition', 'possible_match')
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (pending ?? []) as Omit<RawRowRecord, 'person_id'>[]
  if (rows.length === 0) return []

  // Drop source_keys already linked/imported elsewhere (a sibling row from an
  // earlier sync that an admin already resolved).
  const keys = [...new Set(rows.map((r) => r.source_key))]
  const { data: resolved, error: resErr } = await supabase
    .from('people_center_import_rows')
    .select('source_key')
    .in('source_key', keys)
    .not('person_id', 'is', null)
  if (resErr) throw resErr
  const resolvedKeys = new Set((resolved ?? []).map((r) => r.source_key as string))

  // Names for the suggested people.
  const suggestedIds = [
    ...new Set(rows.map((r) => r.suggested_person_id).filter(Boolean) as string[]),
  ]
  const names = new Map<string, string>()
  if (suggestedIds.length > 0) {
    const { data: people, error: pErr } = await supabase
      .from('people_center_people')
      .select('id, full_name')
      .in('id', suggestedIds)
    if (pErr) throw pErr
    for (const p of people ?? []) names.set(p.id as string, p.full_name as string)
  }

  const seen = new Set<string>()
  const out: PendingLink[] = []
  for (const r of rows) {
    if (resolvedKeys.has(r.source_key) || seen.has(r.source_key)) continue
    seen.add(r.source_key)
    out.push({
      importRowId: r.id,
      batchId: r.batch_id,
      sourceKey: r.source_key,
      displayName: r.raw?.displayName ?? '(unknown)',
      companyName: r.raw?.companyName ?? null,
      primaryPosition: r.raw?.primaryPosition ?? null,
      reviewNote: r.review_note,
      suggestedPersonId: r.suggested_person_id,
      suggestedPersonName: r.suggested_person_id
        ? names.get(r.suggested_person_id) ?? null
        : null,
      createdAt: r.created_at,
    })
  }
  return out
}

async function loadRow(importRowId: string): Promise<RawRowRecord> {
  const { data, error } = await supabase
    .from('people_center_import_rows')
    .select('id, batch_id, source_key, raw, review_note, suggested_person_id, person_id, created_at')
    .eq('id', importRowId)
    .single()
  if (error) throw error
  return data as unknown as RawRowRecord
}

/** Mark every possible_match row for this source_key as resolved, pointing at
 * the linked/created person, so sibling rows from other syncs disappear from
 * the pending queue and future re-syncs correlate on the source_key. */
async function resolveSourceKey(
  sourceKey: string,
  personId: string,
  disposition: 'duplicate' | 'imported' | 'imported_for_review',
  note: string,
): Promise<void> {
  const { error } = await supabase
    .from('people_center_import_rows')
    .update({ disposition, person_id: personId, review_note: note })
    .eq('source_key', sourceKey)
    .eq('disposition', 'possible_match')
  if (error) throw error
}

/** CONFIRM: the Push row IS this manually-added person. Stamp the correlation
 * key, fill an assignment only if they have none, never overwrite. */
export async function confirmLink(
  actor: Actor,
  importRowId: string,
  personId: string,
): Promise<void> {
  const row = await loadRow(importRowId)

  const { data: person, error: pErr } = await supabase
    .from('people_center_people')
    .select('id, full_name, external_refs, off_roster')
    .eq('id', personId)
    .single()
  if (pErr) throw pErr

  // Stamp the correlation key. push_employee_id is written too when a future
  // export carries one on the row; today only the normalized-name source_key
  // is available. Merge, never clobber other external_refs.
  const refs = { ...((person.external_refs as Record<string, unknown>) ?? {}) }
  refs.push_source_key = row.source_key
  const { error: updErr } = await supabase
    .from('people_center_people')
    .update({ external_refs: refs, updated_by: actor.personId, updated_by_name: actor.name })
    .eq('id', personId)
    .select('id')
  if (updErr) throw updErr

  // Fill a primary assignment ONLY if the person has none — never overwrite an
  // assignment leadership entered (the "preserve manual data" rule).
  const { data: openPrimary, error: apErr } = await supabase
    .from('people_center_position_assignments')
    .select('id')
    .eq('person_id', personId)
    .eq('is_primary', true)
    .is('ended_on', null)
    .limit(1)
  if (apErr) throw apErr
  if (!openPrimary || openPrimary.length === 0) {
    const mappings = await loadMappings(supabase, SOURCE)
    const [classified] = classify([row.raw], mappings)
    if (classified?.positionId && classified?.locationId) {
      const { error: paErr } = await supabase
        .from('people_center_position_assignments')
        .insert({
          person_id: personId,
          position_id: classified.positionId,
          location_id: classified.locationId,
          is_primary: true,
          started_on: null,
          updated_by_name: actor.name,
        })
      if (paErr) throw paErr
    }
  }

  await resolveSourceKey(
    row.source_key,
    personId,
    'duplicate',
    'Linked to a manually-added profile by an admin from a Push sync',
  )

  await recordAudit(
    actor,
    'update',
    'person',
    personId,
    person.full_name as string,
    'Linked Push roster profile to this manually-added record',
  )
  await recordEvent(actor, 'push.linked', personId, 'person', personId, {
    source_key: row.source_key,
  })
}

/** REJECT: not the same person. Import the Push row as a brand-new record,
 * exactly as the sync would have (respecting the review-flag rules). */
export async function rejectLink(actor: Actor, importRowId: string): Promise<string> {
  const row = await loadRow(importRowId)
  const mappings = await loadMappings(supabase, SOURCE)
  const [c] = classify([row.raw], mappings)
  if (!c) throw new Error('Could not re-classify the source row.')

  const flagged = c.disposition === 'imported_for_review'
  const { data: created, error: insErr } = await supabase
    .from('people_center_people')
    .insert({
      full_name: c.row.displayName,
      preferred_name: c.row.preferredFirstName,
      person_kind: c.personKind ?? 'manager',
      status: 'active',
      data_quality_status: flagged ? 'needs_review' : 'ok',
      data_quality_note: flagged ? c.reviewNote : null,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .select('id')
    .single()
  if (insErr) throw insErr
  const newId = created.id as string

  if (c.positionId && c.locationId) {
    const { error: paErr } = await supabase
      .from('people_center_position_assignments')
      .insert({
        person_id: newId,
        position_id: c.positionId,
        location_id: c.locationId,
        is_primary: true,
        started_on: null,
        updated_by_name: actor.name,
      })
    if (paErr) throw paErr
  }

  await resolveSourceKey(
    row.source_key,
    newId,
    flagged ? 'imported_for_review' : 'imported',
    'Imported as a new person — admin rejected the possible match',
  )

  await recordAudit(
    actor,
    'create',
    'person',
    newId,
    c.row.displayName,
    'Imported from Push as a new person (rejected a possible match)',
  )
  return newId
}

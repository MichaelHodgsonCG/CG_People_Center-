// Stage 6 — upsert into People Center, with full lineage.
//
// Behavior (PUSH_ROSTER_ANALYSIS.md §5 + ADR 0005 amendment):
//   * 'imported' rows create a people row + a current primary assignment.
//   * 'imported_for_review' rows create the person FLAGGED
//     (data_quality_status = 'needs_review', review reason preserved in
//     data_quality_note). Position may be the placeholder; a missing
//     location means no assignment. If the person already exists (same
//     batch multi-location, or a prior batch), the row ATTACHES to that
//     person instead: non-primary assignment (guarded against duplicates)
//     and the person gets flagged with the appended reason.
//   * Clean 'imported' rows whose person exists from a prior batch become
//     'duplicate' (linked, unchanged) — a re-sync never overwrites
//     leadership-entered data.
//   * Every source row lands in people_center_import_rows either way.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BatchSummary, ClassifiedRow } from './types'

export interface CommitInput {
  source: string
  transport: 'xlsx' | 'csv' | 'api' | 'manual'
  fileName: string | null
  fileNote: string | null
  importedByPersonId: string | null
  importedByName: string
}

export interface CommitResult {
  batchId: string
  summary: BatchSummary
}

export async function commitBatch(
  supabase: SupabaseClient,
  input: CommitInput,
  classified: ClassifiedRow[],
): Promise<CommitResult> {
  // Correlate against people created by prior batches of this source.
  const { data: priorBatches, error: pbErr } = await supabase
    .from('people_center_import_batches')
    .select('id')
    .eq('source', input.source)
  if (pbErr) throw pbErr

  const existingByKey = new Map<string, string>()
  if (priorBatches && priorBatches.length > 0) {
    const { data: priorRows, error: prErr } = await supabase
      .from('people_center_import_rows')
      .select('source_key, person_id')
      .in('batch_id', priorBatches.map((b) => b.id))
      .not('person_id', 'is', null)
    if (prErr) throw prErr
    for (const r of priorRows ?? []) {
      if (r.person_id) existingByKey.set(r.source_key, r.person_id)
    }
  }

  // Incoming hires (status 'incoming', migration 20260707090000) were added
  // ahead of Push. When the roster finally carries them, ACTIVATE the
  // existing row instead of creating a duplicate — matched by normalized
  // full name; ambiguous names (two incoming rows with the same name) are
  // never auto-matched.
  const { data: incomingPeople, error: incErr } = await supabase
    .from('people_center_people')
    .select('id, full_name')
    .eq('status', 'incoming')
  if (incErr) throw incErr
  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const incomingByName = new Map<string, string>()
  for (const p of (incomingPeople ?? []) as { id: string; full_name: string }[]) {
    const k = normName(p.full_name)
    incomingByName.set(k, incomingByName.has(k) ? 'AMBIGUOUS' : p.id)
  }
  const activatedByRowNumber = new Map<number, string>()

  // Manually-added people not yet linked to this roster source (ADR 0011): the
  // HQ team (off_roster), candidates, and any hand-entered active/leave record.
  // When a Push row's name matches one of these, we do NOT import a duplicate —
  // we record a 'possible_match' for an admin to confirm the link. Sync-created
  // people already own an import_rows row (they are in existingByKey's values),
  // so they never enter this pool; incoming hires are name-activated above.
  const linkedPersonIds = new Set(existingByKey.values())
  const { data: manualPeople, error: manErr } = await supabase
    .from('people_center_people')
    .select('id, full_name, status')
    .not('status', 'in', '(incoming,departed)')
  if (manErr) throw manErr
  const manualByName = new Map<string, string>()
  for (const p of (manualPeople ?? []) as { id: string; full_name: string }[]) {
    if (linkedPersonIds.has(p.id)) continue
    const k = normName(p.full_name)
    manualByName.set(k, manualByName.has(k) ? 'AMBIGUOUS' : p.id)
  }

  // Clean imports of already-known people are plain duplicates. Flagged
  // imports of already-known people become attach operations instead.
  const rows: ClassifiedRow[] = classified.map((c) => {
    if (existingByKey.has(c.row.sourceKey)) {
      if (c.disposition === 'imported') {
        return {
          ...c,
          disposition: 'duplicate' as const,
          reviewNote: 'Already in People Center from a prior sync — not modified',
        }
      }
      if (c.disposition === 'imported_for_review') {
        return { ...c, sameBatchDuplicate: true }
      }
      return c
    }
    if (c.disposition === 'imported' || c.disposition === 'imported_for_review') {
      const match = incomingByName.get(normName(c.row.displayName))
      if (match && match !== 'AMBIGUOUS' && !activatedByRowNumber.has(c.row.rowNumber)) {
        activatedByRowNumber.set(c.row.rowNumber, match)
        return {
          ...c,
          disposition: 'duplicate' as const,
          reviewNote: 'Matched an incoming hire — existing record activated',
        }
      }
      // Name matches an unlinked manual profile: hold for admin confirmation
      // instead of creating a duplicate. Only first appearances become a
      // possible match (a multi-location second row rides on the first row's
      // resolution). person_id stays null so re-syncs never treat an
      // unresolved match as already-linked.
      if (!c.sameBatchDuplicate) {
        const manual = manualByName.get(normName(c.row.displayName))
        if (manual !== undefined) {
          return {
            ...c,
            disposition: 'possible_match' as const,
            suggestedPersonId: manual === 'AMBIGUOUS' ? null : manual,
            reviewNote:
              manual === 'AMBIGUOUS'
                ? 'Name matches more than one manually-added profile — an admin picks which to link'
                : 'Name matches a manually-added profile — an admin confirms the link',
          }
        }
      }
    }
    return c
  })

  const { data: batch, error: batchErr } = await supabase
    .from('people_center_import_batches')
    .insert({
      source: input.source,
      transport: input.transport,
      file_name: input.fileName,
      file_note: input.fileNote,
      imported_by_person_id: input.importedByPersonId,
      imported_by_name: input.importedByName,
    })
    .select('id')
    .single()
  if (batchErr) throw batchErr
  const batchId = batch.id as string

  // Create people: clean imports + first-appearance flagged imports.
  const toCreate = rows.filter(
    (c) =>
      (c.disposition === 'imported' || c.disposition === 'imported_for_review') &&
      !c.sameBatchDuplicate,
  )
  const personIdByKey = new Map<string, string>(existingByKey)
  const personIdByRowNumber = new Map<number, string>()
  if (toCreate.length > 0) {
    const { data: people, error: peopleErr } = await supabase
      .from('people_center_people')
      .insert(
        toCreate.map((c) => ({
          full_name: c.row.displayName,
          preferred_name: c.row.preferredFirstName,
          person_kind: c.personKind,
          status: 'active',
          data_quality_status:
            c.disposition === 'imported_for_review' ? 'needs_review' : 'ok',
          data_quality_note:
            c.disposition === 'imported_for_review' ? c.reviewNote : null,
          updated_by_name: input.importedByName,
        })),
      )
      .select('id')
    if (peopleErr) throw peopleErr
    people?.forEach((p, i) => {
      const c = toCreate[i]
      personIdByRowNumber.set(c.row.rowNumber, p.id as string)
      personIdByKey.set(c.row.sourceKey, p.id as string)
    })

    const assignments = toCreate
      .filter((c) => c.positionId && c.locationId)
      .map((c) => ({
        person_id: personIdByRowNumber.get(c.row.rowNumber),
        position_id: c.positionId,
        location_id: c.locationId,
        is_primary: true,
        started_on: null, // predates the system; unknown
        updated_by_name: input.importedByName,
      }))
    if (assignments.length > 0) {
      const { error: paErr } = await supabase
        .from('people_center_position_assignments')
        .insert(assignments)
      if (paErr) throw paErr
    }
  }

  // Activate matched incoming hires: they've officially arrived. Their
  // future-dated assignment stays as entered; the import row links to them.
  if (activatedByRowNumber.size > 0) {
    const ids = [...new Set(activatedByRowNumber.values())]
    const { error: actErr } = await supabase
      .from('people_center_people')
      .update({ status: 'active', updated_by_name: input.importedByName })
      .in('id', ids)
    if (actErr) throw actErr
    for (const [rowNumber, personId] of activatedByRowNumber) {
      personIdByRowNumber.set(rowNumber, personId)
    }
  }

  // Attach flagged rows for people that already exist (multi-location within
  // this batch, or known from a prior batch): non-primary assignment
  // (duplicate-guarded) + flag the person with the appended reason.
  const toAttach = rows.filter(
    (c) => c.disposition === 'imported_for_review' && c.sameBatchDuplicate,
  )
  for (const c of toAttach) {
    const personId = personIdByKey.get(c.row.sourceKey)
    if (!personId) continue // should not happen; lineage row still records the reason
    personIdByRowNumber.set(c.row.rowNumber, personId)

    if (c.positionId && c.locationId) {
      const { data: existing, error: exErr } = await supabase
        .from('people_center_position_assignments')
        .select('id')
        .eq('person_id', personId)
        .eq('position_id', c.positionId)
        .eq('location_id', c.locationId)
        .is('ended_on', null)
        .limit(1)
      if (exErr) throw exErr
      if (!existing || existing.length === 0) {
        const { error: paErr } = await supabase.from('people_center_position_assignments').insert({
          person_id: personId,
          position_id: c.positionId,
          location_id: c.locationId,
          is_primary: false,
          started_on: null,
          updated_by_name: input.importedByName,
        })
        if (paErr) throw paErr
      }
    }

    const { data: person, error: pErr } = await supabase
      .from('people_center_people')
      .select('data_quality_note')
      .eq('id', personId)
      .single()
    if (pErr) throw pErr
    const existingNote = (person?.data_quality_note as string | null) ?? null
    const note =
      existingNote && c.reviewNote && existingNote.includes(c.reviewNote)
        ? existingNote
        : [existingNote, c.reviewNote].filter(Boolean).join('; ') || null
    const { error: updErr } = await supabase
      .from('people_center_people')
      .update({
        data_quality_status: 'needs_review',
        data_quality_note: note,
        updated_by_name: input.importedByName,
      })
      .eq('id', personId)
    if (updErr) throw updErr
  }

  const { error: rowsErr } = await supabase.from('people_center_import_rows').insert(
    rows.map((c) => ({
      batch_id: batchId,
      row_number: c.row.rowNumber,
      source_key: c.row.sourceKey,
      raw: c.row, // already redacted by the normalize whitelist
      disposition: c.disposition,
      review_note: c.reviewNote,
      suggested_person_id: c.suggestedPersonId ?? null,
      person_id:
        personIdByRowNumber.get(c.row.rowNumber) ??
        (c.disposition === 'duplicate'
          ? existingByKey.get(c.row.sourceKey) ?? null
          : null),
    })),
  )
  if (rowsErr) throw rowsErr

  const summary: BatchSummary = {
    rowCount: rows.length,
    imported: rows.filter((c) => c.disposition === 'imported').length,
    importedForReview: rows.filter((c) => c.disposition === 'imported_for_review').length,
    duplicates: rows.filter((c) => c.disposition === 'duplicate').length,
    needsReview: rows.filter((c) => c.disposition === 'needs_review').length,
    skipped: rows.filter((c) => c.disposition === 'skipped_out_of_scope').length,
    possibleMatch: rows.filter((c) => c.disposition === 'possible_match').length,
  }

  const { error: countErr } = await supabase
    .from('people_center_import_batches')
    .update({
      row_count: summary.rowCount,
      imported_count: summary.imported,
      imported_for_review_count: summary.importedForReview,
      duplicate_count: summary.duplicates,
      review_count: summary.needsReview,
      skipped_count: summary.skipped,
      possible_match_count: summary.possibleMatch,
    })
    .eq('id', batchId)
  if (countErr) throw countErr

  return { batchId, summary }
}

// Stage 6 — upsert into People Center, with full lineage.
//
// V1 behavior (documented in PUSH_ROSTER_ANALYSIS.md §5): rows whose
// source_key matched a person created by a PRIOR batch of the same source
// become 'duplicate' (linked, unchanged — People Center is the master of the
// talent view; a re-sync must not overwrite leadership-entered data).
// Rows classified 'imported' create a people row + a current primary
// position assignment. Everything lands in import_rows either way.

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
    .from('import_batches')
    .select('id')
    .eq('source', input.source)
  if (pbErr) throw pbErr

  const existingByKey = new Map<string, string>()
  if (priorBatches && priorBatches.length > 0) {
    const { data: priorRows, error: prErr } = await supabase
      .from('import_rows')
      .select('source_key, person_id')
      .in('batch_id', priorBatches.map((b) => b.id))
      .not('person_id', 'is', null)
    if (prErr) throw prErr
    for (const r of priorRows ?? []) {
      if (r.person_id) existingByKey.set(r.source_key, r.person_id)
    }
  }

  const rows = classified.map((c) => {
    if (c.disposition === 'imported' && existingByKey.has(c.row.sourceKey)) {
      return {
        ...c,
        disposition: 'duplicate' as const,
        reviewNote: 'Already in People Center from a prior sync — not modified',
      }
    }
    return c
  })

  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
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

  // Create people for the importable rows (insert order = returned order).
  const toImport = rows.filter((c) => c.disposition === 'imported')
  const personIdByRowNumber = new Map<number, string>()
  if (toImport.length > 0) {
    const { data: people, error: peopleErr } = await supabase
      .from('people')
      .insert(
        toImport.map((c) => ({
          full_name: c.row.displayName,
          preferred_name: c.row.preferredFirstName,
          person_kind: c.personKind,
          status: 'active',
          updated_by_name: input.importedByName,
        })),
      )
      .select('id')
    if (peopleErr) throw peopleErr
    people?.forEach((p, i) => {
      personIdByRowNumber.set(toImport[i].row.rowNumber, p.id as string)
    })

    const { error: paErr } = await supabase.from('position_assignments').insert(
      toImport.map((c) => ({
        person_id: personIdByRowNumber.get(c.row.rowNumber),
        position_id: c.positionId,
        location_id: c.locationId,
        is_primary: true,
        started_on: null, // predates the system; unknown
        updated_by_name: input.importedByName,
      })),
    )
    if (paErr) throw paErr
  }

  const { error: rowsErr } = await supabase.from('import_rows').insert(
    rows.map((c) => ({
      batch_id: batchId,
      row_number: c.row.rowNumber,
      source_key: c.row.sourceKey,
      raw: c.row, // already redacted by the normalize whitelist
      disposition: c.disposition,
      review_note: c.reviewNote,
      person_id:
        c.disposition === 'imported'
          ? personIdByRowNumber.get(c.row.rowNumber) ?? null
          : c.disposition === 'duplicate'
            ? existingByKey.get(c.row.sourceKey) ?? null
            : null,
    })),
  )
  if (rowsErr) throw rowsErr

  const summary: BatchSummary = {
    rowCount: rows.length,
    imported: rows.filter((c) => c.disposition === 'imported').length,
    duplicates: rows.filter((c) => c.disposition === 'duplicate').length,
    needsReview: rows.filter((c) => c.disposition === 'needs_review').length,
    skipped: rows.filter((c) => c.disposition === 'skipped_out_of_scope').length,
  }

  const { error: countErr } = await supabase
    .from('import_batches')
    .update({
      row_count: summary.rowCount,
      imported_count: summary.imported,
      duplicate_count: summary.duplicates,
      review_count: summary.needsReview,
      skipped_count: summary.skipped,
    })
    .eq('id', batchId)
  if (countErr) throw countErr

  return { batchId, summary }
}

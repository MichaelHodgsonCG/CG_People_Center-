// Stages 3–5 — mapping, eligibility, review routing.
//
// The question this stage answers is the architectural rule (ADR 0004):
//   "Should this person exist in People Center?"
// which is decided by POSITION ELIGIBILITY (people_center_positions.
// people_center_eligible via people_center_position_mappings) — never by
// salary status, which this pipeline does not even read.
//
// Review philosophy (ADR 0005 amendment, 2026-07-02): rows with leadership
// signals but broken/ambiguous data are IMPORTED AND FLAGGED
// ('imported_for_review', people.data_quality_status = 'needs_review',
// review reason preserved) rather than excluded — a questionable manager
// inside People Center marked for cleanup beats a missing one. Rows that map
// cleanly to non-eligible positions (e.g. Supervisor) and unmapped ordinary
// hourly rows still never import.

import { normalizeKey } from './normalize'
import type { ClassifiedRow, MappingTables, NormalizedRow } from './types'

const MANAGEMENT_DEPT_KEY = 'salaried manager'

export function classify(
  rows: NormalizedRow[],
  mappings: MappingTables,
): ClassifiedRow[] {
  // sourceKey → rowNumber of the row that (will) create the person
  const importedKeys = new Map<string, number>()
  return rows.map((row) => classifyOne(row, mappings, importedKeys))
}

function hasManagementSignal(row: NormalizedRow): boolean {
  return (
    normalizeKey(row.primaryDepartment ?? '') === MANAGEMENT_DEPT_KEY ||
    row.otherPositions.some((p) => normalizeKey(p) === MANAGEMENT_DEPT_KEY)
  )
}

function classifyOne(
  row: NormalizedRow,
  mappings: MappingTables,
  importedKeys: Map<string, number>,
): ClassifiedRow {
  const location = row.companyName
    ? (mappings.locations.get(normalizeKey(row.companyName)) ?? null)
    : null

  const base = {
    row,
    positionId: null as string | null,
    locationId: null as string | null,
    personKind: null,
    sameBatchDuplicate: false,
  }

  // Import-with-flag for anomalous rows; handles the multi-location case by
  // marking the second appearance so the upsert attaches to the same person.
  function flaggedImport(note: string, positionId: string | null): ClassifiedRow {
    const firstRow = importedKeys.get(row.sourceKey)
    if (firstRow === undefined) importedKeys.set(row.sourceKey, row.rowNumber)
    return {
      ...base,
      disposition: 'imported_for_review',
      reviewNote:
        firstRow === undefined
          ? note
          : `${note}; also appears in row ${firstRow} — multi-location, confirm primary`,
      positionId,
      locationId: location?.locationId ?? null,
      personKind: 'manager', // provisional; admin corrects during cleanup
      sameBatchDuplicate: firstRow !== undefined,
    }
  }

  // Anomaly: no position at all. Import flagged with the placeholder.
  if (!row.primaryPosition) {
    return flaggedImport(
      'No primary position in source row',
      mappings.placeholderPositionId,
    )
  }

  const position = mappings.positions.get(normalizeKey(row.primaryPosition))

  if (!position) {
    // Unmapped position with a management signal (department or positions
    // list): import flagged with the placeholder position. Without a
    // management signal: ordinary out-of-scope row.
    if (hasManagementSignal(row)) {
      return flaggedImport(
        `Unmapped position "${row.primaryPosition}" on a management-flagged row`,
        mappings.placeholderPositionId,
      )
    }
    return { ...base, disposition: 'skipped_out_of_scope', reviewNote: null }
  }

  if (!position.eligible) {
    // Mapped, explicitly not eligible (e.g. Supervisor): a clean, recorded
    // skip — these are nomination candidates, not imports (D4). This rule is
    // unchanged by the review-import amendment: it is what keeps broad
    // hourly leadership-adjacent rows out.
    return { ...base, disposition: 'skipped_out_of_scope', reviewNote: null }
  }

  // Eligible position at an unmapped business unit: import flagged with the
  // real position but no assignment (location gets fixed during cleanup).
  if (!location) {
    return flaggedImport(
      `Business unit "${row.companyName ?? '(none)'}" is not mapped`,
      position.positionId,
    )
  }

  // Clean eligible row. A second appearance of the same person is
  // multi-location: import flagged so an admin confirms the primary.
  const firstRow = importedKeys.get(row.sourceKey)
  if (firstRow !== undefined) {
    return {
      ...base,
      disposition: 'imported_for_review',
      reviewNote: `Also appears in row ${firstRow} — multi-location, confirm primary`,
      positionId: position.positionId,
      locationId: location.locationId,
      personKind: position.defaultPersonKind,
      sameBatchDuplicate: true,
    }
  }
  importedKeys.set(row.sourceKey, row.rowNumber)

  return {
    row,
    disposition: 'imported',
    reviewNote: null,
    positionId: position.positionId,
    locationId: location.locationId,
    personKind: position.defaultPersonKind,
    sameBatchDuplicate: false,
  }
}

export function summarize(classified: ClassifiedRow[]) {
  return {
    rowCount: classified.length,
    imported: classified.filter((c) => c.disposition === 'imported').length,
    importedForReview: classified.filter((c) => c.disposition === 'imported_for_review')
      .length,
    duplicates: classified.filter((c) => c.disposition === 'duplicate').length,
    needsReview: classified.filter((c) => c.disposition === 'needs_review').length,
    skipped: classified.filter((c) => c.disposition === 'skipped_out_of_scope').length,
  }
}

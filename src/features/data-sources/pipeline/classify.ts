// Stages 3–5 — mapping, eligibility, review routing.
//
// The question this stage answers is the architectural rule (ADR 0004):
//   "Should this person exist in People Center?"
// which is decided by POSITION ELIGIBILITY (positions.people_center_eligible
// via position_mappings) — never by salary status, which this pipeline does
// not even read.

import { normalizeKey } from './normalize'
import type { ClassifiedRow, MappingTables, NormalizedRow } from './types'

const MANAGEMENT_DEPT_KEY = 'salaried manager'

export function classify(
  rows: NormalizedRow[],
  mappings: MappingTables,
): ClassifiedRow[] {
  const seenKeys = new Map<string, number>() // sourceKey → first eligible rowNumber
  const results: ClassifiedRow[] = []

  for (const row of rows) {
    results.push(classifyOne(row, mappings, seenKeys))
  }
  return results
}

function classifyOne(
  row: NormalizedRow,
  mappings: MappingTables,
  seenKeys: Map<string, number>,
): ClassifiedRow {
  const base = {
    row,
    positionId: null,
    locationId: null,
    personKind: null,
  }

  if (!row.primaryPosition) {
    return {
      ...base,
      disposition: 'needs_review',
      reviewNote: 'No primary position in source row',
    }
  }

  const position = mappings.positions.get(normalizeKey(row.primaryPosition))

  if (!position) {
    // Unmapped position: out of scope, unless the source flags the person as
    // management (by department OR anywhere in the positions list) — then a
    // human should look ("Manager", "Salaried Manager", data errors) rather
    // than the row vanishing silently.
    const flaggedManagement =
      normalizeKey(row.primaryDepartment ?? '') === MANAGEMENT_DEPT_KEY ||
      row.otherPositions.some((p) => normalizeKey(p) === MANAGEMENT_DEPT_KEY)
    return flaggedManagement
      ? {
          ...base,
          disposition: 'needs_review',
          reviewNote: `Management-flagged row with unmapped position "${row.primaryPosition}"`,
        }
      : { ...base, disposition: 'skipped_out_of_scope', reviewNote: null }
  }

  if (!position.eligible) {
    // Mapped, explicitly not eligible (e.g. Supervisor): a clean, recorded
    // skip — these are nomination candidates, not imports (D4).
    return { ...base, disposition: 'skipped_out_of_scope', reviewNote: null }
  }

  const location = row.companyName
    ? mappings.locations.get(normalizeKey(row.companyName))
    : undefined
  if (!location) {
    return {
      ...base,
      disposition: 'needs_review',
      reviewNote: `Eligible person at unmapped business unit "${row.companyName ?? '(none)'}"`,
    }
  }

  const firstRow = seenKeys.get(row.sourceKey)
  if (firstRow !== undefined) {
    return {
      ...base,
      disposition: 'needs_review',
      reviewNote: `Same person also in row ${firstRow} — multi-location; confirm primary assignment`,
    }
  }
  seenKeys.set(row.sourceKey, row.rowNumber)

  return {
    row,
    disposition: 'imported',
    reviewNote: null,
    positionId: position.positionId,
    locationId: location.locationId,
    personKind: position.defaultPersonKind,
  }
}

export function summarize(classified: ClassifiedRow[]) {
  return {
    rowCount: classified.length,
    imported: classified.filter((c) => c.disposition === 'imported').length,
    duplicates: classified.filter((c) => c.disposition === 'duplicate').length,
    needsReview: classified.filter((c) => c.disposition === 'needs_review').length,
    skipped: classified.filter((c) => c.disposition === 'skipped_out_of_scope').length,
  }
}

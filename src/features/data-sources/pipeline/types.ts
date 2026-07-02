// Source synchronization pipeline (ADR 0005).
// Stages: transport → normalize → map/eligibility (classify) → review → upsert.
// Modules in this folder are PURE — no Supabase client, no env access — so
// stages are unit-testable and a Push API transport slots in without change.

/** A raw record as delivered by a transport: header → cell string. */
export type RawRecord = Record<string, string>

/**
 * A normalized source row. Compensation fields are dropped by the
 * normalization stage's field WHITELIST and can never reach this type —
 * redaction is a property of the parser, not a downstream filter.
 */
export interface NormalizedRow {
  rowNumber: number
  /** Normalized legal name — the correlation key until push_employee_id exists. */
  sourceKey: string
  /** Legal/payroll name as in the source ("Last, First"). Lineage only — never on people. */
  legalName: string
  /** Display name from Preferred Name, reordered "First Last" (P1-5). */
  displayName: string
  /** Given-name token of the preferred name. */
  preferredFirstName: string | null
  companyName: string | null
  primaryPosition: string | null
  primaryDepartment: string | null
  otherPositions: string[]
}

export type Disposition =
  | 'imported'
  | 'imported_for_review' // leadership-signaled anomaly: imported, flagged for cleanup
  | 'skipped_out_of_scope'
  | 'needs_review' // kept for future sources; current rules import-or-skip
  | 'duplicate'

export interface ClassifiedRow {
  row: NormalizedRow
  disposition: Disposition
  reviewNote: string | null
  /**
   * Resolved local ids. For 'imported_for_review', positionId may be the
   * 'Needs Position Review' placeholder, and locationId may be null (then
   * no assignment is created — the person still imports, flagged).
   */
  positionId: string | null
  locationId: string | null
  personKind: 'manager' | 'emerging_leader' | 'key_team_member' | null
  /**
   * True when this row's person was already produced by an earlier row of
   * the same batch (multi-location): the upsert attaches a non-primary
   * assignment to that person instead of creating a second one.
   */
  sameBatchDuplicate: boolean
}

export interface PositionMappingEntry {
  positionId: string
  positionName: string
  eligible: boolean
  defaultPersonKind: 'manager' | 'emerging_leader' | 'key_team_member'
}

export interface LocationMappingEntry {
  locationId: string
  locationName: string
}

/** Vocabulary tables, keyed by lowercased/trimmed source value. */
export interface MappingTables {
  positions: Map<string, PositionMappingEntry>
  locations: Map<string, LocationMappingEntry>
  /** positions.id of the 'Needs Position Review' placeholder. */
  placeholderPositionId: string | null
}

export interface BatchSummary {
  rowCount: number
  imported: number
  importedForReview: number
  duplicates: number
  needsReview: number
  skipped: number
}

/** Name of the seeded placeholder position for unclear source positions. */
export const PLACEHOLDER_POSITION_NAME = 'Needs Position Review'

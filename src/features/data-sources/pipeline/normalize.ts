// Stage 2 — normalization. Transport-agnostic: takes RawRecords from any
// transport (xlsx today, Push API tomorrow) and produces NormalizedRows.
//
// REDACTION HAPPENS HERE, by whitelist: only the fields named in this file
// are ever read. Salary/compensation columns are not read, not copied, and
// cannot appear anywhere downstream (lineage included). Company city and
// province are likewise not read — they are payroll-entity data, not
// personal geography, and never touch people.home_city.

import type { NormalizedRow, RawRecord } from './types'

const BLANK_MARKERS = new Set(['', '(blank)', 'none', 'null', 'n/a'])

function clean(value: string | undefined | null): string | null {
  const v = (value ?? '').trim()
  return BLANK_MARKERS.has(v.toLowerCase()) ? null : v
}

/** "Last, First" → "First Last"; passes through anything not comma-shaped. */
export function reorderName(name: string): string {
  const idx = name.indexOf(',')
  if (idx === -1) return name.trim()
  const last = name.slice(0, idx).trim()
  const first = name.slice(idx + 1).trim()
  return first ? `${first} ${last}` : last
}

export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function normalize(records: RawRecord[]): NormalizedRow[] {
  const rows: NormalizedRow[] = []
  records.forEach((record, i) => {
    const legalName = clean(record['Name'])
    if (!legalName) return // header artifacts / fully blank rows carry no person
    const preferred = clean(record['Preferred Name']) ?? legalName
    const displayName = reorderName(preferred)
    const preferredFirstName = displayName.split(' ')[0] ?? null
    rows.push({
      rowNumber: i + 1,
      sourceKey: normalizeKey(legalName),
      legalName,
      displayName,
      preferredFirstName,
      companyName: clean(record['Company Name']),
      primaryPosition: clean(record['Primary Position']),
      primaryDepartment: clean(record['Primary Department']),
      otherPositions: (clean(record['Positions']) ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    })
  })
  return rows
}

// Excel (.xlsx) export of gap reports. xlsx (SheetJS) is already a project
// dependency (the import pipeline uses it); dynamic-imported here so it only
// loads when someone actually exports.

export interface GapXlsxRow {
  position_name: string
  required_count: number
  current: number
  gap: number
  names: string[]
}

export interface CompanyGapXlsxRow {
  location_name: string
  position_name: string
  gap: number
  reason: 'new-site' | 'backfill' | 'understaffed'
  detail: string
}

const REASON_TEXT: Record<CompanyGapXlsxRow['reason'], string> = {
  'new-site': 'New site',
  backfill: 'Backfill',
  understaffed: 'Understaffed',
}

export async function downloadGapXlsx(opts: {
  locationName: string
  upcoming: boolean
  rows: GapXlsxRow[]
  totals: { required: number; filled: number; gap: number }
  generatedOn: string
}): Promise<void> {
  const XLSX = await import('xlsx')
  const currentLabel = opts.upcoming ? 'Slated' : 'In seat'
  const aoa: (string | number)[][] = [
    [`${opts.locationName} — Leadership Gap Analysis`],
    [opts.upcoming ? 'Upcoming (slated)' : 'Open (in seat)'],
    [`Generated ${opts.generatedOn}`],
    [],
    ['Role', 'Required', currentLabel, 'Gap', opts.upcoming ? 'Slated' : 'People'],
    ...opts.rows.map((r) => [
      r.position_name,
      r.required_count,
      r.current,
      r.gap > 0 ? `short ${r.gap}` : 'OK',
      r.names.join(', ') || (opts.upcoming ? 'not yet named' : '—'),
    ]),
    [
      'Total',
      opts.totals.required,
      opts.totals.filled,
      opts.totals.gap > 0 ? `short ${opts.totals.gap}` : 'fully staffed',
      '',
    ],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 26 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 30 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Gap Analysis')
  XLSX.writeFile(wb, `${opts.locationName} - Gap Analysis.xlsx`)
}

export async function downloadCompanyGapXlsx(opts: {
  rows: CompanyGapXlsxRow[]
  generatedOn: string
}): Promise<void> {
  const XLSX = await import('xlsx')
  const total = opts.rows.reduce((s, r) => s + r.gap, 0)
  const byReason = opts.rows.reduce(
    (acc, r) => ((acc[r.reason] = (acc[r.reason] ?? 0) + r.gap), acc),
    {} as Record<string, number>,
  )
  const aoa: (string | number)[][] = [
    ['Company-wide Leadership Gaps'],
    [`Generated ${opts.generatedOn}`],
    [
      `Total open roles: ${total}  ·  New-site ${byReason['new-site'] ?? 0}  ·  Backfill ${byReason.backfill ?? 0}  ·  Understaffed ${byReason.understaffed ?? 0}`,
    ],
    [],
    // "Assign to" is the fill-in column: type who should fill each open role,
    // then re-upload to record them as slated leaders (Gap Analysis → Upload).
    ['Location', 'Role', 'Gap', 'Type', 'Detail', 'Assign to'],
    ...opts.rows.map((r) => [
      r.location_name,
      r.position_name,
      r.gap,
      REASON_TEXT[r.reason],
      r.detail || '—',
      '',
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 6 }, { wch: 14 }, { wch: 48 }, { wch: 28 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Company Gaps')
  XLSX.writeFile(wb, 'Company-wide Leadership Gaps.xlsx')
}

// Parse a filled-in gap Excel back into resolved assignments. The exported
// company report has a blank "Assign to" column; the user types who should fill
// each open role and re-uploads. We resolve Location + Role + person by name.
// A person that matches an existing record links; an unknown name is flagged to
// be added as a new candidate. Pure resolution only — nothing is written here.

export type AssignAction = 'link' | 'create' | 'error'

export interface ResolvedAssignment {
  rowNum: number
  locationName: string
  roleName: string
  personName: string
  locationId: string | null
  positionId: string | null
  personId: string | null // set when linking an existing person
  action: AssignAction
  note: string
}

export interface ImportRefs {
  locations: { id: string; name: string }[]
  positions: { id: string; name: string }[]
  people: { id: string; full_name: string }[]
}

const norm = (s: string) => s.trim().toLowerCase()

export async function parseAssignmentXlsx(
  file: File,
  refs: ImportRefs,
): Promise<ResolvedAssignment[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })

  const headerIdx = grid.findIndex((r) =>
    (r as unknown[]).some((c) => norm(String(c ?? '')) === 'assign to'),
  )
  if (headerIdx < 0) {
    throw new Error('No "Assign to" column found. Download the gap report, fill it in, then upload it.')
  }
  const header = (grid[headerIdx] as unknown[]).map((c) => norm(String(c ?? '')))
  const locCol = header.indexOf('location')
  const roleCol = header.indexOf('role')
  const assignCol = header.indexOf('assign to')
  if (locCol < 0 || roleCol < 0) {
    throw new Error('The sheet needs Location and Role columns (use the exported company report).')
  }

  const locByName = new Map(refs.locations.map((l) => [norm(l.name), l.id]))
  const posByName = new Map(refs.positions.map((p) => [norm(p.name), p.id]))
  const peopleByName = new Map<string, string[]>()
  for (const p of refs.people) {
    const k = norm(p.full_name)
    peopleByName.set(k, [...(peopleByName.get(k) ?? []), p.id])
  }

  const out: ResolvedAssignment[] = []
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i] as unknown[]
    const assignRaw = String(row[assignCol] ?? '').trim()
    if (!assignRaw) continue
    const locationName = String(row[locCol] ?? '').trim()
    const roleName = String(row[roleCol] ?? '').trim()
    const names = assignRaw.split(',').map((s) => s.trim()).filter(Boolean)
    const personName = names[0] ?? ''
    const extras = names.slice(1)

    const locationId = locByName.get(norm(locationName)) ?? null
    const positionId = posByName.get(norm(roleName)) ?? null

    let action: AssignAction = 'error'
    let personId: string | null = null
    let note = ''
    if (!locationId) note = `Unknown location "${locationName}"`
    else if (!positionId) note = `Unknown role "${roleName}"`
    else {
      const matches = peopleByName.get(norm(personName)) ?? []
      if (matches.length === 1) {
        action = 'link'
        personId = matches[0]
        note = 'link existing person'
      } else if (matches.length > 1) {
        note = `"${personName}" matches ${matches.length} people — set by hand`
      } else {
        action = 'create'
        note = 'add as new candidate'
      }
    }
    if (extras.length) note += ` · extra names ignored (one seat per role): ${extras.join(', ')}`
    out.push({ rowNum: i + 1, locationName, roleName, personName, locationId, positionId, personId, action, note })
  }
  return out
}

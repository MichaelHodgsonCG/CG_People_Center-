// Development-path workbook parser (ADR 0010) — a pure stage, like the
// roster pipeline: bytes in, structured sheets out, no I/O.
//
// The workbook grammar (CG Management Development Path):
//   * one sheet per role (master) or per manager (filled location copy)
//   * header rows: title, purpose, Restaurant / Manager / Chef in Training /
//     Training Chef fields, and the 0–3 scoring rubric
//   * repeating sections: [optional PHASE banner] → section title →
//     a "QTR 1..QTR 4" header row → item rows scored 0–3 per quarter →
//     a NOTES row → "Progress (out of N)" subtotal rows (computed; skipped)
//   * per-role "Quarterly Goals" sheets — a different instrument, skipped.

import { read, utils, type WorkSheet } from 'xlsx'

export interface ParsedItem {
  prompt: string
  /** quarter (1–4) → score (0–3); only quarters actually filled in */
  scores: Partial<Record<1 | 2 | 3 | 4, number>>
}

export interface ParsedSection {
  phase: string | null
  title: string
  items: ParsedItem[]
  note: string | null
}

export interface ParsedPathSheet {
  tabName: string
  sheetTitle: string
  restaurant: string | null
  managerName: string | null
  trainerName: string | null
  sections: ParsedSection[]
  itemCount: number
  scoreCount: number
}

export interface SkippedTab {
  tabName: string
  reason: string
}

export interface ParsedDevPathWorkbook {
  pathSheets: ParsedPathSheet[]
  skipped: SkippedTab[]
}

/** Normalization used EVERYWHERE prompts/titles are matched (ADR 0010 §2):
 * case-, whitespace-, punctuation- and smart-quote-insensitive. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
}

const RUBRIC_MARKERS = [
  'not yet trained',
  'learning underway',
  'trained accountable',
  'able to train others',
]

const FIELD_LABELS: { key: 'restaurant' | 'manager' | 'trainer'; re: RegExp }[] = [
  { key: 'restaurant', re: /^restaurant\s*:?\s*$/i },
  { key: 'manager', re: /^(manager|chef in training)\s*:?\s*$/i },
  { key: 'trainer', re: /^(training chef|trainer)\s*:?\s*$/i },
]

interface Grid {
  rows: number
  cols: number
  text: (r: number, c: number) => string | null
  num: (r: number, c: number) => number | null
}

function toGrid(sheet: WorkSheet): Grid {
  const ref = sheet['!ref']
  const range = ref ? utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } }
  const rows = range.e.r + 1
  const cols = Math.min(range.e.c + 1, 30) // paths never use columns past AD
  return {
    rows,
    cols,
    text(r, c) {
      const cell = sheet[utils.encode_cell({ r, c })]
      if (!cell || cell.v == null) return null
      const s = String(cell.v).trim()
      return s === '' ? null : s
    },
    num(r, c) {
      const cell = sheet[utils.encode_cell({ r, c })]
      if (!cell || cell.v == null) return null
      if (typeof cell.v === 'number') return cell.v
      const n = Number(String(cell.v).trim())
      return Number.isFinite(n) ? n : null
    },
  }
}

function isRubricText(s: string): boolean {
  const n = normalizeText(s)
  return RUBRIC_MARKERS.some((m) => n.startsWith(m))
}

function isProgressText(s: string): boolean {
  return /^(all\s+)?progress\s*\(out of/i.test(s.trim())
}

function isNotesText(s: string): boolean {
  return /^notes\s*:?/i.test(s.trim())
}

function isPhaseText(s: string): boolean {
  return /^phase\s+/i.test(s.trim())
}

/** First text cell in the leading columns (before the score grid). */
function promptAt(grid: Grid, r: number, before: number): string | null {
  for (let c = 0; c < Math.min(before, 3); c++) {
    const t = grid.text(r, c)
    if (t) return t
  }
  return null
}

function parseSheet(tabName: string, sheet: WorkSheet): ParsedPathSheet | SkippedTab {
  const grid = toGrid(sheet)
  if (grid.rows === 0) return { tabName, reason: 'Empty sheet' }

  const sheetTitle = promptAt(grid, 0, 3) ?? promptAt(grid, 1, 3) ?? tabName

  // Not a path sheet? (Quarterly Goals worksheets, cover pages, …)
  let hasRubric = false
  for (let r = 0; r < Math.min(grid.rows, 40) && !hasRubric; r++) {
    for (let c = 0; c < grid.cols && !hasRubric; c++) {
      const t = grid.text(r, c)
      if (t && isRubricText(t)) hasRubric = true
    }
  }
  if (/goal/i.test(sheetTitle) || /goal/i.test(tabName)) {
    return { tabName, reason: 'Quarterly goals worksheet (not parsed yet)' }
  }
  if (!hasRubric) {
    return { tabName, reason: 'No 0–3 scoring rubric found — not a path sheet' }
  }

  // Header fields: label in one cell, value in the next non-empty cell right.
  const fields: Record<'restaurant' | 'manager' | 'trainer', string | null> = {
    restaurant: null,
    manager: null,
    trainer: null,
  }
  for (let r = 0; r < Math.min(grid.rows, 12); r++) {
    for (let c = 0; c < grid.cols; c++) {
      const t = grid.text(r, c)
      if (!t) continue
      for (const { key, re } of FIELD_LABELS) {
        if (re.test(t)) {
          for (let vc = c + 1; vc < Math.min(c + 6, grid.cols); vc++) {
            const v = grid.text(r, vc)
            if (v) {
              fields[key] = v
              break
            }
          }
        } else if (fields[key] === null) {
          // 'Restaurant: Beertown Waterloo' written in a single cell
          const m = t.match(/^(restaurant|manager|chef in training|training chef)\s*:\s*(.+)$/i)
          if (m) {
            const label = m[1].toLowerCase()
            const matches =
              (key === 'restaurant' && label === 'restaurant') ||
              (key === 'manager' && (label === 'manager' || label === 'chef in training')) ||
              (key === 'trainer' && label === 'training chef')
            if (matches) fields[key] = m[2].trim()
          }
        }
      }
    }
  }

  // Walk the sheet: PHASE banners, then per-section QTR header rows.
  const sections: ParsedSection[] = []
  let currentPhase: string | null = null
  let itemCount = 0
  let scoreCount = 0

  for (let r = 0; r < grid.rows; r++) {
    const lead = promptAt(grid, r, grid.cols)
    if (lead && isPhaseText(lead)) {
      currentPhase = lead
      continue
    }

    // A QTR header row: cells reading QTR 1..QTR 4 (at least QTR 1 + QTR 2).
    const qcols: Partial<Record<1 | 2 | 3 | 4, number>> = {}
    for (let c = 0; c < grid.cols; c++) {
      const t = grid.text(r, c)
      const m = t?.match(/^QTR\s*([1-4])$/i)
      if (m) qcols[Number(m[1]) as 1 | 2 | 3 | 4] = c
    }
    if (qcols[1] === undefined || qcols[2] === undefined) continue
    const firstScoreCol = qcols[1]

    // Section title: nearest usable text above the header row.
    let title: string | null = null
    for (let tr = r - 1; tr >= Math.max(0, r - 3) && !title; tr--) {
      const t = promptAt(grid, tr, firstScoreCol)
      if (!t) continue
      if (isRubricText(t) || isPhaseText(t) || isProgressText(t) || isNotesText(t)) continue
      if (/^[0-3]$/.test(t)) continue
      title = t.replace(/:\s*$/, '').trim()
    }
    if (!title) title = `Section ${sections.length + 1}`

    const section: ParsedSection = {
      phase: currentPhase,
      title,
      items: [],
      note: null,
    }

    // Item rows follow until NOTES / Progress / blank.
    let ir = r + 1
    for (; ir < grid.rows; ir++) {
      const prompt = promptAt(grid, ir, firstScoreCol)
      if (!prompt) break
      if (isProgressText(prompt)) break
      if (isNotesText(prompt)) {
        // Note text: remainder of the NOTES cell + any text right of it.
        // The template pads the NOTES cell with the "Progress (out of N):"
        // subtotal label — strip that; it's a computed artifact, not a note.
        const stripArtifacts = (s: string) =>
          s.replace(/(all\s+)?progress\s*\(out of[^)]*\)\s*:?/gi, '').trim()
        const parts: string[] = []
        const inline = stripArtifacts(prompt.replace(/^notes\s*:?/i, ''))
        if (inline) parts.push(inline)
        for (let c = firstScoreCol; c < grid.cols; c++) {
          const t = grid.text(ir, c)
          if (!t || /^[0-3]$/.test(t) || isNotesText(t)) continue
          const cleaned = stripArtifacts(t)
          if (cleaned) parts.push(cleaned)
        }
        if (parts.length > 0) section.note = parts.join(' ')
        break
      }
      const item: ParsedItem = { prompt, scores: {} }
      for (const q of [1, 2, 3, 4] as const) {
        const c = qcols[q]
        if (c === undefined) continue
        const n = grid.num(ir, c)
        if (n !== null && n >= 0 && n <= 3 && Number.isInteger(n)) {
          item.scores[q] = n
          scoreCount++
        }
      }
      // The master lists a couple of questions twice within one section —
      // treat repeats as one item (they'd be one score row anyway) and keep
      // the first score seen per quarter.
      const dup = section.items.find(
        (i) => normalizeText(i.prompt) === normalizeText(prompt),
      )
      if (dup) {
        for (const q of [1, 2, 3, 4] as const) {
          if (dup.scores[q] === undefined && item.scores[q] !== undefined) {
            dup.scores[q] = item.scores[q]
          }
        }
      } else {
        section.items.push(item)
        itemCount++
      }
    }

    if (section.items.length > 0) sections.push(section)
    r = ir // resume the outer walk after this section's items
  }

  if (sections.length === 0) {
    return { tabName, reason: 'No scored sections found' }
  }

  return {
    tabName,
    sheetTitle,
    restaurant: fields.restaurant,
    managerName: fields.manager,
    trainerName: fields.trainer,
    sections,
    itemCount,
    scoreCount,
  }
}

export async function parseDevPathWorkbook(
  file: File | ArrayBuffer,
): Promise<ParsedDevPathWorkbook> {
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  const workbook = read(new Uint8Array(buffer), { type: 'array' })
  const pathSheets: ParsedPathSheet[] = []
  const skipped: SkippedTab[] = []
  for (const name of workbook.SheetNames) {
    const result = parseSheet(name, workbook.Sheets[name])
    if ('reason' in result) skipped.push(result)
    else pathSheets.push(result)
  }
  return { pathSheets, skipped }
}

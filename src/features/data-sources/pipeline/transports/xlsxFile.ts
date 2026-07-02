// Stage 1 — transport: Excel workbook (today's Push transport).
// A transport's only job is to deliver RawRecords; everything downstream is
// transport-agnostic. Tomorrow's Push API transport returns the same shape
// from a fetch instead of a file.

import { read, utils } from 'xlsx'
import type { RawRecord } from '../types'

export async function readXlsx(file: File | ArrayBuffer): Promise<RawRecord[]> {
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  const workbook = read(new Uint8Array(buffer), { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('Workbook has no sheets')
  const sheet = workbook.Sheets[sheetName]
  // defval '' keeps blank cells as empty strings; raw:false stringifies
  return utils.sheet_to_json<RawRecord>(sheet, { defval: '', raw: false })
}

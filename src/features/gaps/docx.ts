// Word (.docx) export of a location's gap report. The docx library is
// dynamic-imported so it only loads when someone actually exports (keeps it out
// of the main bundle).

export interface GapDocRow {
  position_name: string
  required_count: number
  current: number
  gap: number
  names: string[]
}

export async function downloadGapDocx(opts: {
  locationName: string
  upcoming: boolean
  rows: GapDocRow[]
  totals: { required: number; filled: number; gap: number }
  generatedOn: string
}): Promise<void> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
  } = await import('docx')

  const currentLabel = opts.upcoming ? 'Slated' : 'In seat'

  const headerCell = (text: string, align: 'left' | 'center' = 'left') =>
    new TableCell({
      children: [
        new Paragraph({
          alignment: align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: true })],
        }),
      ],
    })

  const cell = (text: string, align: 'left' | 'center' = 'left', bold = false) =>
    new TableCell({
      children: [
        new Paragraph({
          alignment: align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [new TextRun({ text, bold })],
        }),
      ],
    })

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Role'),
      headerCell('Required', 'center'),
      headerCell(currentLabel, 'center'),
      headerCell('Gap', 'center'),
      headerCell(opts.upcoming ? 'Slated' : 'People'),
    ],
  })

  const dataRows = opts.rows.map(
    (r) =>
      new TableRow({
        children: [
          cell(r.position_name),
          cell(String(r.required_count), 'center'),
          cell(String(r.current), 'center'),
          cell(r.gap > 0 ? `short ${r.gap}` : 'OK', 'center'),
          cell(r.names.join(', ') || (opts.upcoming ? 'not yet named' : '—')),
        ],
      }),
  )

  const totalRow = new TableRow({
    children: [
      cell('Total', 'left', true),
      cell(String(opts.totals.required), 'center', true),
      cell(String(opts.totals.filled), 'center', true),
      cell(opts.totals.gap > 0 ? `short ${opts.totals.gap}` : 'fully staffed', 'center', true),
      cell(''),
    ],
  })

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: opts.locationName }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Leadership Gap Analysis — ${opts.upcoming ? 'Upcoming (slated)' : 'Open (in seat)'}`,
                italics: true,
                color: '888888',
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Generated ${opts.generatedOn}`, color: '888888', size: 18 }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Required ${opts.totals.required} · ${currentLabel} ${opts.totals.filled} · Gap ${opts.totals.gap}`,
                bold: true,
              }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headerRow, ...dataRows, totalRow],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Management roster only. Slated leadership is planned in Bench & Risk.',
                italics: true,
                color: '888888',
                size: 18,
              }),
            ],
          }),
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${opts.locationName} - Gap Analysis.docx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

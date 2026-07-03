// Development-path commit stages (ADR 0010). Two writers, both taking the
// Supabase client as a parameter like the roster pipeline's commit stage:
//
//   * syncTemplates — the MASTER workbook (tabs = roles). Sections match by
//     normalized title, items by normalized prompt; new wording appends,
//     missing wording deactivates (never deletes), reappearing wording
//     reactivates. Historical scores keep their exact question.
//   * commitAssessments — a FILLED workbook (tabs = managers). Upserts one
//     assessment per person × template × period and merges quarter scores,
//     so re-uploading a newer copy of the same workbook is always safe.

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeText, type ParsedPathSheet } from './parse'

// ---------------------------------------------------------------------------
// Template sync (master workbook)
// ---------------------------------------------------------------------------

export interface TemplateSyncSummary {
  templateId: string
  title: string
  sectionsCreated: number
  itemsCreated: number
  itemsReactivated: number
  itemsDeactivated: number
  itemsUnchanged: number
}

interface DbSection {
  id: string
  title: string
  phase: string | null
  sort_order: number
  active: boolean
}

interface DbItem {
  id: string
  section_id: string
  prompt: string
  sort_order: number
  active: boolean
}

export async function syncTemplates(
  supabase: SupabaseClient,
  sheets: ParsedPathSheet[],
  actorName: string,
  onProgress?: (message: string) => void,
): Promise<TemplateSyncSummary[]> {
  const { data: positions, error: posErr } = await supabase
    .from('people_center_positions')
    .select('id, name')
  if (posErr) throw posErr
  const positionByName = new Map(
    (positions ?? []).map((p) => [normalizeText(p.name as string), p.id as string]),
  )

  const results: TemplateSyncSummary[] = []
  for (let sheetIdx = 0; sheetIdx < sheets.length; sheetIdx++) {
    const sheet = sheets[sheetIdx]
    onProgress?.(`Syncing ${sheet.tabName} (${sheetIdx + 1}/${sheets.length})…`)
    const roleKey = normalizeText(sheet.tabName).replace(/ /g, '_')
    // Name-tolerant position link ('FOH Supervisor' path → 'Supervisor').
    const positionId =
      positionByName.get(normalizeText(sheet.tabName)) ??
      positionByName.get(normalizeText(sheet.tabName.replace(/^foh\s+/i, ''))) ??
      null

    const { data: template, error: tErr } = await supabase
      .from('people_center_dev_path_templates')
      .upsert(
        {
          role_key: roleKey,
          title: sheet.tabName,
          sheet_title: sheet.sheetTitle,
          position_id: positionId,
          updated_by_name: actorName,
        },
        { onConflict: 'role_key' },
      )
      .select('id')
      .single()
    if (tErr) throw tErr
    const templateId = template.id as string

    const { data: dbSections, error: sErr } = await supabase
      .from('people_center_dev_path_sections')
      .select('id, title, phase, sort_order, active')
      .eq('template_id', templateId)
    if (sErr) throw sErr
    const sectionByTitle = new Map<string, DbSection>(
      ((dbSections ?? []) as DbSection[]).map((s) => [normalizeText(s.title), s]),
    )

    const summary: TemplateSyncSummary = {
      templateId,
      title: sheet.tabName,
      sectionsCreated: 0,
      itemsCreated: 0,
      itemsReactivated: 0,
      itemsDeactivated: 0,
      itemsUnchanged: 0,
    }

    // Missing sections: ONE bulk insert (fetched back by title to map ids).
    const missingSections = sheet.sections
      .map((parsed, si) => ({ parsed, si }))
      .filter(({ parsed }) => !sectionByTitle.has(normalizeText(parsed.title)))
    if (missingSections.length > 0) {
      const { data: created, error } = await supabase
        .from('people_center_dev_path_sections')
        .insert(
          missingSections.map(({ parsed, si }) => ({
            template_id: templateId,
            title: parsed.title,
            phase: parsed.phase,
            sort_order: si,
          })),
        )
        .select('id, title, phase, sort_order, active')
      if (error) throw error
      for (const s of (created ?? []) as DbSection[]) {
        sectionByTitle.set(normalizeText(s.title), s)
      }
      summary.sectionsCreated = missingSections.length
    }

    // Drifted existing sections (rare: retitle-adjacent phase/order changes).
    const seenSectionIds = new Set<string>()
    for (let si = 0; si < sheet.sections.length; si++) {
      const parsed = sheet.sections[si]
      const db = sectionByTitle.get(normalizeText(parsed.title))
      if (!db) continue // impossible after the bulk insert; defensive
      seenSectionIds.add(db.id)
      const isNew = missingSections.some(({ parsed: p }) => p === parsed)
      if (!isNew && (db.phase !== parsed.phase || db.sort_order !== si || !db.active)) {
        const { error } = await supabase
          .from('people_center_dev_path_sections')
          .update({ phase: parsed.phase, sort_order: si, active: true })
          .eq('id', db.id)
        if (error) throw error
      }
    }

    // ALL of this template's items in ONE query, matched in memory.
    // Includes sections missing from the new master, so their items are
    // deactivated below along with the section itself.
    const sectionIds = [
      ...new Set([
        ...seenSectionIds,
        ...((dbSections ?? []) as DbSection[]).map((s) => s.id),
      ]),
    ]
    const { data: dbItems, error: iErr } = await supabase
      .from('people_center_dev_path_items')
      .select('id, section_id, prompt, sort_order, active')
      .in('section_id', sectionIds)
    if (iErr) throw iErr
    const itemByKey = new Map<string, DbItem>(
      ((dbItems ?? []) as DbItem[]).map((i) => [
        `${i.section_id}|${normalizeText(i.prompt)}`,
        i,
      ]),
    )

    const newItems: { section_id: string; prompt: string; sort_order: number }[] = []
    const reactivateIds: string[] = []
    const seenItemIds = new Set<string>()
    for (const parsed of sheet.sections) {
      const db = sectionByTitle.get(normalizeText(parsed.title))
      if (!db) continue
      for (let ii = 0; ii < parsed.items.length; ii++) {
        const prompt = parsed.items[ii].prompt
        const existing = itemByKey.get(`${db.id}|${normalizeText(prompt)}`)
        if (!existing) {
          newItems.push({ section_id: db.id, prompt, sort_order: ii })
        } else {
          seenItemIds.add(existing.id)
          if (!existing.active) reactivateIds.push(existing.id)
          else summary.itemsUnchanged++
        }
      }
    }

    // New questions: ONE bulk insert. Reactivations: ONE bulk update.
    if (newItems.length > 0) {
      const { error } = await supabase
        .from('people_center_dev_path_items')
        .insert(newItems)
      if (error) throw error
      summary.itemsCreated = newItems.length
    }
    if (reactivateIds.length > 0) {
      const { error } = await supabase
        .from('people_center_dev_path_items')
        .update({ active: true, deactivated_at: null })
        .in('id', reactivateIds)
      if (error) throw error
      summary.itemsReactivated = reactivateIds.length
    }

    // Anything the new master no longer contains: deactivate, keep history.
    // (dbItems predates this run's inserts, so new items are never touched.)
    const toDeactivate = ((dbItems ?? []) as DbItem[]).filter(
      (i) => i.active && !seenItemIds.has(i.id),
    )
    if (toDeactivate.length > 0) {
      const { error } = await supabase
        .from('people_center_dev_path_items')
        .update({ active: false, deactivated_at: new Date().toISOString() })
        .in('id', toDeactivate.map((i) => i.id))
      if (error) throw error
      summary.itemsDeactivated = toDeactivate.length
    }

    const staleSections = ((dbSections ?? []) as DbSection[]).filter(
      (s) => s.active && !seenSectionIds.has(s.id),
    )
    if (staleSections.length > 0) {
      const { error } = await supabase
        .from('people_center_dev_path_sections')
        .update({ active: false })
        .in('id', staleSections.map((s) => s.id))
      if (error) throw error
    }

    results.push(summary)
  }
  return results
}

// ---------------------------------------------------------------------------
// Assessment matching (filled workbook — tabs are managers)
// ---------------------------------------------------------------------------

export interface TemplateOption {
  id: string
  title: string
  sheet_title: string | null
}

export interface PersonOption {
  id: string
  full_name: string
  preferred_name: string | null
}

export interface MatchedTab {
  sheet: ParsedPathSheet
  /** auto-detected template — corrected in the preview if wrong */
  templateId: string | null
  /** auto-matched person — confirmed or corrected in the preview */
  personId: string | null
}

export async function loadMatchingOptions(supabase: SupabaseClient): Promise<{
  templates: TemplateOption[]
  people: PersonOption[]
}> {
  const [t, p] = await Promise.all([
    supabase
      .from('people_center_dev_path_templates')
      .select('id, title, sheet_title')
      .order('title'),
    supabase
      .from('people_center_people')
      .select('id, full_name, preferred_name')
      .neq('status', 'departed')
      .order('full_name'),
  ])
  if (t.error) throw t.error
  if (p.error) throw p.error
  return {
    templates: (t.data as TemplateOption[]) ?? [],
    people: (p.data as PersonOption[]) ?? [],
  }
}

export function matchTabs(
  sheets: ParsedPathSheet[],
  templates: TemplateOption[],
  people: PersonOption[],
): MatchedTab[] {
  const templateByHeading = new Map<string, string>()
  for (const t of templates) {
    if (t.sheet_title) templateByHeading.set(normalizeText(t.sheet_title), t.id)
    templateByHeading.set(normalizeText(t.title), t.id)
  }
  const personByName = new Map<string, string[]>()
  for (const p of people) {
    for (const name of [p.full_name, p.preferred_name]) {
      if (!name) continue
      const key = normalizeText(name)
      personByName.set(key, [...(personByName.get(key) ?? []), p.id])
    }
  }
  const uniquePerson = (name: string | null): string | null => {
    if (!name) return null
    const ids = personByName.get(normalizeText(name))
    return ids && ids.length === 1 ? ids[0] : null
  }

  return sheets.map((sheet) => {
    const heading = normalizeText(sheet.sheetTitle)
    let templateId = templateByHeading.get(heading) ?? null
    if (!templateId) {
      // e.g. a filled tab titled 'CHEF DE CUISINE DEVELOPMENT PATH — Sam'
      for (const [key, id] of templateByHeading) {
        if (heading.includes(key)) {
          templateId = id
          break
        }
      }
    }
    return {
      sheet,
      templateId,
      personId: uniquePerson(sheet.tabName) ?? uniquePerson(sheet.managerName),
    }
  })
}

// ---------------------------------------------------------------------------
// Assessment commit (filled workbook)
// ---------------------------------------------------------------------------

export interface AssessmentCommitInput {
  periodLabel: string
  fileName: string | null
  importedByName: string
}

export interface AssessmentCommitSummary {
  tabName: string
  personId: string
  assessmentId: string
  scoresWritten: number
  notesWritten: number
  itemsUnmatched: number
  unmatchedPrompts: string[]
}

interface TemplateIndex {
  /** normalized section title → section id */
  sectionIds: Map<string, string>
  /** normalized section title → (normalized prompt → item id) */
  bySection: Map<string, Map<string, string>>
  /** normalized prompt → item id (whole template, incl. inactive) */
  global: Map<string, string>
}

async function loadTemplateIndex(
  supabase: SupabaseClient,
  templateId: string,
): Promise<TemplateIndex> {
  const { data, error } = await supabase
    .from('people_center_dev_path_sections')
    .select('id, title, items:people_center_dev_path_items ( id, prompt )')
    .eq('template_id', templateId)
  if (error) throw error
  const index: TemplateIndex = {
    sectionIds: new Map(),
    bySection: new Map(),
    global: new Map(),
  }
  for (const s of (data ?? []) as {
    id: string
    title: string
    items: { id: string; prompt: string }[]
  }[]) {
    const sKey = normalizeText(s.title)
    index.sectionIds.set(sKey, s.id)
    const m = new Map<string, string>()
    for (const i of s.items) {
      const pKey = normalizeText(i.prompt)
      m.set(pKey, i.id)
      // Older filled sheets may predate a section retitle — the global map
      // (first match wins) still finds the question. Includes inactive items.
      if (!index.global.has(pKey)) index.global.set(pKey, i.id)
    }
    index.bySection.set(sKey, m)
  }
  return index
}

export async function commitAssessments(
  supabase: SupabaseClient,
  input: AssessmentCommitInput,
  tabs: MatchedTab[],
): Promise<AssessmentCommitSummary[]> {
  const results: AssessmentCommitSummary[] = []
  const indexCache = new Map<string, TemplateIndex>()

  for (const tab of tabs) {
    if (!tab.templateId || !tab.personId) continue // preview enforces this
    let index = indexCache.get(tab.templateId)
    if (!index) {
      index = await loadTemplateIndex(supabase, tab.templateId)
      indexCache.set(tab.templateId, index)
    }

    const { data: assessment, error: aErr } = await supabase
      .from('people_center_dev_assessments')
      .upsert(
        {
          person_id: tab.personId,
          template_id: tab.templateId,
          period_label: input.periodLabel,
          restaurant: tab.sheet.restaurant,
          trainer_name: tab.sheet.trainerName,
          source_file: input.fileName,
          source_tab: tab.sheet.tabName,
          imported_by_name: input.importedByName,
        },
        { onConflict: 'person_id,template_id,period_label' },
      )
      .select('id')
      .single()
    if (aErr) throw aErr
    const assessmentId = assessment.id as string

    const scoreRows: {
      assessment_id: string
      item_id: string
      quarter: number
      score: number
    }[] = []
    const noteRows: { assessment_id: string; section_id: string; note: string }[] = []
    const unmatched: string[] = []

    for (const section of tab.sheet.sections) {
      const sKey = normalizeText(section.title)
      const sectionItems = index.bySection.get(sKey)
      for (const item of section.items) {
        const pKey = normalizeText(item.prompt)
        const itemId = sectionItems?.get(pKey) ?? index.global.get(pKey) ?? null
        if (!itemId) {
          if (Object.keys(item.scores).length > 0) unmatched.push(item.prompt)
          continue
        }
        for (const [q, score] of Object.entries(item.scores)) {
          scoreRows.push({
            assessment_id: assessmentId,
            item_id: itemId,
            quarter: Number(q),
            score,
          })
        }
      }
      const sectionId = index.sectionIds.get(sKey)
      if (section.note && sectionId) {
        noteRows.push({
          assessment_id: assessmentId,
          section_id: sectionId,
          note: section.note,
        })
      }
    }

    if (scoreRows.length > 0) {
      // Dedupe by (item, quarter): identical wording in two places maps to
      // one item, and one upsert payload must not hit a row twice.
      const byKey = new Map<string, (typeof scoreRows)[number]>()
      for (const row of scoreRows) byKey.set(`${row.item_id}|${row.quarter}`, row)
      const { error } = await supabase
        .from('people_center_dev_scores')
        .upsert([...byKey.values()], { onConflict: 'assessment_id,item_id,quarter' })
      if (error) throw error
    }
    if (noteRows.length > 0) {
      const { error } = await supabase
        .from('people_center_dev_section_notes')
        .upsert(noteRows, { onConflict: 'assessment_id,section_id' })
      if (error) throw error
    }

    results.push({
      tabName: tab.sheet.tabName,
      personId: tab.personId,
      assessmentId,
      scoresWritten: scoreRows.length,
      notesWritten: noteRows.length,
      itemsUnmatched: unmatched.length,
      unmatchedPrompts: unmatched,
    })
  }
  return results
}

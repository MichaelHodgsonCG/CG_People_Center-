# ADR 0010 — Development paths: Excel-captured, database-mastered

Date: 2026-07-03
Status: Accepted (Michael, Phase 3 kickoff)

## Context

CG already runs a mature quarterly development program for every management
role. The instrument is an Excel workbook ("CG Management Development Path"):
one sheet per role (Chef de Cuisine, FOH Supervisor, Guest Service Manager,
Service Manager, Beverage Manager, General Manager), each a sequence of
sections (Grooming, Certifications, Floor Management, Ordering, …) containing
statements scored 0–3 per quarter:

    0  Not Yet Trained        2  Trained & Accountable
    1  Learning Underway      3  Able to Train Others

The Chef de Cuisine path additionally groups sections under four phases
(Kitchen Management, Interpersonal/HR, Administrative, Financials). Each
sheet carries header fields (Restaurant, Manager / Chef in Training,
Training Chef), per-section NOTES rows, and computed progress subtotals.

Locations fill these per manager — the filled workbooks arrive with **one
tab per manager**. The questions themselves are revised over time ("Updated
Jan F26 - Riley"). Long-term, managers will record their own feedback inside
People Center; **for now Excel remains the capture tool** and People Center
becomes the system of record for the results.

The workbooks also contain per-role "Quarterly Goals" worksheets (KPI grids
plus free-text goals). Those are a different instrument and are **out of
scope** for this ADR; the parser skips them.

## Decision

### 1. Template / assessment split

The framework and the results are separate object families:

* **Templates** (`people_center_dev_path_templates` → `_sections` →
  `_items`) — one template per role, its sections (with optional phase),
  and its scored statements. Synced from the master workbook; carries no
  personal data.
* **Assessments** (`people_center_dev_assessments` → `_scores`,
  `_section_notes`) — one per person × template × period (fiscal year
  label, e.g. `F26`), holding item × quarter × score plus the section
  NOTES text.

### 2. Questions evolve — items are versioned by text

Re-syncing a revised master workbook matches sections by normalized title
and items by normalized prompt within their template:

* Matched → kept (same id; historical scores untouched).
* New wording → appended as a new item.
* Missing from the new master → **deactivated, never deleted**
  (`active = false`, `deactivated_at` stamped).

Old filled workbooks therefore import cleanly against the exact question
text that was asked (matching considers inactive items too), and a revised
question starts a fresh score history instead of silently rewriting the old
one. Re-uploading the master workbook **is** the editing workflow for now;
in-app question editing can come later without a model change.

### 3. Filled-workbook import (one tab per manager)

The Data Sources importer parses each tab, detects the role by sheet
heading, matches the tab name / Manager field against People Center people
(admin confirms or corrects the match in the preview — nothing commits
unreviewed), and upserts the assessment. Re-uploading the same person ×
period **merges**: existing quarter scores are updated, new ones added —
consistent with the roster sync's re-upload semantics (ADR 0005).

### 4. Visibility: the chain contract, not a new rule

Assessment data follows ADR 0008 exactly as leadership notes do: readable
by admins/executives and **strict ancestors** of the subject — never peers,
never anyone above in reverse, and not the subject themselves in V1 (self
view/capture arrives with the in-app feedback phase, which will revisit
this deliberately rather than inherit it by accident). Templates are
readable by anyone with app access. All writes are admin + executive.

No domain events are emitted for score imports in V1 — a bulk upload of
historical paths would flood timelines with noise. Assessment reads are not
individually audited (unlike relationship/restricted notes): scores are
ordinary leadership development data, the same tier as leadership notes,
which are also un-audited on read.

### 5. What readiness means here

Progress percentages (score sums against the 3-per-item maximum) are
**computed projections, never stored** — same principle as succession
coverage (ADR 0009). Path progress will feed the Bench & Risk readiness
picture alongside succession, but the number informs the executive
judgment; it does not replace it.

## Consequences

* The cheat sheet gains a Development Path section (chain-visible) showing
  section-level progress per quarter.
* CGOPS guided-workflow signals (the second Phase 3 input) will join this
  readiness picture later under their own contract; nothing here assumes
  them.
* The uploaded workbooks are handled like the Push roster: they inform
  imports and are never committed to the repository.
* Quarterly Goals sheets are skipped by the parser until they get their own
  model.

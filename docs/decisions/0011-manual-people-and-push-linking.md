# ADR 0011 — Manually-added people and admin-confirmed Push linking

- **Status:** Accepted (2026-07-15)
- **Contract refs:** ADR 0005 (source sync pipeline), ADR 0004 (eligibility),
  PRODUCT_BRIEF.md §5, migration 20260707090000 (incoming hires),
  20260709090000 (this ADR)

## Context

Two populations belong in People Center but never arrive through the Push
roster sync:

1. **The HQ team** — active people who work outside the restaurant Push
   roster. They should appear (and belong on the org chart) but a roster sync
   will never see them, so they must not be treated as "missing."
2. **Candidates** — prospects not yet hired, not yet in any system. If they
   are hired they will later appear in a Push export.

The pipeline already had a narrow manual-add path: **incoming hires** (a
signed-but-not-started hire, status `incoming`), which the sync activates by
name match (ADR 0005 amendment / migration 20260707090000). But an active HQ
person or a candidate added by hand had **no correlation path**: when Push
later carried the same person, the re-sync — which correlates on the
normalized legal name (`source_key`) and only name-activates status
`incoming` rows — would create a **duplicate** `people` row.

The re-sync contract is deliberately conservative (ADR 0005): a sync **adds**
new people and **recognises-and-leaves-untouched** people it already knows; it
never merges field values or overwrites leadership-entered data. Manual adds
must extend that contract, not weaken it.

## Decision

### 1. Two new manual-add shapes

- `people.status` gains **`candidate`** — a prospect. Candidates sit in the
  Directory, are kept **out of the org chart** and headcount rollups, and
  convert to `incoming`/`active` when hired.
- `people.off_roster boolean` — an **active person outside the Push roster**
  (the HQ team). The sync never expects them and never flags them as missing.

Both are created through one generalised `addPerson` (the Directory's "Add
person" form, admin + executive per migration 20260704160000). Position and
location are **optional** for HQ/candidates (an HQ role or a prospect may have
neither yet); no assignment is created when either is missing. The org chart
is a projection of `manager_person_id`, so giving an HQ person a reporting
line is all it takes to place them on the chart.

### 2. Linking is admin-confirmed, never automatic

When a roster sync finds a name matching an **unlinked manual profile**
(off-roster, candidate, or any hand-entered active/leave record that the sync
has not previously linked), it does **not** import a duplicate. It records the
row with a new disposition **`possible_match`** and a `suggested_person_id`,
and holds it. `person_id` stays null, so an unresolved match never enters the
re-sync correlation set.

An admin resolves each pending match from **Data Sources → Pending links**:

- **Confirm** — same person. We stamp the correlation key
  (`external_refs.push_source_key`, and `push_employee_id` once a future export
  carries one), fill a primary assignment **only if the person has none**, and
  **never overwrite** anything already entered. Every future sync then
  recognises the person by `source_key` and leaves them untouched. The import
  row becomes `duplicate` (linked, unchanged).
- **Reject** — different person. The row is imported as a brand-new person,
  exactly as the sync would have (respecting the review-flag rules). The import
  row becomes `imported` / `imported_for_review`.

Sync-created people already own an import-lineage row, so they never appear in
the possible-match pool; incoming hires keep their existing by-name activation.

## Consequences

- The "add vs merge vs overwrite" contract is unchanged and now complete:
  a re-sync **adds** new people, **recognises-and-leaves-untouched** linked
  people (whether sync-created, incoming-activated, or admin-linked), and
  **holds** name collisions with unlinked manual profiles for an admin —
  it still never overwrites or merges leadership-entered data.
- Correlation reuses existing machinery: a confirmed link writes an
  `import_rows` row tying the Push `source_key` to the manual person, which is
  exactly the key the re-sync's duplicate detection already reads. No new
  correlation table.
- A Push API transport (ADR 0005) inherits all of this unchanged; when the
  export gains a stable employee ID, `push_employee_id` becomes the confirmed
  correlation key with no pipeline change.
- Linking is effectively admin-only because `import_rows` is admin-only under
  RLS — consistent with "Data Sources is an admin surface."

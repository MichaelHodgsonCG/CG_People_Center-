-- ============================================================================
-- Migration: add_review_imports
-- Phase 1 amendment — review rows with leadership signals import WITH a
-- visible data-quality flag instead of being excluded (ADR 0005 amendment,
-- 2026-07-02).
--
-- Philosophy change (approved): for the initial roster load, a questionable
-- management-flagged person inside People Center marked "needs review" is
-- better than that person missing. Broad out-of-scope hourly rows still
-- never import; eligibility rules are unchanged.
--
-- Adds:
--   * people.data_quality_status — 'ok' | 'needs_review'; flagged people are
--     visible in the Directory with a clear cleanup marker.
--   * people.data_quality_note — the preserved review reason(s) from the
--     import row(s).
--   * positions row 'Needs Position Review' — a PLACEHOLDER position
--     assigned when a flagged import's source position is missing/unmapped.
--     Not people_center_eligible (it is a data-quality parking spot, never
--     an eligibility trigger) and never mapped from any source vocabulary.
--     Admins reassign the real position, location, and person_kind — or
--     remove the person — during cleanup.
--   * import_rows disposition 'imported_for_review' (constraint rebuilt).
--   * import_batches.imported_for_review_count.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, guarded seed, drop-then-add
-- constraint. Safe to run twice.
-- ============================================================================

alter table public.people
  add column if not exists data_quality_status text not null default 'ok'
    check (data_quality_status in ('ok', 'needs_review'));

alter table public.people
  add column if not exists data_quality_note text;

create index if not exists people_needs_review_idx
  on public.people (data_quality_status)
  where data_quality_status = 'needs_review';

-- Placeholder for people imported with a missing or unmapped source
-- position; the real position is assigned during data-quality cleanup.
insert into public.positions
  (name, is_key_position, people_center_eligible, default_person_kind)
select 'Needs Position Review', false, false, 'manager'
where not exists (
  select 1 from public.positions p where p.name = 'Needs Position Review'
);

alter table public.import_rows
  drop constraint if exists import_rows_disposition_check;
alter table public.import_rows
  add constraint import_rows_disposition_check
  check (disposition in
    ('imported', 'imported_for_review', 'skipped_out_of_scope', 'needs_review', 'duplicate'));

alter table public.import_batches
  add column if not exists imported_for_review_count int not null default 0;

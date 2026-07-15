-- ============================================================================
-- Migration: manual_people_and_push_linking
-- Michael (2026-07-15): let HQ add people by hand — the HQ team (who live
-- outside the restaurant Push roster) and candidates not yet in any system —
-- and give a later Push sync a way to CONNECT a Push profile to the profile
-- that was created manually, instead of silently creating a duplicate.
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- Design (approved 2026-07-15, see ADR 0011):
--   * Linking is ADMIN-CONFIRMED. When a Push row's name matches a manually
--     added person who is not yet linked to the roster, the sync does NOT
--     import it — it records the row as 'possible_match' and an admin
--     Confirms the link (or Rejects it, importing the row as a new person)
--     from Data Sources.
--   * Confirming a link never overwrites leadership-entered data — it only
--     stamps the correlation key and fills an assignment if one is missing.
--     (This is the same "a re-sync never overwrites leadership-entered data"
--     rule the pipeline already follows.)
--
-- Four changes:
--
-- 1. people.status gains 'candidate' — a prospect not yet hired. Candidates
--    sit in the Directory (kept out of headcount rollups and the org chart);
--    they convert to 'incoming'/'active' when hired, and a later Push sync can
--    link them by admin confirmation like any other manual record.
--
-- 2. people.off_roster boolean — an active person who legitimately lives
--    OUTSIDE the Push roster (the HQ team). The sync never expects to see them
--    and never flags them as missing; they stay linkable if they ever do
--    appear in a future export.
--
-- 3. import_rows.disposition gains 'possible_match', and import_rows gains
--    suggested_person_id — the manually-added person this row probably is,
--    pending an admin's Confirm/Reject. person_id stays NULL until resolved,
--    so an unresolved possible_match never enters the re-sync correlation set.
--
-- 4. import_batches.possible_match_count — surfaced in the sync summary.
--
-- Idempotent: drop-then-add constraints, ADD COLUMN IF NOT EXISTS. Safe to
-- run twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. people.status gains 'candidate'
-- ---------------------------------------------------------------------------

alter table public.people_center_people
  drop constraint if exists people_status_check;
alter table public.people_center_people
  drop constraint if exists people_center_people_status_check;
alter table public.people_center_people
  add constraint people_center_people_status_check
  check (status in ('active', 'leave', 'departed', 'incoming', 'candidate'));

-- ---------------------------------------------------------------------------
-- 2. people.off_roster — HQ / off-Push-roster people
-- ---------------------------------------------------------------------------

alter table public.people_center_people
  add column if not exists off_roster boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. import_rows.disposition gains 'possible_match'; suggested_person_id
-- ---------------------------------------------------------------------------

alter table public.people_center_import_rows
  drop constraint if exists import_rows_disposition_check;
alter table public.people_center_import_rows
  drop constraint if exists people_center_import_rows_disposition_check;
alter table public.people_center_import_rows
  add constraint people_center_import_rows_disposition_check
  check (disposition in
    ('imported', 'imported_for_review', 'skipped_out_of_scope',
     'needs_review', 'duplicate', 'possible_match'));

alter table public.people_center_import_rows
  add column if not exists suggested_person_id uuid
    references public.people_center_people (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. import_batches.possible_match_count
-- ---------------------------------------------------------------------------

alter table public.people_center_import_batches
  add column if not exists possible_match_count int not null default 0;

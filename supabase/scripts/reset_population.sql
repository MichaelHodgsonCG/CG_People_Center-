-- ============================================================================
-- Script (NOT a migration): reset_population
-- Clears the imported population and sync lineage for a clean re-import.
--
-- ⚠ PRE-LAUNCH ONLY. Valid while People Center holds nothing but synced
-- roster data. Once Phase 2 ships (notes, development plans — leadership-
-- entered knowledge), this script must not be run: it would destroy real
-- data and violate the append-only rules. Corrections then go through the
-- duplicate-safe re-sync instead.
--
-- Deletes: people_center_people, people_center_position_assignments,
--          people_center_import_batches, people_center_import_rows.
-- Keeps:   org reference (people_center_concepts/regions/locations/
--          departments/positions), location/position mappings,
--          people_center_user_profiles + people_center_user_scopes,
--          people_center_audit_log (append-only, never cleared),
--          people_center_events.
-- people_center_user_profiles.person_id links are nulled automatically
-- (FK on delete set null).
--
-- Run in the Supabase SQL editor (postgres role).
-- ============================================================================

begin;

delete from public.people_center_position_assignments;
delete from public.people_center_import_rows;
delete from public.people_center_import_batches;
delete from public.people_center_people;

commit;

-- verify empty:
select
  (select count(*) from public.people_center_people)               as people,
  (select count(*) from public.people_center_position_assignments) as assignments,
  (select count(*) from public.people_center_import_batches)       as batches,
  (select count(*) from public.people_center_import_rows)          as import_rows;

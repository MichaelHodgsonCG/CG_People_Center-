-- ============================================================================
-- Migration: incoming_hires
-- Michael (2026-07-04): record signed-but-not-started hires so they appear
-- in the rosters with their start date marked.
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- Two changes:
--
-- 1. people.status gains 'incoming'. An incoming person is a real directory
--    row created ahead of Push: hire_date carries the start date, and their
--    primary assignment is future-dated. The Directory/Org Chart/Bench all
--    show them marked "incoming". When the same person later arrives in a
--    Push roster sync, the importer matches them by name and ACTIVATES the
--    existing row instead of creating a duplicate (pipeline commit stage).
--
-- 2. people INSERT widens from admin-only to admin + executive — creating
--    an incoming hire is an HQ action, consistent with the profile-editing
--    rights in 20260704160000. DELETE stays admin-only; bulk population
--    entry remains the sync pipeline.
--
-- Idempotent: drop-then-add constraint, drop-then-create policy.
-- ============================================================================

alter table public.people_center_people
  drop constraint if exists people_status_check;
alter table public.people_center_people
  drop constraint if exists people_center_people_status_check;
alter table public.people_center_people
  add constraint people_center_people_status_check
  check (status in ('active', 'leave', 'departed', 'incoming'));

drop policy if exists people_center_people_insert on public.people_center_people;
create policy people_center_people_insert on public.people_center_people
  for insert to authenticated
  with check (public.people_center_current_role() in ('admin', 'executive'));

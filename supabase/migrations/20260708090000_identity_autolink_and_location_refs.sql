-- ============================================================================
-- Migration: identity_autolink_and_location_refs
-- Identity workflow (Michael, 2026-07-04) + duplicate-data cleanup.
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- 1. Signup auto-link. people_center_handle_new_user() now links the new
--    profile to its directory person BY EMAIL at signup (citext equality;
--    people.email is unique when present; a person already linked to another
--    login is never stolen). Role keeps its existing default ('viewer' —
--    read-only). ROLE ELEVATION REMAINS A DELIBERATE ADMIN ACT: nothing in
--    signup or any sync ever grants more than viewer.
-- 2. Backfill: existing unlinked profiles get the same email match.
-- 3. Location duplication (CGOPS owns location identity): adds
--    people_center_locations.cgops_location_id referencing the CGOPS
--    platform locations table, backfilled by code/name match. People Center
--    keeps its own row (concept grouping, org-graph joins) but the link
--    makes CGOPS the master for identity — renames/additions happen in
--    CGOPS first, and this column is how the two stay reconciled.
--    Guarded: skips gracefully where public.locations doesn't exist
--    (throwaway test databases).
--
-- The people_center_user_profiles table itself is still the Phase A compat
-- layer and still dies in Phase B — this migration reduces day-to-day
-- friction (no more hand-written linkage SQL) without deepening the
-- dependency: everything here maps 1:1 onto the CGOPS profile model.
--
-- Idempotent: CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS, re-runnable
-- backfills. Safe to run twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Signup trigger: create profile AND link the directory person by email
-- ---------------------------------------------------------------------------

create or replace function public.people_center_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.people_center_user_profiles (auth_user_id, email, person_id)
  values (
    new.id,
    new.email,
    (
      select p.id
      from public.people_center_people p
      where p.email is not null
        and p.email = new.email::citext
        and p.status <> 'departed'
        and not exists (
          select 1 from public.people_center_user_profiles up
          where up.person_id = p.id
        )
      limit 1
    )
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Backfill: link existing profiles the same way
-- ---------------------------------------------------------------------------

update public.people_center_user_profiles up
set person_id = p.id
from public.people_center_people p
where up.person_id is null
  and p.email is not null
  and p.email = up.email
  and p.status <> 'departed'
  and not exists (
    select 1 from public.people_center_user_profiles up2
    where up2.person_id = p.id
  );

-- ---------------------------------------------------------------------------
-- 3. Locations: CGOPS is the master for location identity
-- ---------------------------------------------------------------------------

alter table public.people_center_locations
  add column if not exists cgops_location_id uuid;

comment on column public.people_center_locations.cgops_location_id is
  'CGOPS platform locations.id — CGOPS owns location identity. Add/rename '
  'locations in CGOPS first; this link is how the People Center copy stays '
  'reconciled until it becomes a projection.';

do $$
begin
  update public.people_center_locations pcl
  set cgops_location_id = l.id
  from public.locations l
  where pcl.cgops_location_id is null
    and (
      lower(l.code::text) = lower(pcl.code)
      or lower(l.name) = lower(pcl.name)
    );
exception
  when undefined_table or undefined_column then
    raise notice 'public.locations not found/shaped as expected — CGOPS location backfill skipped';
end $$;

-- ============================================================================
-- Migration: opening_placements (Phase 2, slice 2 — slated incumbents)
--
-- Who is slated to staff each UPCOMING restaurant's leadership roles, before it
-- opens. The New Restaurant Center's `opening_sites` are NOT in
-- people_center_locations (they have no People Center location row yet), so the
-- existing succession model (people_center_succession_slots.location_id →
-- people_center_locations) can't hold them. This dedicated planning table keys
-- placements directly to the opening_site and keeps future-planning data
-- separate from the live Bench/succession (which is about replacing CURRENT
-- incumbents).
--
--   * one row = "for this upcoming site, this role is slated to be filled by
--     this person" (person_id NULL = a planned role with nobody slated yet — a
--     lightweight gap marker).
--   * RLS mirrors people_center_succession_slots: admin/executive only, all ops
--     (this is sensitive planning data, like the Bench).
-- Idempotent: IF NOT EXISTS, drop-then-create policies.
-- ============================================================================

create table if not exists public.people_center_opening_placements (
  id uuid primary key default gen_random_uuid(),
  opening_site_id uuid not null references public.opening_sites (id) on delete cascade,
  position_id uuid not null references public.people_center_positions (id) on delete restrict,
  -- NULL = a planned role with nobody slated yet (a gap). ON DELETE SET NULL is
  -- defensive only — People Center never hard-deletes people (they go
  -- status='departed'); a departure keeps the slating intact.
  person_id uuid references public.people_center_people (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

create index if not exists people_center_opening_placements_site_idx
  on public.people_center_opening_placements (opening_site_id);

alter table public.people_center_opening_placements enable row level security;

-- admin/executive for every operation, matching the succession tables.
drop policy if exists people_center_opening_placements_select
  on public.people_center_opening_placements;
create policy people_center_opening_placements_select
  on public.people_center_opening_placements for select to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']));

drop policy if exists people_center_opening_placements_insert
  on public.people_center_opening_placements;
create policy people_center_opening_placements_insert
  on public.people_center_opening_placements for insert to authenticated
  with check (public.people_center_current_role() = any (array['admin', 'executive']));

drop policy if exists people_center_opening_placements_update
  on public.people_center_opening_placements;
create policy people_center_opening_placements_update
  on public.people_center_opening_placements for update to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));

drop policy if exists people_center_opening_placements_delete
  on public.people_center_opening_placements;
create policy people_center_opening_placements_delete
  on public.people_center_opening_placements for delete to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']));

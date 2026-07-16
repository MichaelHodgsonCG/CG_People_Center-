-- ============================================================================
-- Role requirements (Phase 3) — the "ideal restaurant" management roster: how
-- many of each role a restaurant should have. Drives the gap analysis (required
-- vs current/slated per location). One base template for now (v1); a `concept`
-- dimension can be added later for per-concept carve-outs.
--
-- Read: any authenticated user (not sensitive). Write: admin/executive, like the
-- other planning tables. Seeded with the confirmed base counts by position name.
-- Idempotent.
-- ============================================================================

create table if not exists public.people_center_role_requirements (
  position_id uuid primary key references public.people_center_positions (id) on delete cascade,
  required_count integer not null default 0 check (required_count >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

alter table public.people_center_role_requirements enable row level security;

drop policy if exists people_center_role_requirements_select on public.people_center_role_requirements;
create policy people_center_role_requirements_select
  on public.people_center_role_requirements for select to authenticated using (true);

drop policy if exists people_center_role_requirements_write on public.people_center_role_requirements;
create policy people_center_role_requirements_write
  on public.people_center_role_requirements for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));

-- Seed the confirmed base roster (by name; only the non-zero roles).
insert into public.people_center_role_requirements (position_id, required_count, updated_by_name)
select p.id, v.cnt, 'seed'
from public.people_center_positions p
join (values
  ('General Manager', 1),
  ('Chef de Cuisine', 1),
  ('Assistant General Manager', 1),
  ('Sous Chef', 2),
  ('Service Manager', 1),
  ('Beverage Manager', 1),
  ('Guest Service Manager', 1)
) as v(name, cnt) on v.name = p.name
on conflict (position_id) do nothing;

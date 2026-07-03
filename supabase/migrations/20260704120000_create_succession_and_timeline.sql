-- ============================================================================
-- Migration: create_succession_and_timeline
-- Phase 4 (part 1) — succession slots/candidates and the leadership
-- timeline's visibility rules.
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- Succession (PRODUCT_BRIEF.md §3.8, review D9):
--   * people_center_succession_slots — one row per key seat to plan for:
--     a position at EXACTLY ONE scope (location XOR region), optional
--     incumbent. Bench coverage is COMPUTED from candidates (+ readiness
--     once Phase 3 lands) — never stored, so it cannot go stale.
--   * people_center_succession_candidates — ranked people per slot;
--     unique person and unique rank per slot.
--   * Visibility: ADMINS + EXECUTIVES ONLY, reads and writes. Succession
--     standing is the most deployment-sensitive signal in the product;
--     D6 already promises people never see their own standing, and V1
--     keeps the entire surface at the executive altitude. NO person-linked
--     events are emitted for succession changes (a 'candidate added' event
--     on a person's timeline would leak standing to chain ancestors below
--     the executive level); slot-linked events carry person_id null.
--
-- Timeline (PRODUCT_BRIEF.md §3.12):
--   The per-person timeline is a projection of people_center_events, which
--   Phase 0 left admin-only. This migration widens the events SELECT policy
--   to match the chain-visibility contract (ADR 0008): admins/executives,
--   or strict ancestors of the subject — with the departed-archive gate
--   (notes rules, applied to the domain stream). Events remain pointers
--   only; relationship/restricted material never enters them (ADR 0003).
--
-- Idempotent: IF NOT EXISTS, drop-then-create policies. Safe to run twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Succession
-- ---------------------------------------------------------------------------

create table if not exists public.people_center_succession_slots (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.people_center_positions (id),
  location_id uuid references public.people_center_locations (id),
  region_id uuid references public.people_center_regions (id),
  incumbent_person_id uuid references public.people_center_people (id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  -- exactly one scope (review D9)
  constraint people_center_succession_slots_one_scope
    check (num_nonnulls(location_id, region_id) = 1)
);

create unique index if not exists people_center_succession_slots_unique_seat
  on public.people_center_succession_slots
  (position_id,
   (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
   (coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid)));

create table if not exists public.people_center_succession_candidates (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.people_center_succession_slots (id) on delete cascade,
  person_id uuid not null references public.people_center_people (id),
  rank int not null check (rank between 1 and 20),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  unique (slot_id, person_id),
  unique (slot_id, rank)
);

drop trigger if exists set_people_center_succession_slots_updated_at
  on public.people_center_succession_slots;
create trigger set_people_center_succession_slots_updated_at
  before update on public.people_center_succession_slots
  for each row execute function public.people_center_set_updated_at();

drop trigger if exists set_people_center_succession_candidates_updated_at
  on public.people_center_succession_candidates;
create trigger set_people_center_succession_candidates_updated_at
  before update on public.people_center_succession_candidates
  for each row execute function public.people_center_set_updated_at();

alter table public.people_center_succession_slots enable row level security;
alter table public.people_center_succession_candidates enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array
    ['people_center_succession_slots', 'people_center_succession_candidates']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
       using (public.people_center_current_role() in (''admin'', ''executive''))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
       with check (public.people_center_current_role() in (''admin'', ''executive''))',
      t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
       using (public.people_center_current_role() in (''admin'', ''executive''))
       with check (public.people_center_current_role() in (''admin'', ''executive''))',
      t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
       using (public.people_center_current_role() in (''admin'', ''executive''))',
      t || '_delete', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Timeline visibility — events follow the chain contract
-- ---------------------------------------------------------------------------

drop policy if exists people_center_events_select on public.people_center_events;
create policy people_center_events_select on public.people_center_events
  for select to authenticated
  using (
    -- archive gate: departed subjects are admin-only (retention policy)
    (
      public.people_center_is_admin()
      or person_id is null
      or exists (
        select 1 from public.people_center_people pp
        where pp.id = person_id and pp.status <> 'departed'
      )
    )
    and (
      public.people_center_current_role() in ('admin', 'executive')
      or (
        person_id is not null
        and public.people_center_is_above(
              public.people_center_current_person_id(), person_id)
      )
    )
  );

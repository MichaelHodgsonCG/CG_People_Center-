-- ============================================================================
-- Migration: rename_tables_people_center_prefix
-- Migration-readiness — prefix every People Center-owned database object
-- with people_center_ so the project can later lift-and-shift into the
-- CGOPS Platform Supabase project without name collisions.
--
-- Scope (approved 2026-07-02): rename only. No schema redesign, no data
-- changes, no policy-logic changes, no auth changes. The application is
-- updated in the same commit to reference the new names.
--
-- What renames:
--   * All 15 People Center tables → people_center_<table>.
--       ALTER TABLE ... RENAME preserves data, PKs, FKs, indexes, triggers,
--       and policies — they follow the table.
--   * Helper functions → people_center_<function>. Policies and triggers
--       reference functions by OID, so ALTER FUNCTION ... RENAME does not
--       break them. The CGOPS project defines its own is_admin(); the
--       prefix removes that collision.
--   * Function BODIES that name tables (is_admin, current_person_id,
--       handle_new_user) are recreated against the new table names —
--       sql/plpgsql bodies are stored as text and parse at call time, so
--       without this they would fail at runtime after the table rename.
--   * The signup trigger on auth.users → people_center_on_auth_user_created
--       (the trigger is People Center-owned even though auth.users is not;
--       trigger names are per-table, so a CGOPS trigger of the same name
--       would collide on merge).
--   * Hardening sweep (dynamic): every remaining index, constraint,
--       trigger, and policy on the renamed tables gains the people_center_
--       prefix. Index and constraint-backing-index names are schema-wide
--       in Postgres, so these WOULD collide with CGOPS objects
--       (e.g. audit_log_pkey) even after the tables themselves are unique.
--
-- What does NOT rename:
--   * Supabase Auth / system schemas (auth.*, storage.*, extensions).
--   * Column names (people_center_eligible etc. are columns, not tables).
--   * The citext extension.
--
-- Idempotent: every rename is guarded (to_regclass / catalog checks / the
-- dynamic sweeps only touch names missing the prefix). Safe to run twice.
-- Note for fresh databases: earlier migrations still create the tables
-- under their original names; this migration then renames them — filename
-- order must be preserved.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_profiles',
    'user_scopes',
    'audit_log',
    'events',
    'concepts',
    'regions',
    'departments',
    'locations',
    'positions',
    'people',
    'position_assignments',
    'location_mappings',
    'position_mappings',
    'import_batches',
    'import_rows'
  ]
  loop
    if to_regclass(format('public.%I', t)) is not null
       and to_regclass(format('public.%I', 'people_center_' || t)) is null then
      execute format('alter table public.%I rename to %I', t, 'people_center_' || t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Functions — rename (OID-preserving, policies/triggers keep working),
--    then recreate bodies that reference renamed tables.
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'is_admin',
    'current_person_id',
    'set_updated_at',
    'handle_new_user'
  ]
  loop
    if exists (
         select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = f
       )
       and not exists (
         select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'people_center_' || f
       ) then
      execute format('alter function public.%I() rename to %I', f, 'people_center_' || f);
    end if;
  end loop;
end;
$$;

-- Recreate bodies against the renamed tables (create or replace is
-- idempotent and also covers a fresh database where the loop above renamed
-- the originals).

create or replace function public.people_center_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.people_center_user_profiles
    where auth_user_id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.people_center_current_person_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select person_id
  from public.people_center_user_profiles
  where auth_user_id = auth.uid();
$$;

create or replace function public.people_center_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.people_center_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.people_center_user_profiles (auth_user_id, email)
  values (new.id, new.email)
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The People Center-owned trigger on auth.users
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created'
  ) then
    alter trigger on_auth_user_created on auth.users
      rename to people_center_on_auth_user_created;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Hardening sweep — constraints, indexes, triggers, policies on the
--    renamed tables. Constraints first: renaming a PK/UNIQUE constraint
--    renames its backing index with it; the index pass then catches the
--    plain (non-constraint) indexes.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  obj record;
begin
  foreach t in array array[
    'people_center_user_profiles',
    'people_center_user_scopes',
    'people_center_audit_log',
    'people_center_events',
    'people_center_concepts',
    'people_center_regions',
    'people_center_departments',
    'people_center_locations',
    'people_center_positions',
    'people_center_people',
    'people_center_position_assignments',
    'people_center_location_mappings',
    'people_center_position_mappings',
    'people_center_import_batches',
    'people_center_import_rows'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    -- constraints (PK, FK, UNIQUE, CHECK)
    for obj in
      select conname
      from pg_constraint
      where conrelid = format('public.%I', t)::regclass
        and conname !~ '^people_center_'
    loop
      execute format(
        'alter table public.%I rename constraint %I to %I',
        t, obj.conname, 'people_center_' || obj.conname);
    end loop;

    -- remaining indexes (constraint-backed ones were renamed above)
    for obj in
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = t
        and indexname !~ '^people_center_'
    loop
      execute format(
        'alter index public.%I rename to %I',
        obj.indexname, 'people_center_' || obj.indexname);
    end loop;

    -- triggers
    for obj in
      select tgname
      from pg_trigger
      where tgrelid = format('public.%I', t)::regclass
        and not tgisinternal
        and tgname !~ '^people_center_'
    loop
      execute format(
        'alter trigger %I on public.%I rename to %I',
        obj.tgname, t, 'people_center_' || obj.tgname);
    end loop;

    -- policies
    for obj in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname !~ '^people_center_'
    loop
      execute format(
        'alter policy %I on public.%I rename to %I',
        obj.policyname, t, 'people_center_' || obj.policyname);
    end loop;
  end loop;
end;
$$;

-- No sequences exist (all keys are uuid via gen_random_uuid()); no views,
-- no materialized views, no publications are defined by this project.

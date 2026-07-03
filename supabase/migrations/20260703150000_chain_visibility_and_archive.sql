-- ============================================================================
-- Migration: chain_visibility_and_archive
-- ADR 0008 steps 2–4 — chain-down note visibility + retention/archive
-- machinery (NOTE_RETENTION_POLICY.md v1).
--
-- ⚠ Apply to the CGOPS Platform Supabase project, AFTER
-- org_graph_bootstrap (data before enforcement).
--
-- Visibility (supersedes the role-ladder reading rules of ADR 0007):
--   A note about X is readable only by people STRICTLY ABOVE X in the
--   reporting chain — never peers, never below, never X themselves. The
--   author always reads their own notes. Tiers narrow which ancestors:
--     leadership — any strict ancestor (+ admins/executives, who sit at the
--                  top of the chain by definition)
--     hq         — admins/executives only (all relationship notes are here)
--     restricted — author + admins + executives (via audited function only)
--
-- Retention/archive:
--   * people.departed_on — stamped automatically when status → 'departed'.
--   * Archived = subject departed: notes readable by ADMINS ONLY (all
--     tiers, authors included), enforced here and in both audited functions.
--   * people_center_purge_relationship_notes(person) — the on-request purge
--     (any time, any status); admin-only, audited, returns count.
--   * people_center_purge_archived_notes(person) — the five-year purge;
--     admin-only, refuses unless departed_on <= today - 5 years; audited.
--   Purges are the sole exception to append-only; clients still have no
--   DELETE policy — deletion happens only inside these definer functions.
--
-- Idempotent: CREATE OR REPLACE, drop-then-create policies, guarded ALTERs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- departed_on
-- ---------------------------------------------------------------------------

alter table public.people_center_people
  add column if not exists departed_on date;

create or replace function public.people_center_stamp_departed_on()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'departed' and old.status is distinct from 'departed' then
    new.departed_on = coalesce(new.departed_on, current_date);
  end if;
  if new.status <> 'departed' then
    new.departed_on = null;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_people_center_departed_on on public.people_center_people;
create trigger stamp_people_center_departed_on
  before update on public.people_center_people
  for each row execute function public.people_center_stamp_departed_on();

-- ---------------------------------------------------------------------------
-- Chain helper — recursive, depth-bounded (cycle-safe)
-- ---------------------------------------------------------------------------

create or replace function public.people_center_is_above(p_viewer uuid, p_subject uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with recursive chain as (
    select p.manager_person_id as anc, 1 as depth
    from public.people_center_people p
    where p.id = p_subject
    union all
    select p.manager_person_id, c.depth + 1
    from chain c
    join public.people_center_people p on p.id = c.anc
    where c.anc is not null and c.depth < 20
  )
  select p_viewer is not null
     and p_subject is not null
     and p_viewer is distinct from p_subject
     and exists (select 1 from chain where anc = p_viewer);
$$;

grant execute on function public.people_center_is_above(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Notes SELECT policy — chain-down + archive gate
-- ---------------------------------------------------------------------------

drop policy if exists people_center_notes_select on public.people_center_notes;
create policy people_center_notes_select on public.people_center_notes
  for select to authenticated
  using (
    -- Archive gate: notes about departed people are admin-only, full stop.
    (
      public.people_center_is_admin()
      or exists (
        select 1 from public.people_center_people pp
        where pp.id = person_id and pp.status <> 'departed'
      )
    )
    and (
      author_auth_uid = auth.uid()
      or (
        person_id is distinct from public.people_center_current_person_id()
        and category in ('leadership', 'development')
        and (
          (visibility = 'leadership'
            and (
              public.people_center_current_role() in ('admin', 'executive')
              or public.people_center_is_above(
                   public.people_center_current_person_id(), person_id)
            ))
          or (visibility = 'hq'
            and public.people_center_current_role() in ('admin', 'executive'))
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Audited functions — archive gate added (definitions otherwise per ADR 0007)
-- ---------------------------------------------------------------------------

create or replace function public.people_center_get_relationship_notes(p_person_id uuid)
returns setof public.people_center_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.people_center_current_role();
  v_self boolean := p_person_id is not distinct from public.people_center_current_person_id();
  v_departed boolean := exists (
    select 1 from public.people_center_people
    where id = p_person_id and status = 'departed');
begin
  -- Archived (departed) people: admins only — authors included.
  if v_departed and v_role is distinct from 'admin' then
    return;
  end if;
  if v_self or v_role is null or v_role not in ('admin', 'executive') then
    return query
      select * from public.people_center_notes
      where person_id = p_person_id and category = 'relationship'
        and author_auth_uid = auth.uid()
      order by noted_on desc, created_at desc;
    return;
  end if;

  insert into public.people_center_audit_log
    (actor_person_id, actor_auth_uid, actor_name, action,
     entity_type, entity_id, entity_label, summary)
  select
    public.people_center_current_person_id(), auth.uid(),
    coalesce(
      (select coalesce(display_name, email::text)
       from public.people_center_user_profiles where auth_user_id = auth.uid()),
      (select email from auth.users where id = auth.uid()),
      'unknown'),
    'view', 'person_relationship_panel', p_person_id,
    (select full_name from public.people_center_people where id = p_person_id),
    'Viewed relationship notes panel';

  return query
    select * from public.people_center_notes
    where person_id = p_person_id
      and category = 'relationship'
      and visibility = 'hq'
    order by noted_on desc, created_at desc;
end;
$$;

create or replace function public.people_center_get_restricted_notes(p_person_id uuid)
returns setof public.people_center_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.people_center_current_role();
  v_self boolean := p_person_id is not distinct from public.people_center_current_person_id();
  v_departed boolean := exists (
    select 1 from public.people_center_people
    where id = p_person_id and status = 'departed');
begin
  if v_departed and v_role is distinct from 'admin' then
    return;
  end if;
  if v_self or v_role is null or v_role not in ('admin', 'executive') then
    return query
      select * from public.people_center_notes
      where person_id = p_person_id and visibility = 'restricted'
        and author_auth_uid = auth.uid()
      order by noted_on desc, created_at desc;
    return;
  end if;

  insert into public.people_center_audit_log
    (actor_person_id, actor_auth_uid, actor_name, action,
     entity_type, entity_id, entity_label, summary)
  select
    public.people_center_current_person_id(), auth.uid(),
    coalesce(
      (select coalesce(display_name, email::text)
       from public.people_center_user_profiles where auth_user_id = auth.uid()),
      (select email from auth.users where id = auth.uid()),
      'unknown'),
    'view', 'person_restricted_notes', p_person_id,
    (select full_name from public.people_center_people where id = p_person_id),
    'Viewed restricted notes';

  return query
    select * from public.people_center_notes
    where person_id = p_person_id
      and visibility = 'restricted'
    order by noted_on desc, created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Purge functions (retention policy) — admin-only, audited, count-returning
-- ---------------------------------------------------------------------------

create or replace function public.people_center_purge_relationship_notes(p_person_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_name text;
begin
  if not public.people_center_is_admin() then
    raise exception 'Only admins may purge notes';
  end if;
  select full_name into v_name from public.people_center_people where id = p_person_id;

  delete from public.people_center_notes
  where person_id = p_person_id and category = 'relationship';
  get diagnostics v_count = row_count;

  insert into public.people_center_audit_log
    (actor_person_id, actor_auth_uid, actor_name, action,
     entity_type, entity_id, entity_label, summary)
  values (
    public.people_center_current_person_id(), auth.uid(),
    coalesce(
      (select coalesce(display_name, email::text)
       from public.people_center_user_profiles where auth_user_id = auth.uid()),
      (select email from auth.users where id = auth.uid()),
      'unknown'),
    'delete', 'person_relationship_notes', p_person_id, v_name,
    format('Purged %s relationship note(s) on subject request', v_count));
  return v_count;
end;
$$;

create or replace function public.people_center_purge_archived_notes(p_person_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_name text;
  v_departed_on date;
begin
  if not public.people_center_is_admin() then
    raise exception 'Only admins may purge notes';
  end if;
  select full_name, departed_on into v_name, v_departed_on
  from public.people_center_people where id = p_person_id and status = 'departed';
  if v_name is null then
    raise exception 'Person is not departed — archived purge does not apply';
  end if;
  if v_departed_on is null or v_departed_on > current_date - interval '5 years' then
    raise exception 'Retention hold: five years from departure (%) not yet elapsed', v_departed_on;
  end if;

  delete from public.people_center_notes where person_id = p_person_id;
  get diagnostics v_count = row_count;

  insert into public.people_center_audit_log
    (actor_person_id, actor_auth_uid, actor_name, action,
     entity_type, entity_id, entity_label, summary)
  values (
    public.people_center_current_person_id(), auth.uid(),
    coalesce(
      (select coalesce(display_name, email::text)
       from public.people_center_user_profiles where auth_user_id = auth.uid()),
      (select email from auth.users where id = auth.uid()),
      'unknown'),
    'delete', 'person_archived_notes', p_person_id, v_name,
    format('Purged %s archived note(s) after five-year hold (departed %s)', v_count, v_departed_on));
  return v_count;
end;
$$;

grant execute on function public.people_center_purge_relationship_notes(uuid) to authenticated;
grant execute on function public.people_center_purge_archived_notes(uuid) to authenticated;

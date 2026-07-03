-- ============================================================================
-- Migration: create_suggestions
-- Lightweight in-app suggestion box (requested for the VP People & Culture
-- review, 2026-07-03): any People Center role holder can submit a
-- suggestion from the header; admins triage with a status.
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- Deliberately simple: not notes (no person subject, no sensitivity tiers),
-- not audit material beyond the standard mutation records the app writes.
-- Authors see their own suggestions; admins see and triage all of them.
--
-- Idempotent: IF NOT EXISTS, drop-then-create policies.
-- ============================================================================

create table if not exists public.people_center_suggestions (
  id uuid primary key default gen_random_uuid(),
  body text not null check (length(trim(body)) > 0),
  page_context text,               -- where in the app it was raised (view name)
  status text not null default 'new'
    check (status in ('new', 'reviewed', 'planned', 'done', 'dismissed')),
  admin_response text,
  author_auth_uid uuid not null default auth.uid(),
  author_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text
);

create index if not exists people_center_suggestions_status_idx
  on public.people_center_suggestions (status, created_at desc);

drop trigger if exists set_people_center_suggestions_updated_at
  on public.people_center_suggestions;
create trigger set_people_center_suggestions_updated_at
  before update on public.people_center_suggestions
  for each row execute function public.people_center_set_updated_at();

alter table public.people_center_suggestions enable row level security;

drop policy if exists people_center_suggestions_insert on public.people_center_suggestions;
create policy people_center_suggestions_insert on public.people_center_suggestions
  for insert to authenticated
  with check (
    public.people_center_has_app_access()
    and author_auth_uid = auth.uid()
  );

drop policy if exists people_center_suggestions_select on public.people_center_suggestions;
create policy people_center_suggestions_select on public.people_center_suggestions
  for select to authenticated
  using (
    author_auth_uid = auth.uid()
    or public.people_center_is_admin()
  );

drop policy if exists people_center_suggestions_update on public.people_center_suggestions;
create policy people_center_suggestions_update on public.people_center_suggestions
  for update to authenticated
  using (public.people_center_is_admin())
  with check (public.people_center_is_admin());
-- no DELETE policy: dismissed is a status, not a deletion.

-- ============================================================================
-- Migration: create_development_paths
-- Phase 3 (part 1) — development path templates and per-person assessments
-- (ADR 0010).
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- CG already runs quarterly development paths for every management role as
-- Excel workbooks (one sheet per role; sections of items scored 0–3 per
-- quarter). People Center becomes the system of record for the RESULTS
-- while Excel remains the capture tool for now:
--
--   * people_center_dev_path_templates — one per management role. The
--     master workbook syncs these; questions evolve over time.
--   * people_center_dev_path_sections — the section headings within a
--     template (optionally grouped under a phase, e.g. the Chef de Cuisine
--     path's four phases).
--   * people_center_dev_path_items — the individual scored statements.
--     Items are VERSIONED BY TEXT: re-syncing a revised master matches
--     items by normalized prompt; new wording appends a new item and the
--     old one is deactivated (never deleted), so historical scores keep
--     pointing at the exact question that was asked.
--   * people_center_dev_assessments — one filled path per person per
--     period (a manager's tab in a location workbook).
--   * people_center_dev_scores — item × quarter × 0–3 score.
--   * people_center_dev_section_notes — the free-text NOTES row captured
--     per section, per assessment.
--
-- Visibility (chain contract, ADR 0008): assessment data is readable by
-- admins/executives and STRICT ANCESTORS of the subject — same rule as
-- leadership notes; people do not browse their own scores in V1 (self
-- capture arrives with the in-app feedback phase). Templates themselves
-- carry no personal data and are readable by anyone with app access.
-- Writes are admin + executive (imports run from Data Sources).
--
-- Idempotent: IF NOT EXISTS, drop-then-create policies. Safe to run twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Templates (the framework — no personal data)
-- ---------------------------------------------------------------------------

create table if not exists public.people_center_dev_path_templates (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique, -- normalized slug of the role title
  title text not null,           -- 'Chef de Cuisine'
  sheet_title text,              -- workbook heading, used to match filled tabs
  position_id uuid references public.people_center_positions (id),
  purpose text,
  updated_note text,             -- e.g. 'Updated Jan F26 - Riley'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text
);

create table if not exists public.people_center_dev_path_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null
    references public.people_center_dev_path_templates (id) on delete cascade,
  phase text,                    -- 'PHASE ONE - …' or null for flat paths
  title text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists people_center_dev_path_sections_template_idx
  on public.people_center_dev_path_sections (template_id);

create table if not exists public.people_center_dev_path_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null
    references public.people_center_dev_path_sections (id) on delete cascade,
  prompt text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

create index if not exists people_center_dev_path_items_section_idx
  on public.people_center_dev_path_items (section_id);

-- ---------------------------------------------------------------------------
-- Assessments (per-person results)
-- ---------------------------------------------------------------------------

create table if not exists public.people_center_dev_assessments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null
    references public.people_center_people (id) on delete cascade,
  template_id uuid not null
    references public.people_center_dev_path_templates (id),
  period_label text not null,    -- fiscal year the workbook covers, e.g. 'F26'
  restaurant text,               -- as written on the sheet
  trainer_name text,             -- 'Training Chef' / assessing manager
  source_file text,
  source_tab text,
  imported_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, template_id, period_label)
);

create index if not exists people_center_dev_assessments_person_idx
  on public.people_center_dev_assessments (person_id);

create table if not exists public.people_center_dev_scores (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null
    references public.people_center_dev_assessments (id) on delete cascade,
  item_id uuid not null
    references public.people_center_dev_path_items (id) on delete cascade,
  quarter smallint not null check (quarter between 1 and 4),
  score smallint not null check (score between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, item_id, quarter)
);

create index if not exists people_center_dev_scores_assessment_idx
  on public.people_center_dev_scores (assessment_id);

create table if not exists public.people_center_dev_section_notes (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null
    references public.people_center_dev_assessments (id) on delete cascade,
  section_id uuid not null
    references public.people_center_dev_path_sections (id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, section_id)
);

-- updated_at maintenance (helper exists since Phase 0)
drop trigger if exists set_people_center_dev_path_templates_updated_at
  on public.people_center_dev_path_templates;
create trigger set_people_center_dev_path_templates_updated_at
  before update on public.people_center_dev_path_templates
  for each row execute function public.people_center_set_updated_at();

drop trigger if exists set_people_center_dev_path_sections_updated_at
  on public.people_center_dev_path_sections;
create trigger set_people_center_dev_path_sections_updated_at
  before update on public.people_center_dev_path_sections
  for each row execute function public.people_center_set_updated_at();

drop trigger if exists set_people_center_dev_assessments_updated_at
  on public.people_center_dev_assessments;
create trigger set_people_center_dev_assessments_updated_at
  before update on public.people_center_dev_assessments
  for each row execute function public.people_center_set_updated_at();

drop trigger if exists set_people_center_dev_scores_updated_at
  on public.people_center_dev_scores;
create trigger set_people_center_dev_scores_updated_at
  before update on public.people_center_dev_scores
  for each row execute function public.people_center_set_updated_at();

drop trigger if exists set_people_center_dev_section_notes_updated_at
  on public.people_center_dev_section_notes;
create trigger set_people_center_dev_section_notes_updated_at
  before update on public.people_center_dev_section_notes
  for each row execute function public.people_center_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.people_center_dev_path_templates enable row level security;
alter table public.people_center_dev_path_sections enable row level security;
alter table public.people_center_dev_path_items enable row level security;
alter table public.people_center_dev_assessments enable row level security;
alter table public.people_center_dev_scores enable row level security;
alter table public.people_center_dev_section_notes enable row level security;

-- Templates: framework only — readable with app access, written by
-- admin/executive (template sync + future in-app question editing).
drop policy if exists people_center_dev_path_templates_select
  on public.people_center_dev_path_templates;
create policy people_center_dev_path_templates_select
  on public.people_center_dev_path_templates
  for select to authenticated
  using (public.people_center_has_app_access());

drop policy if exists people_center_dev_path_templates_write
  on public.people_center_dev_path_templates;
create policy people_center_dev_path_templates_write
  on public.people_center_dev_path_templates
  for all to authenticated
  using (public.people_center_current_role() in ('admin', 'executive'))
  with check (public.people_center_current_role() in ('admin', 'executive'));

drop policy if exists people_center_dev_path_sections_select
  on public.people_center_dev_path_sections;
create policy people_center_dev_path_sections_select
  on public.people_center_dev_path_sections
  for select to authenticated
  using (public.people_center_has_app_access());

drop policy if exists people_center_dev_path_sections_write
  on public.people_center_dev_path_sections;
create policy people_center_dev_path_sections_write
  on public.people_center_dev_path_sections
  for all to authenticated
  using (public.people_center_current_role() in ('admin', 'executive'))
  with check (public.people_center_current_role() in ('admin', 'executive'));

drop policy if exists people_center_dev_path_items_select
  on public.people_center_dev_path_items;
create policy people_center_dev_path_items_select
  on public.people_center_dev_path_items
  for select to authenticated
  using (public.people_center_has_app_access());

drop policy if exists people_center_dev_path_items_write
  on public.people_center_dev_path_items;
create policy people_center_dev_path_items_write
  on public.people_center_dev_path_items
  for all to authenticated
  using (public.people_center_current_role() in ('admin', 'executive'))
  with check (public.people_center_current_role() in ('admin', 'executive'));

-- Assessments: chain contract — admin/executive, or a strict ancestor of
-- the subject. Same shape as the notes SELECT policy (ADR 0008); subjects
-- do not read their own standing in V1.
drop policy if exists people_center_dev_assessments_select
  on public.people_center_dev_assessments;
create policy people_center_dev_assessments_select
  on public.people_center_dev_assessments
  for select to authenticated
  using (
    public.people_center_current_role() in ('admin', 'executive')
    or public.people_center_is_above(
         public.people_center_current_person_id(), person_id)
  );

drop policy if exists people_center_dev_assessments_write
  on public.people_center_dev_assessments;
create policy people_center_dev_assessments_write
  on public.people_center_dev_assessments
  for all to authenticated
  using (public.people_center_current_role() in ('admin', 'executive'))
  with check (public.people_center_current_role() in ('admin', 'executive'));

drop policy if exists people_center_dev_scores_select
  on public.people_center_dev_scores;
create policy people_center_dev_scores_select
  on public.people_center_dev_scores
  for select to authenticated
  using (
    exists (
      select 1 from public.people_center_dev_assessments a
      where a.id = assessment_id
        and (
          public.people_center_current_role() in ('admin', 'executive')
          or public.people_center_is_above(
               public.people_center_current_person_id(), a.person_id)
        )
    )
  );

drop policy if exists people_center_dev_scores_write
  on public.people_center_dev_scores;
create policy people_center_dev_scores_write
  on public.people_center_dev_scores
  for all to authenticated
  using (public.people_center_current_role() in ('admin', 'executive'))
  with check (public.people_center_current_role() in ('admin', 'executive'));

drop policy if exists people_center_dev_section_notes_select
  on public.people_center_dev_section_notes;
create policy people_center_dev_section_notes_select
  on public.people_center_dev_section_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.people_center_dev_assessments a
      where a.id = assessment_id
        and (
          public.people_center_current_role() in ('admin', 'executive')
          or public.people_center_is_above(
               public.people_center_current_person_id(), a.person_id)
        )
    )
  );

drop policy if exists people_center_dev_section_notes_write
  on public.people_center_dev_section_notes;
create policy people_center_dev_section_notes_write
  on public.people_center_dev_section_notes
  for all to authenticated
  using (public.people_center_current_role() in ('admin', 'executive'))
  with check (public.people_center_current_role() in ('admin', 'executive'));

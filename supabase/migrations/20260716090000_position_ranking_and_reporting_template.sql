-- ============================================================================
-- Migration: position_ranking_and_reporting_template
-- Michael (2026-07-16): encode the restaurant management hierarchy so the org
-- chart, future view, and gap analysis all share one ranking (Item 1b).
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- Confirmed rules:
--   * level: lower = more senior.
--   * AGM sits below Chef de Cuisine and above the service managers; reports
--     to the GM.
--   * Front-of-house Supervisors report to the GM by default (manager on
--     duty), no fixed accountabilities unless set manually.
--   * Kitchen ladder: Chef de Cuisine > Senior Sous Chef > Sous Chef >
--     Chef de Partie.
--
-- Adds:
--   * people_center_positions.default_reports_to_position_id — the ideal
--     within-restaurant reporting line for a position (a template default;
--     the actual per-person manager still lives on people.manager_person_id).
--   * Senior Sous Chef position (key kitchen role; local until linked to the
--     CGOPS "Sous Chef - Senior" master).
--   * level + default_reports_to for the restaurant management + key roles.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, guarded insert, value-keyed updates.
-- ============================================================================

alter table public.people_center_positions
  add column if not exists default_reports_to_position_id uuid
    references public.people_center_positions (id);

insert into public.people_center_positions
  (name, is_key_position, people_center_eligible, default_person_kind, show_in_people_center)
select 'Senior Sous Chef', false, false, 'manager', true
where not exists (select 1 from public.people_center_positions where name = 'Senior Sous Chef');

update public.people_center_positions p set level = v.lvl
from (values
  ('General Manager', 10),
  ('General Manager in Training', 15),
  ('Chef de Cuisine', 20),
  ('Assistant General Manager', 25),
  ('Beverage Manager', 30),
  ('Service Manager', 30),
  ('Guest Service Manager', 30),
  ('Events Manager', 30),
  ('Senior Sous Chef', 35),
  ('Sous Chef', 40),
  ('Supervisor', 45),
  ('Chef de Partie', 50)
) as v(name, lvl)
where p.name = v.name;

update public.people_center_positions p
set default_reports_to_position_id = mgr.id
from (values
  ('General Manager in Training', 'General Manager'),
  ('Chef de Cuisine', 'General Manager'),
  ('Assistant General Manager', 'General Manager'),
  ('Beverage Manager', 'General Manager'),
  ('Service Manager', 'General Manager'),
  ('Guest Service Manager', 'General Manager'),
  ('Events Manager', 'General Manager'),
  ('Senior Sous Chef', 'Chef de Cuisine'),
  ('Sous Chef', 'Chef de Cuisine'),
  ('Chef de Partie', 'Sous Chef'),
  ('Supervisor', 'General Manager')
) as v(pos, mgr_name)
join public.people_center_positions mgr on mgr.name = v.mgr_name
where p.name = v.pos;

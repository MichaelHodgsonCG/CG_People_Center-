-- ============================================================================
-- Migration: org_graph_bootstrap
-- ADR 0008 step 1 — build the unified leadership graph in
-- people_center_people.manager_person_id, rooted at the CEO.
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- Source of truth: CG HQ & Operations org chart (updated January 2026) +
-- Michael's confirmations (2026-07-03):
--   * Jody Palubiski (CEO) at the top.
--   * John Mackay (President, Beertown & Sociable) → CEO; the five
--     Beertown/Sociable regional operations leaders report to John.
--   * Cindy Fawcett (regional operations leader) covers The Bauer Kitchen,
--     Sole, and Wildcraft, reporting DIRECTLY to the CEO for now.
--   * Megan Stover (VP People + Culture) → CEO (People Center stakeholder).
--   * Regional coverage: Tami Emuss — Sociable Kitchen Tavern, Beertown
--     Oakville/Cambridge/Guelph; Chris Richards — Beertown London
--     (Masonville), Beertown London White Oaks, Beertown Waterloo; Camilla
--     Johnson — Beertown Newmarket/Whitby; Caitlin O'Leary — Beertown
--     Barrie/Toronto; Danny Walker — Beertown Etobicoke/Burlington.
--
-- In-location ladder (restaurant org chart template, confirmed):
--   GM → regional leader; Head Chef → GM; Sous Chef → Head Chef;
--   Chef de Partie → Head Chef (the chart shows CdP → Sous, but locations
--   have multiple sous chefs and the source data cannot say WHICH sous —
--   Head Chef is the accountable default; admins refine per person in the
--   panel); AGM / GM in Training / Beverage / Service / Guest Service /
--   Events Managers / Supervisors / 'Needs Position Review' → GM.
--   Supervisors operationally report to the manager on duty; the GM is
--   their accountable chain anchor (Michael, 2026-07-03).
--   Fallbacks: no GM at the location → the regional leader; no current
--   primary assignment → left null (flagged people; admin sets manually).
--
-- Idempotent and non-clobbering: HQ inserts are guarded by full_name;
-- manager_person_id is only ever set WHERE IT IS NULL — re-running never
-- overwrites admin corrections.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. HQ layer (ops chain + VP People & Culture)
-- ---------------------------------------------------------------------------

insert into public.people_center_people (full_name, preferred_name, person_kind, status, updated_by_name)
select v.full_name, v.preferred_name, 'manager', 'active', 'org bootstrap'
from (values
  ('Jody Palubiski',   'Jody'),
  ('John Mackay',      'John'),
  ('Megan Stover',     'Megan'),
  ('Cindy Fawcett',    'Cindy'),
  ('Tami Emuss',       'Tami'),
  ('Chris Richards',   'Chris'),
  ('Camilla Johnson',  'Camilla'),
  ('Caitlin O''Leary', 'Caitlin'),
  ('Danny Walker',     'Danny')
) as v (full_name, preferred_name)
where not exists (
  select 1 from public.people_center_people p where p.full_name = v.full_name
);

-- HQ reporting lines (null-guarded)
update public.people_center_people p
set manager_person_id = ceo.id, updated_by_name = 'org bootstrap'
from public.people_center_people ceo
where ceo.full_name = 'Jody Palubiski'
  and p.full_name in ('John Mackay', 'Megan Stover', 'Cindy Fawcett')
  and p.manager_person_id is null;

update public.people_center_people p
set manager_person_id = pres.id, updated_by_name = 'org bootstrap'
from public.people_center_people pres
where pres.full_name = 'John Mackay'
  and p.full_name in
    ('Tami Emuss', 'Chris Richards', 'Camilla Johnson', 'Caitlin O''Leary', 'Danny Walker')
  and p.manager_person_id is null;

-- ---------------------------------------------------------------------------
-- 2. Derived in-location lines
-- ---------------------------------------------------------------------------

do $$
begin
  -- Per-location leadership lookup: regional leader, GM, Head Chef
  create temp table _loc_leads on commit drop as
  with regional as (
    select l.id as location_id, p.id as regional_id
    from public.people_center_locations l
    join (values
      ('Sociable Kitchen Tavern',     'Tami Emuss'),
      ('Beertown Oakville',           'Tami Emuss'),
      ('Beertown Cambridge',          'Tami Emuss'),
      ('Beertown Guelph',             'Tami Emuss'),
      ('Beertown London',             'Chris Richards'),
      ('Beertown London White Oaks',  'Chris Richards'),
      ('Beertown Waterloo',           'Chris Richards'),
      ('Beertown Newmarket',          'Camilla Johnson'),
      ('Beertown Whitby',             'Camilla Johnson'),
      ('Beertown Barrie',             'Caitlin O''Leary'),
      ('Beertown Toronto',            'Caitlin O''Leary'),
      ('Beertown Etobicoke',          'Danny Walker'),
      ('Beertown Burlington',         'Danny Walker'),
      ('The Bauer Kitchen',           'Cindy Fawcett'),
      ('Sole',                        'Cindy Fawcett'),
      ('Wildcraft',                   'Cindy Fawcett')
    ) as m (location_name, leader_name) on m.location_name = l.name
    join public.people_center_people p on p.full_name = m.leader_name
  ),
  pa as (
    select a.person_id, a.location_id, pos.name as position_name
    from public.people_center_position_assignments a
    join public.people_center_positions pos on pos.id = a.position_id
    where a.is_primary and a.ended_on is null
  ),
  gm as (
    select location_id, min(person_id::text)::uuid as gm_id
    from pa where position_name = 'General Manager' group by location_id
  ),
  hc as (
    select location_id, min(person_id::text)::uuid as hc_id
    from pa where position_name = 'Head Chef' group by location_id
  )
  select r.location_id, r.regional_id, gm.gm_id, hc.hc_id
  from regional r
  left join gm on gm.location_id = r.location_id
  left join hc on hc.location_id = r.location_id;

  -- 2a. GMs → regional leader
  update public.people_center_people p
  set manager_person_id = ll.regional_id, updated_by_name = 'org bootstrap'
  from public.people_center_position_assignments a
  join public.people_center_positions pos on pos.id = a.position_id
  join _loc_leads ll on ll.location_id = a.location_id
  where a.person_id = p.id and a.is_primary and a.ended_on is null
    and pos.name = 'General Manager'
    and p.manager_person_id is null
    and ll.regional_id is distinct from p.id;

  -- 2b. Head Chefs → GM (fallback regional)
  update public.people_center_people p
  set manager_person_id = coalesce(ll.gm_id, ll.regional_id), updated_by_name = 'org bootstrap'
  from public.people_center_position_assignments a
  join public.people_center_positions pos on pos.id = a.position_id
  join _loc_leads ll on ll.location_id = a.location_id
  where a.person_id = p.id and a.is_primary and a.ended_on is null
    and pos.name = 'Head Chef'
    and p.manager_person_id is null
    and coalesce(ll.gm_id, ll.regional_id) is distinct from p.id;

  -- 2c. Sous Chefs and Chefs de Partie → Head Chef (fallback GM, regional)
  update public.people_center_people p
  set manager_person_id = coalesce(ll.hc_id, ll.gm_id, ll.regional_id), updated_by_name = 'org bootstrap'
  from public.people_center_position_assignments a
  join public.people_center_positions pos on pos.id = a.position_id
  join _loc_leads ll on ll.location_id = a.location_id
  where a.person_id = p.id and a.is_primary and a.ended_on is null
    and pos.name in ('Sous Chef', 'Chef de Partie')
    and p.manager_person_id is null
    and coalesce(ll.hc_id, ll.gm_id, ll.regional_id) is distinct from p.id;

  -- 2d. Everyone else at a location → GM (fallback regional)
  update public.people_center_people p
  set manager_person_id = coalesce(ll.gm_id, ll.regional_id), updated_by_name = 'org bootstrap'
  from public.people_center_position_assignments a
  join public.people_center_positions pos on pos.id = a.position_id
  join _loc_leads ll on ll.location_id = a.location_id
  where a.person_id = p.id and a.is_primary and a.ended_on is null
    and pos.name in
      ('Assistant General Manager', 'General Manager in Training',
       'Beverage Manager', 'Service Manager', 'Guest Service Manager',
       'Events Manager', 'Supervisor', 'Needs Position Review')
    and p.manager_person_id is null
    and coalesce(ll.gm_id, ll.regional_id) is distinct from p.id;
end;
$$;

# People Center — Handover

Snapshot for continuing this work in a fresh session. Pair with `PROJECT-LOG.md`
(reverse-chronological session log) and `docs/decisions/` (ADRs).

## What this is
- **People Center** — the talent/relationship + org view of Charcoal Group's
  people. React + Vite + TypeScript + Tailwind, Supabase backend.
- Runs **inside the CGOPS Platform** (no standalone login — SSO handoff from
  CGOPS). Deployed on **Vercel** (`cg-people-center.vercel.app`).
- **Supabase project:** `qzzhifdwoixqjgugbevq` (name "cgops-platform"). People
  Center and CGOPS **share this one database**. People Center tables are
  prefixed `people_center_*`; CGOPS owns un-prefixed tables (`positions`,
  `roles`, `departments`, `locations`, …).
- **Migrations** live in `supabase/migrations/` and must be applied to that
  project. Apply via the Supabase MCP `apply_migration` (registers in history)
  — the CLI is not used here.

## Environment notes for the new session
- **Supabase MCP is live** — no per-call approval needed. Prefer
  `apply_migration` for DDL, `execute_sql` for data. Always `list_tables`/read
  before schema changes.
- **Git:** work has been developed on `claude/org-chart-manual-add-sync-a7rm1h`
  and merged to `main`. Start new work from `main`.
- **Deploys are automatic (Vercel).** The `cgops-people-center` Vercel project
  (team `michael-hodgsons-projects`, owns `cg-people-center.vercel.app`) has git
  auto-deploy on `main`: every push to `main` builds + goes to production
  (usually READY in ~1–2 min). DB/data changes are live immediately. No manual
  deploy step — a hard refresh clears stale cache. (Env vars live on the Vercel
  project; don't use the file-tree `deploy_to_vercel`, it bypasses the git link.)
- GitHub via the GitHub MCP (no `gh` CLI). Don't open PRs unless asked.

## Shipped so far (this arc)
Features (frontend + pipeline):
- **Manual add + admin-confirmed Push linking** (ADR 0011): add HQ / candidates
  by hand; a Push sync that name-matches an unlinked manual profile is held as
  a "possible match" for an admin to confirm/reject (Data Sources → Pending
  links). New person statuses: `candidate`, `off_roster` flag.
- **Position vocabulary sync** (ADR 0012): CGOPS Operational Center → Positions
  is master; People Center syncs (Data Sources → Positions → "Sync from
  CGOPS"), owns its own config (`show_in_people_center`, `people_center_eligible`,
  `default_person_kind`). Sync is a People-Center-side pull, never a CGOPS
  trigger.
- **Mobile "Visit" walk-in view**: location → managers → notes, seniority-
  ordered. `src/features/visit/VisitView.tsx`.
- **Position ranking (1b)**: `people_center_positions.level` +
  `default_reports_to_position_id` (the accountability template).

Live data state:
- **HQ team seeded (1c):** 31 off-roster people at a **Head Office** location,
  reporting lines + titles per the Jan-2026 HQ org chart. 22 HQ titles added to
  CGOPS `positions` and mirrored into `people_center_positions`.
- **Michael Hodgson (michaelh@charcoalgroup.ca)** admin access fixed — his
  profile had a stale `auth_user_id`; re-pointed to his live auth user. (Lesson:
  the app resolves role by **email**, but DB `is_admin()`/RLS resolve by
  `auth.uid()` — a stale `auth_user_id` makes the UI think you're admin while
  every write silently fails. Check this first for "why can't I save" reports.)

Key migrations: `20260709090000` (manual add + linking), `20260715120000`
(position sync), `20260716090000` (position ranking). The HQ seed is a live data
op (employee names intentionally kept out of the repo).

## Confirmed org rules (source of truth for templates/gap analysis)
- Restaurant ladder (level, lower = senior): GM 10 · GM-in-Training 15 · Chef de
  Cuisine 20 · AGM 25 · Beverage/Service/Guest Service/Events Mgr 30 · Senior
  Sous 35 · Sous 40 · Supervisor 45 · Chef de Partie 50.
- AGM reports to GM. FOH Supervisors → GM by default. Kitchen: Chef de Cuisine >
  Senior Sous > Sous > Chef de Partie.
- HQ: Regional Ops Leaders → John Mackay, except Cindy Fawcett → Jody (CEO).
  Issac/Jennifer/Shanna → Jody (changes next fiscal). Chelsey → Megan. Riley &
  Darryl → Todd Clarmo.
- **Sync semantics (asked repeatedly):** new uploads **add + link, never merge
  or overwrite** leadership-entered data.

## Roadmap / what's next (priority order)
1. ~~**Org-chart ordering by `level`**~~ — DONE (live). Siblings sort by level;
   chart view also staggers siblings vertically by rank so a Chef de Cuisine
   renders above the managers sharing its GM (--oc-drop in orgChart.css).
2. ~~**Connect restaurant GMs to their Regional Ops Leader**~~ — DONE (live).
   Whole company is one tree; fixed a duplicated Regional Ops Leader too.
   Reporting lines are now editable in-UI (person panel → Reporting line picker).
3. ~~**Ignore/remove non-emerging-leader Supervisors**~~ — TOOLING DONE (live):
   Directory → **Bulk edit** (admin) sets status on many people at once; set
   non-pipeline Supervisors to `departed` to drop them from directory + chart.
   Durable across Push syncs (roster-linked people are "not modified" on
   re-sync). Michael applies the actual pruning.
   ~~**cleaner mobile Directory**~~ — DONE (live): the Directory is now
   responsive — phones get a tappable card list + full-width filters, desktop
   keeps the table (bulk edit works on both). Complements the Visit view.
4. **Phase 2 — future org view** (in progress):
   - **Slice 1 DONE (live):** "Upcoming" nav view — reads the New Restaurant
     Center's `opening_sites` (CGOPS module, same DB; SELECT policy is open to
     any authenticated user) and shows planned restaurants with handover /
     soft-opening / opening dates + a staffing-deadline countdown.
   - NRC tables = `opening_sites` (the sites, with `location_id` → CGOPS
     location + dates) and `opening_playbooks` / `opening_tasks` / templates.
   - **Slice 2 DONE (live) — reflects succession:** each Upcoming card shows the
     upcoming site's **planned leadership from the Bench** (role — slated person,
     or "not yet named"), read-only, admin/executive only. Editing stays in the
     Bench — one source of truth.
     - CORRECTION: upcoming sites **ARE** in `people_center_locations`
       (`status='opening'`, `cgops_location_id` null — that null is why an
       earlier check wrongly concluded they weren't there). The Bench/succession
       model already plots leaders into them (Peterborough GM = Matthew Legault,
       etc.). A first pass built a redundant `people_center_opening_placements`
       table (migration 20260716120000); it was dropped (20260716123000, table
       was empty) and the view now reads `people_center_succession_slots`,
       matched to `opening_sites` by **name** (no id link — cgops_location_id is
       null on the upcoming location rows).
   - **Slice 3 DONE (live):** per-site **Planned org** modal (Upcoming card →
     "Planned org", admin/executive). Builds the restaurant hierarchy from the
     position template (`default_reports_to_position_id`), fills each seat with
     the slated leader (succession incumbent) or an **OPEN** gap (unslated
     template ancestors are synthesized, so a slated Chef with no GM shows an
     OPEN GM above it), and flags **"moving from <site>"** when a slated leader
     currently holds a seat elsewhere — surfacing the knock-on vacancy (e.g.
     Peterborough pulls its GM + Chef from Beertown Whitby). Read-only; edits in
     the Bench. `upcoming/PlannedOrgPanel.tsx` + api `fetchPositionTemplate` /
     `fetchCurrentPrimaries`.
   - **Phase 2 remaining:** the per-role hiring-lead-time backlog item; a fuller
     company-wide ghost overlay on the main org chart (deferred — bigger, needs
     region/parent inference).
   - **Backlog (Michael's ask):** per-role **hiring lead time** — edit how many
     days before opening each role should be hired (GM 90d, Chef de Cuisine 60d,
     …), so the staffing-deadline countdown becomes role-aware instead of just
     keying off the handover date. Also feeds Phase 3 gap urgency.
5. **Phase 3 — gap analysis** (in progress):
   - **v1 DONE (live):** new **Gap Analysis** nav view (gated by bench
     permission). Pick a location → required roster vs. who's in seat (open
     sites) or slated (opening sites), shortfall per role + totals. Required
     counts live in `people_center_role_requirements` (migration 20260716130000,
     one base template, admin/executive-editable inline via "Required roster";
     seeded GM/Chef/AGM/Service/Beverage/Guest Service = 1, Sous = 2). Scope =
     management only (Michael's call). `gaps/GapView.tsx` + `gaps/api.ts`.
   - **.docx export DONE (live):** "Download .docx" on the gap view generates a
     Word report of the selected location (title, summary, role table, totals).
     Uses the `docx` lib, dynamic-imported so it's a separate lazy chunk
     (~355 kB, only loads on export). `gaps/docx.ts`.
   - **Remaining:** per-concept required-count overrides (base template only
     today); wire opening-date **urgency** into the gap view (dates already in
     Upcoming); per-role hiring-lead-time backlog item.

## Gotchas
- Two auth identities: UI role by email vs DB `auth.uid()` (see Michael fix).
- CGOPS `positions` ≠ `people_center_positions` (different granularity/
  membership) — they're synced by `external_ref`, not shared. Don't merge them.
- Postgrest errors are plain objects; render `err.message`/`details`, not
  `String(err)` (see `errText` in DataSourcesView).
- HQ people are `off_roster` at "Head Office" so their titles render; they show
  in the Visit picker under Head Office (acceptable).

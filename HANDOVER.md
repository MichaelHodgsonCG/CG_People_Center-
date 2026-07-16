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
- **Deploys are manual (Vercel).** DB/data changes are live immediately;
  frontend changes need a Vercel deploy to appear.
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
1. **Org-chart ordering by `level`** (frontend, small): `OrgChartView` still
   sorts siblings alphabetically; sort by position level then name. Data exists.
2. **Connect restaurant GMs to their Regional Ops Leader** so the HQ tree and
   restaurant trees form one company-wide chart (set `manager_person_id`).
3. **Ignore/remove non-emerging-leader Supervisors** (Michael's ask): a way to
   prune supervisors who aren't leadership-pipeline. (Supervisor is currently
   `people_center_eligible = true` — left as-is by his call.)
4. **Phase 2 — future org view:** upcoming/planned locations with a picker to
   layer them onto the org chart with slated incumbents. Pull **turnover /
   opening dates** from the **New Restaurant Center** (a CGOPS module in the
   SAME DB — find its tables; likely tied to Shanna Jenion / construction &
   development) to drive staffing deadlines.
5. **Phase 3 — gap analysis + deliverable:** compare current vs required org per
   (selected) location → **in-app report + downloadable Word (.docx)**,
   **management + key roles only**, showing planned moves, gaps, and urgency
   (from Phase-2 dates). Needs Michael's input: **required count per role** for
   the ideal restaurant (one base template + per-concept carve-outs).

## Gotchas
- Two auth identities: UI role by email vs DB `auth.uid()` (see Michael fix).
- CGOPS `positions` ≠ `people_center_positions` (different granularity/
  membership) — they're synced by `external_ref`, not shared. Don't merge them.
- Postgrest errors are plain objects; render `err.message`/`details`, not
  `String(err)` (see `errText` in DataSourcesView).
- HQ people are `off_roster` at "Head Office" so their titles render; they show
  in the Visit picker under Head Office (acceptable).

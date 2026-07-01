# People Center — CGOPS Foundations (Starting Source of Truth)

> **Status:** Rev. 1 — pre-repo source of truth, answering the ten foundation
> questions before `cg_people_center` is created.
> **Audience:** whoever (human or AI) scaffolds the new repo, Vercel project,
> and Supabase project.
> **Method:** every answer below is grounded in the current CG_Dashboard
> codebase — migrations and code, not the design docs — with file references.
> Where the design docs and the database disagree, **the migrations are the
> truth** and the disagreement is called out.
> **Companion:** `docs/people-center/PRODUCT_BRIEF.md` (rev. 2) defines what
> People Center *is*; this document defines the platform ground it builds on.

---

## 1. Current CGOPS architecture assumptions

**What CGOPS actually is today.** CGOPS (this repo, `CG_Dashboard`) is the
Charcoal Group operations platform: operational analytics (SLP, P&L, logs,
guest feedback, discounts), the CGAI assistant, a live Workflow Engine, a V1
Company HQ Executive Briefing, and an **Operational Center** — Governance,
Organization, People, Applications, Integrations, Security & Platform — all
backed by live Supabase tables (June 2026 migrations), all Administrator Only
at the RLS layer.

**Founding architecture decisions** are seeded as ADRs in
`governance_decisions` (`supabase/migrations/20260626120000_create_governance_center.sql`):

1. **CGOPS is never the source of truth for operational data** — each
   application remains the system of record for its own domain.
2. **Applications own their own databases** — no app reaches into another
   app's database.
3. **CGOPS orchestrates rather than owns.**
4. **Every operational event contributes to organizational learning** — apps
   are expected to emit Events / Context / Outcomes for the future Continuous
   Learning Engine.

These four sentences are the constitution People Center builds under: People
Center **owns** people/talent/development/relationship data in its own
database; CGOPS orchestrates access to it and consumes summaries from it.

**Stack conventions (from this repo):** React 18 + Vite + TypeScript +
Tailwind, `lucide-react` icons, `@supabase/supabase-js`, Supabase Edge
Functions for AI/server-side work, brand assets per `src/assets/BRAND.md`
(CG monogram + Charcoal Group wordmark, imported as modules, `publicDir:
false`). No router library — top-level view state lives in `App.tsx`.
Migrations are written idempotent (guarded seeds, `IF NOT EXISTS`,
policy-drop loops) with a documentation comment block at the top of every file.

**Docs vs database.** `docs/workflow-engine/ARCHITECTURE.md` and
`docs/briefing-engine/ARCHITECTURE.md` are *proposals* that have been partially
implemented and partially superseded. Two supersessions matter to People
Center: capability contracts were **dropped** (see §4), and PIN auth was
**replaced** (see §3; `AUTHENTICATION_NOTES.md` is stale and should not be
followed).

## 2. App integration pattern

CGOPS models the ecosystem in three admin-managed tables
(`20260627120000_create_applications_and_integrations.sql`,
`20260627150000_create_security_and_platform.sql`):

- **`applications`** — the registry of platform apps: `name`, `description`,
  `status` (`live | development | planned`), `version`, `owner`, `repository`,
  `database_name`, `connected_apis[]`. **People Center is already seeded**:
  status `planned`, owner `People & Culture`, repository `cg_people_center`,
  database `cgops-identity` (see §6 and §8 — the description and database name
  need revisiting under the new framing).
- **`application_access`** — `role_name → application_id`: which CGOPS roles
  may access which registered applications. This is the seam through which
  "who can open People Center" will eventually be granted.
- **`integrations`** — external connectors with `status`, `auth_status`,
  `sync_strategy`, `connected_apps[]`. **Push is registered here** as a POS
  integration — Push is an *external system CGOPS connects to*, not a platform
  application. People Center relates to Push the same way: through a future
  connector, never through its database.

**The pattern for a new app, in practice:**

1. Own repo, own Vercel project, own Supabase project (registered in
   `applications.repository` / `database_name`).
2. Registered in the `applications` table; access granted through
   `application_access`; launched from CGOPS (launcher UI is emerging — the
   registry is the data model it will read).
3. **No cross-database reads in either direction.** Cross-app data flows
   happen through explicit interfaces (edge functions / APIs) — see §4.
4. Expected (per ADR 4 and the workflow-engine roadmap §11) to emit Events /
   Context / Outcomes for future platform learning.

## 3. Auth and permissions direction

**Important correction: PIN auth is gone.** `AUTHENTICATION_NOTES.md`
describes the old system. Migration
`20260623120000_migrate_to_supabase_auth.sql` replaced it with **Supabase Auth
(email/password)**, and two follow-up migrations tightened all RLS. People
Center must not build PIN auth.

The current CGOPS identity model, which People Center should mirror:

- **`user_profiles` ≠ `auth.users`.** The app-level person record
  (`user_profiles`) carries `auth_user_id → auth.users`, `email`, `role`
  (text; `'admin'` drives `is_admin()`), `manager_id` (reporting line, added
  `20260627140000`), and is linked — not merged — with the auth identity. A
  `handle_new_user()` trigger creates the profile on signup.
- **`public.is_admin()`** — a `SECURITY DEFINER STABLE` SQL function with
  `SET search_path = public`, used inside RLS policies to avoid
  self-referential recursion (strengthened again in `20260624120000`). Every
  Operational Center table gates all four operations on it.
- **Roles / permissions tables** — `roles` (named app roles),
  `permissions` (`code` like `dashboard.view`, `category`),
  `role_permissions` (join). Plus `application_access` for per-app grants.
  Note the deliberate split: **`roles` are app-access roles; `positions` are
  jobs** (§5). People Center must keep that split.
- **`user_locations`** — which locations a person is assigned to (distinct
  from UI preferences). The location-scoping primitive.

**Direction:** CGOPS becomes the identity provider and permission authority
for the ecosystem (login/SSO, app access, role grants). That service does not
exist yet as a consumable SSO endpoint.

**Therefore People Center V1:** its own Supabase Auth (email/password),
duplicating the *patterns* above exactly — people-records-separate-from-auth,
`is_admin()`-style SECURITY DEFINER helpers, deny-by-default RLS to
`authenticated` only — so that when CGOPS SSO lands, swapping the identity
source is a bounded change: `auth_user_id` gets populated from CGOPS identity,
and local role/scope tables become a synced projection of CGOPS grants while
RLS remains the local enforcement layer. All permission checks in app code go
through one `permissions` module (`can(user, action, resource)`), never ad-hoc
checks in components.

## 4. Capability contract pattern — current state

**Important correction: the capability contract/adapter layer was removed.**
Migration `20260630120000_drop_capabilities_use_activities.sql` dropped
`workflow_capabilities`, `capability_adapters`, and
`workflow_activity_capabilities`, recording the decision:

> The engine has ONE composition primitive — the Activity. … When an activity
> needs live data or AI behavior, that behavior is implemented in code (keyed
> off the activity's step_type / config), not through a capability→adapter
> contract.

No adapters were ever seeded; nothing real depended on the contract layer. The
elaborate contract/adapter architecture in the workflow/briefing docs is
**aspirational, not current**.

**What this means for People Center:**

- **Do not build against a CGOPS contract API — there isn't one.** Any
  "capability contract" integration is a future negotiation, not a present
  interface.
- **Be contract-shaped, not contract-coupled.** Expose a small set of named,
  versioned, read-only endpoints from People Center's own Supabase (edge
  functions or RPC), designed the way the contracts were going to look:
  audience-scoped **summaries plus reference pointers**, never raw sensitive
  rows. Candidates: `get_bench_strength`, `get_people_readiness_summary`,
  `get_succession_risk`, `get_development_activity`.
- Whatever mechanism CGOPS lands on — activities calling app APIs in code
  (today's reality) or a revived contract registry (the docs' ambition) — it
  can consume those endpoints without People Center changing shape. The
  Company Briefing V1 (`20260628160000_create_company_briefing.sql`) shows the
  consuming pattern: an edge-function generator assembling from source
  material; a People Center endpoint becomes one more source it can call.

## 5. Existing location / role naming conventions

**Locations** (`locations` table: `id`, `name`, `code` unique, plus
`exclude_from_reporting`): canonical names are **Concept + City, no
punctuation** — `Beertown Waterloo`, `Beertown London White Oaks`,
`Sociable Kitchen Tavern`, `Wildcraft`, `Sole`
(`20260518122916_canonicalize_all_location_names.sql`). A
`location_mappings` table remaps variant spellings. Hard-won lesson encoded in
that migration: much of this repo stores free-text `location_name` and paid
for it with a company-wide cleanup. **People Center must reference locations
by `location_id` + a CGOPS `external_ref`, never by free-text name.**

**Organization reference data** (`20260627130000_create_organization_structure.sql`),
all admin-managed, all with `name`/`description`/`sort_order` + audit columns:

- **`concepts`** — brands (Beertown is real; others seeded as placeholders).
- **`regions`** — Greater Toronto Area, Hamilton–Niagara, Waterloo Region,
  London & Southwest, Ottawa & East.
- **`departments`** — Front of House, Back of House, Kitchen, Bar, Management,
  Finance, Marketing, People & Culture, Facilities, Technology.
- **`positions`** — jobs, optionally linked to a department; department head
  is itself a position (`20260627170000`). Seeded management titles:
  **General Manager, Assistant General Manager, Head Chef, Sous Chef** — note
  it is *Head Chef*, not *Executive Chef*, in the platform vocabulary.

**Naming split to preserve:** `roles` = application-access roles;
`positions` = jobs people hold. People Center's readiness/succession domain is
about **positions**, and its access control is about **roles**; conflating
them is the classic mistake this schema already avoids.

## 6. Current roadmap assumptions involving People Center

Three places on the platform already name People Center, and **all three
predate the new framing**:

| Where | What it says | Status vs new framing |
|---|---|---|
| `applications` registry seed | "Identity, org structure and people operations — graduating out of CGOPS", repo `cg_people_center`, db `cgops-identity` | **Conflicts.** Identity is *staying* in CGOPS (CGOPS is becoming the auth/permissions hub); People Center is the leadership relationship & development platform. |
| `governance_roadmap` seed | "People Center — Team, scheduling, and people operations", status `future` | **Conflicts.** Scheduling stays with Push; "team operations" undersells the leadership focus. |
| `docs/workflow-engine/ARCHITECTURE.md` §11 | People Center listed among apps expected to emit Events, Context, Outcomes, Improvement Opportunities | **Still valid** — build the `events`/`outcomes` seam from day one. |

**Action when the repo is created:** update the `applications` row and the
`governance_roadmap` row to the new framing ("Leadership relationship and
development platform — manager visibility, development, succession, and
relationship knowledge"), and record the framing change as a
`governance_decisions` ADR. The old "graduating identity out of CGOPS" idea
should be explicitly retired in that ADR so the two directions don't coexist.

## 7. Master data ownership — locations, roles/positions, people references

Recommended ownership map, consistent with the ADRs and with what is already
live:

| Data | Master | People Center's copy |
|---|---|---|
| Locations, concepts, regions, departments, positions | **CGOPS** (live, admin-editable tables today) | Local reference tables carrying `external_ref` (the CGOPS uuid). Read-only in People Center once sync exists; manually seeded/CSV in V1. |
| Auth identity, app roles, app access | **CGOPS** (target); People Center local Supabase Auth until SSO exists | Local `user_scopes`/role rows, later a synced projection of CGOPS grants. |
| Employment records, payroll, scheduling, team-member performance logging | **Push** | None. At most, far-future read-only reference by external id through a connector. |
| People (talent view), leadership profiles, notes, development plans, readiness, succession, assignments-of-ownership, relationship knowledge | **People Center** | This *is* People Center's domain — its `people` table is the master for the talent view of a person. |

The subtle one is **people references**. Three systems will hold a "person":
CGOPS (`user_profiles` — platform identity), Push (employment record), People
Center (`people` — talent/relationship record). Recommendation: each remains
master of its own facet, and People Center's `people.external_refs jsonb`
carries `{ cgops_user_id, push_employee_id }` for correlation. A People Center
person **must not require** a CGOPS login or a Push record to exist — emerging
leaders and "manager-first, not manager-only" coverage demand that
independence.

## 8. Repo, project, and environment naming

Established conventions (from the `applications` seed and `platform_settings`):

- **Repos:** snake_case with `cg_` prefix — `cg_dashboard`, `cg_chef_summary`,
  `cg_prep_enterprise`, `cg_product_center`, `cg_purchasing`. People Center is
  **already registered as `cg_people_center`** — use it.
- **Supabase projects/databases:** kebab-case with `cgops-` prefix —
  `cgops-core`, `cgops-prep`, `cgops-product`, `cgops-purchasing`. The registry
  currently says `cgops-identity` for People Center; per §6 that name encodes
  the retired framing. **Recommend `cgops-people`** and updating the registry
  row (decision to confirm).
- **Vercel project:** `cg-people-center` (Vercel does not allow underscores in
  project names; kebab-case is the natural mapping).
- **Environments:** the platform names them **Production / Staging /
  Development** (`platform_settings.env_name`). Practical V1: Vercel
  production + preview deployments, one production Supabase project, and a
  second Supabase project for development if/when needed — but keep the
  three-name vocabulary.
- **Env vars:** Vite convention as in this repo — `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`; server-side secrets only in edge functions.
- **Branch/PR conventions:** feature branches, descriptive migration filenames
  (`YYYYMMDDHHMMSS_snake_case_description.sql`) with a documentation comment
  block at the top of every migration.

## 9. Recommended initial build sequence

Sequence updated from the product brief (rev. 2) with the cheat sheet pulled
forward — it is the flagship ask, and it is a *projection* of whatever data
exists, so a useful version ships early and gets richer every phase.

- **Phase 0 — Skeleton.** Repo `cg_people_center` (React+Vite+TS+Tailwind, CG
  brand); Supabase project; Supabase Auth email/password; `user_profiles`-style
  people/auth split; `is_admin()`-style helpers; deny-by-default RLS baseline;
  `audit_log` (append-only) and `events` tables; the `permissions` module.
  *Exit: a scoped user logs into an empty branded shell; every table born with
  RLS.*
- **Phase 1 — Directory, org reference, assignments.** Org reference tables
  seeded from CGOPS values (with `external_ref`); `people`, position
  assignments with history, reporting lines; CSV import; directory
  list/search. *Exit: the management population is browsable — replaces the
  spreadsheet.*
- **Phase 2 — Notes + Cheat Sheet v1.** The four-category note system
  (general leadership / development / relationship / restricted) with
  RLS-enforced visibility levels and consent flag on relationship notes; fast
  capture; **manager cheat sheet v1** (identity, role, location, reporting
  line, latest notes, flags like relocation interest and career goals).
  *Exit: the HQ "who is this person and where do they stand" loop works.*
- **Phase 3 — Development, readiness, training.** Development plans + items;
  readiness-by-position assessments with history and staleness indicators;
  training/development status tracking; cheat sheet gains readiness +
  development focus. *Exit: "is this person ready, and what are they working
  on?" is answerable.*
- **Phase 4 — Succession, timeline, bench/risk dashboard.** Succession slots
  and candidates; mentor/successor links; leadership timeline (projection of
  the `events` stream: role changes, assessments, plan milestones, notes);
  bench-strength and people-risk dashboard by region/concept. *Exit: the
  executive altitude exists — the ten questions in the brief are answerable.*
- **Phase 5 — CGOPS integration.** Update the CGOPS `applications` +
  `governance_roadmap` rows and record the ADR (§6); adopt CGOPS SSO when it
  exists; sync grants into local scopes; stand up the read-only summary
  endpoints (§4) and wire one into the Company Briefing; begin emitting
  outcomes. *Exit: People Center signal appears in an executive CGOPS
  briefing.*

Phase 5 is gated on CGOPS services and can interleave with 2–4; everything
before it runs fully standalone.

## 10. Security and audit requirements from the platform

Patterns already established in CGOPS that People Center inherits as
**requirements**, plus additions demanded by relationship data:

1. **RLS on every table, deny-by-default, `authenticated` only.** No `anon`
   policies, ever. (CGOPS paid for early permissive/anon policies with two
   dedicated tightening migrations, `20260623120100` and `20260623130000` —
   People Center starts where CGOPS ended up.)
2. **`SECURITY DEFINER` helpers with `SET search_path = public`** for any RLS
   check that reads the profiles table (the `is_admin()` recursion lesson).
3. **Append-only audit log** modeled on CGOPS `audit_log` (actor, action
   `create|update|delete`, entity_type/id/label, summary; INSERT + SELECT
   policies only — no UPDATE/DELETE). People Center extends it with a
   **`view` action for restricted/relationship notes** — reads of the most
   sensitive categories are themselves auditable (readable via an edge
   function or RPC that logs, rather than direct table SELECT).
4. **Audit columns on every editable row:** `updated_at`, `updated_by`,
   `updated_by_name` (denormalized for display without a join) — the house
   style on every Operational Center table.
5. **Idempotent, documented migrations** — guarded seeds
   (`WHERE NOT EXISTS`), `IF NOT EXISTS`, policy drop-then-create, and a
   documentation block at the top of each file.
6. **Service role only inside edge functions**; the browser client uses the
   anon key + RLS, following the `generate-*` function pattern.
7. **Sensitive-data additions specific to People Center:**
   - Visibility levels on notes are **enforced in RLS**, not in UI filtering.
   - Relationship notes are **optional, voluntarily shared** information:
     each carries a consent/source acknowledgment, and the subject's
     relationship data can be purged on request (deletion is the one
     exception to append-only, and it is itself audited).
   - Restricted notes: author + admins/executives only; a written retention
     policy before broad rollout.
   - **No relationship or restricted content ever leaves People Center**
     through the summary endpoints (§4) or into AI/briefing outputs —
     endpoints return leadership/business signal only, and this is a property
     of the endpoint design, not a filter added later.

---

## Decisions needed before scaffolding (summary)

1. **Supabase project name:** keep registry's `cgops-identity` or rename to
   `cgops-people` (recommended) — and update the `applications` row either way.
2. **Registry/roadmap descriptions:** approve the reframed wording (§6) and
   the ADR retiring "identity graduates out of CGOPS."
3. **Auth mode confirmation:** Supabase email/password (platform current
   state), not PIN — and mark `AUTHENTICATION_NOTES.md` as historical.
4. **Restricted-note retention policy** owner and rules (needed before
   Phase 2 ships broadly).

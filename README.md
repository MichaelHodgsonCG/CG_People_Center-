# People Center (`cg_people_center`)

**The leadership relationship and development platform for Charcoal Group:**
it helps HQ and senior leaders understand where each manager stands, what
they are working on, what they are capable of, what support they need, and
what we collectively know about them.

A **native CGOPS Platform application** (ADR 0006, Phase A complete): own
repo and Vercel project (`cg-people-center`), running against the **shared
CGOPS Supabase project** with every database object under the
`people_center_` prefix. Authentication, user profiles, platform
permissions, and the launcher are owned by CGOPS — People Center is opened
from the CGOPS launcher via a browser-side SSO handoff and owns its business
logic, UI, and module data.

## Boundaries (the admission test)

*Does it help a leader understand, develop, support, or deploy a person — or
strengthen the relationship with them?* If the honest answer is "it
administers employment," it belongs in Push.

1. **Do not replace Push** — payroll, employment records, scheduling, and
   team-member performance logging stay there.
2. **Manager-first, not manager-only** — nothing in the schema assumes
   "person = manager."
3. **People Center owns people/talent/development data; CGOPS orchestrates.**
4. **Personal/relationship information is optional, voluntary, and
   permissioned** — never surveillance, always auditable.

## Architecture contract

The contract for this repository, in order of precedence:

1. [`docs/ARCHITECTURE_REVIEW.md`](docs/ARCHITECTURE_REVIEW.md) — the
   approved review; decisions and amendments recorded in
   [`docs/decisions/`](docs/decisions/)
2. [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md) — what People Center is
3. [`docs/CGOPS_FOUNDATIONS.md`](docs/CGOPS_FOUNDATIONS.md) — the platform
   ground it builds on

## Stack

React 18 + Vite + TypeScript + Tailwind, `lucide-react`,
`@supabase/supabase-js`. No router library — top-level view state lives in
`src/App.tsx` (house convention). Brand assets imported as modules
(`src/assets/BRAND.md`); `publicDir` disabled. Every permission check in app
code flows through `src/permissions` (`can(user, action, resource)`).

## Setup

```bash
cp .env.example .env   # fill in the CGOPS Supabase URL, anon key, and VITE_CGOPS_URL
npm install
npm run dev
```

### Sign-in (Phase A — CGOPS SSO handoff)

People Center has **no standalone login**. CGOPS is the front door: it
launches People Center with session tokens in a URL fragment
(`#cgops_sso=1&access_token=…&refresh_token=…`), which
`src/features/auth/cgopsSso.ts` consumes via `setSession()` and immediately
strips from the address bar. Unauthenticated visits (and sign-outs) redirect
to `VITE_CGOPS_URL`. Both apps share the CGOPS Supabase project, so the
tokens are valid here as-is. There is no People Center signup path and no
auth triggers — users exist only in CGOPS Auth.

### Database

Migrations live in `supabase/migrations/` (idempotent — safe to run twice).
Apply them in filename order via the Supabase CLI (`supabase db push`) or the
SQL editor. Supabase project configuration: Data APIs enabled, new tables
automatically exposed, automatic RLS enabled — migrations still enable RLS
explicitly on every table; no `anon` policies exist anywhere.

Every People Center-owned database object (tables, helper functions,
indexes, constraints, triggers, policies) carries the `people_center_`
prefix (migration `20260702120000`) so the project can later lift-and-shift
into the CGOPS Platform Supabase project without name collisions. New
objects must follow the same convention. The earlier migrations create
objects under their original names and `20260702120000` renames them —
filename order matters, and the pre-rename migrations are no longer
individually re-runnable on an already-renamed database (the guarded rename
migration is).

### Bootstrap the admin compatibility row

Identity lives in CGOPS Auth. Until Phase B swaps the permission authority to
CGOPS profiles (see `docs/RUNBOOK_CGOPS_LIFT_AND_SHIFT.md`), admin access is
granted by a temporary `people_center_user_profiles` row keyed to the CGOPS
auth user — run in the CGOPS SQL editor:

```sql
insert into public.people_center_user_profiles (auth_user_id, email, role, updated_by_name)
select id, email, 'admin', 'bootstrap'
from auth.users
where email = 'you@charcoalgroup.ca'
on conflict (auth_user_id) do update
  set role = 'admin', updated_by_name = 'bootstrap';
```

Every later role grant is done by an admin.

### Troubleshooting: signed in but no admin navigation

The app resolves the role from `people_center_user_profiles.role` for the signed-in
`auth_user_id` on every load — nothing is cached. The user menu (top right)
shows exactly what was resolved: the role badge, or a "not resolved" warning
with the reason and your auth uid. To inspect the database side:

```sql
select u.id as auth_user_id, u.email, p.id as profile_id, p.role
from auth.users u
left join public.people_center_user_profiles p on p.auth_user_id = u.id;
```

- **CGOPS platform admins need no compat row**: `people_center_is_admin()`
  (migration `20260703090000`) also grants admin when the CGOPS profile
  (`public.user_profiles`) has `role = 'admin'`.
- **`profile_id` is null and you are not a CGOPS platform admin** → run the
  bootstrap upsert above (there is no signup trigger; rows are created
  manually until Phase B).
- **`role` is `viewer`** → run the bootstrap upsert above.

Refresh the app after either fix.

## Phase map

| Phase | Scope | Status |
|---|---|---|
| 0 | Skeleton: auth, RLS helpers, permissions module, `audit_log` + `events`, branded shell | Done |
| 1 | Directory, org reference (`external_ref` to CGOPS), people, assignments, source sync pipeline (ADR 0004/0005) | **This repo state** |
| 2 | Four-category notes with RLS-enforced visibility; Manager Cheat Sheet v1 | — |
| 3 | Development plans, readiness-by-position, training status | — |
| 4 | Succession, leadership timeline, bench/risk dashboard | — |
| 5 | CGOPS integration: registry ADR, SSO, grant sync, summary endpoints | — |

# People Center (`cg_people_center`)

**The leadership relationship and development platform for Charcoal Group:**
it helps HQ and senior leaders understand where each manager stands, what
they are working on, what they are capable of, what support they need, and
what we collectively know about them.

A separate CG platform application — own repo, own Vercel project
(`cg-people-center`), own Supabase project (`cgops-people`) — standalone in
V1, designed from day one to integrate with CGOPS (SSO, permissions,
launcher, summary endpoints) when those services exist.

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
cp .env.example .env   # fill in VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

### Database

Migrations live in `supabase/migrations/` (idempotent — safe to run twice).
Apply them in filename order via the Supabase CLI (`supabase db push`) or the
SQL editor. Supabase project configuration: Data APIs enabled, new tables
automatically exposed, automatic RLS enabled — migrations still enable RLS
explicitly on every table; no `anon` policies exist anywhere.

### Bootstrap the first admin

Create the first user (Supabase dashboard → Authentication → Add user), then
promote by email in the SQL editor. This upsert works whether or not the
profile row already exists (a plain UPDATE silently matches 0 rows if the
auth user predates the migrations):

```sql
insert into public.user_profiles (auth_user_id, email, role, updated_by_name)
select id, email, 'admin', 'bootstrap'
from auth.users
where email = 'you@charcoalgroup.ca'
on conflict (auth_user_id) do update
  set role = 'admin', updated_by_name = 'bootstrap';
```

Every later role grant is done by an admin.

### Troubleshooting: signed in but no admin navigation

The app resolves the role from `user_profiles.role` for the signed-in
`auth_user_id` on every load — nothing is cached. The user menu (top right)
shows exactly what was resolved: the role badge, or a "not resolved" warning
with the reason and your auth uid. To inspect the database side:

```sql
select u.id as auth_user_id, u.email, p.id as profile_id, p.role
from auth.users u
left join public.user_profiles p on p.auth_user_id = u.id;
```

- **`profile_id` is null** → the auth user predates the Phase 0 migrations,
  so the signup trigger never fired. Apply migration
  `20260702090000_backfill_user_profiles.sql` (creates missing rows), then
  run the bootstrap upsert above.
- **`role` is `viewer`** → the promotion ran before the profile row existed
  and matched 0 rows. Run the bootstrap upsert above.

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

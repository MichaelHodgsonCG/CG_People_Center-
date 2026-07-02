# Runbook — People Center lift-and-shift into the CGOPS Platform Supabase project

**Date prepared:** 2026-07-02
**Scope:** Move People Center's database (all `people_center_*` objects) from the
source Supabase project (`cgops-people`, ref `jgwuaixztxatzjjxsvzc`) into the
CGOPS Platform Supabase project, and point the People Center app at it.
Lift-and-shift ONLY.

**What today IS:** the People Center app runs exactly as it does now, but its
tables live inside the CGOPS Platform Supabase project.

**What today is NOT:** no CGOPS auth/SSO integration, no shared
locations/positions vocabulary, no shared permissions, no people
deduplication, no RLS redesign, no schema changes. (See §10.)

---

## The three things that will bite if skipped

Read these before starting; the sequence in §7 handles all three.

1. **`auth.users` foreign keys.** Three People Center tables reference
   `auth.users(id)`: `people_center_user_profiles.auth_user_id` (NOT NULL),
   `people_center_user_scopes.auth_user_id` (NOT NULL), and
   `people_center_people.auth_user_id` (nullable). We do NOT export
   `auth.users`, and CGOPS has its own `auth.users` with different ids. If the
   dump is imported as-is, the FK constraints fail and the whole import rolls
   back. Fix: for every People Center login, ensure a user with the same email
   exists in CGOPS auth, then remap the old uuid → new uuid in the dump file
   before importing (§7 step 6).

2. **`citext` extension schema.** The source installed `citext` into the
   `public` schema, so the dump declares the email columns as `public.citext`.
   CGOPS must have `citext` available under the same qualified name or the
   import fails (§4 pre-step).

3. **The signup trigger does not travel.** `people_center_on_auth_user_created`
   lives on `auth.users`, which is outside the dumped schema. It must be
   recreated in CGOPS after import (§5.1), or new signups get no profile row.

4. **`CREATE SCHEMA public` in the dump.** On Postgres 15+, `pg_dump
   --schema=public` emits `CREATE SCHEMA public;`, which errors on any
   destination where `public` already exists — i.e. every Supabase project —
   and aborts the whole import. Strip it from the working copy before
   importing (§3; verified in a dry run — the single-transaction import
   rolled back cleanly and succeeded after the strip).

---

## 1. Pre-flight checklist

Tick every box before the migration window.

- [ ] Latest People Center branch (with the `people_center_` prefix work) is
      merged and deployed — or ready to deploy — on Vercel project
      `cg-people-center`.
- [ ] The prefix migration `20260702120000_rename_tables_people_center_prefix.sql`
      has been applied to the SOURCE project. Verify in the source SQL editor:
      ```sql
      select count(*) as prefixed_tables
      from pg_tables where schemaname = 'public' and tablename ~ '^people_center_';
      -- expect 15
      select count(*) as unprefixed_tables
      from pg_tables where schemaname = 'public' and tablename !~ '^people_center_';
      -- expect 0
      ```
- [ ] Source app works after the prefix migration: login, Directory loads,
      Data Sources view opens. (If the prefix migration was just applied,
      run the §8 smoke test against the SOURCE first.)
- [ ] CGOPS Platform destination project identified — record its project ref
      and confirm with the team that it is the right one (§2).
- [ ] CGOPS backup taken immediately before import (§7 step 2).
- [ ] People Center backup taken immediately before export (§7 step 2).
- [ ] Postgres versions checked on both sides (`select version();`). Use a
      `pg_dump`/`psql` client at least as new as the SOURCE server version.
- [ ] Confirm CGOPS `public` schema has no `people_center_*` objects already
      (must return 0 rows):
      ```sql
      select tablename from pg_tables
      where schemaname = 'public' and tablename ~ '^people_center_';
      ```
- [ ] Everyone with People Center access told about the freeze window: no
      logins needed, no imports, no edits during the migration.

## 2. Required project details — gather before the window

| Value | Where to find it | Notes |
|---|---|---|
| Source project ref | `jgwuaixztxatzjjxsvzc` (dashboard URL / `.env.example`) | project `cgops-people` |
| Source DB connection string | Source dashboard → Connect → Session pooler (or direct, port 5432) | Use the session pooler / direct connection, NOT the transaction pooler (port 6543) — `pg_dump` needs a real session. |
| Destination (CGOPS) project ref | CGOPS dashboard URL | `<CGOPS_PROJECT_REF>` |
| Destination DB connection string | CGOPS dashboard → Connect → Session pooler (or direct, port 5432) | Same pooler caveat. |
| Vercel env vars for `cg-people-center` | Vercel dashboard → Project → Settings → Environment Variables | Exactly two are used: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. |
| Source anon key | Source dashboard → Settings → API | Only for rollback reference. |
| Destination (CGOPS) anon key | CGOPS dashboard → Settings → API | Goes into Vercel at cutover. |
| Service role keys | — | **None used.** People Center has no Edge Functions, no server-side code, and no service-role usage anywhere (verified in repo). If a service key was ever stored anywhere ad hoc, it is not needed for this migration. |
| People Center login emails | §7 step 4 query | Needed for the auth remap. |

Set these in your terminal for the commands below (note the quotes — the
strings contain special characters):

```bash
export SOURCE_DB_URL='postgresql://postgres.<SOURCE_REF>:<PASSWORD>@<host>:5432/postgres'
export DEST_DB_URL='postgresql://postgres.<CGOPS_REF>:<PASSWORD>@<host>:5432/postgres'
```

## 3. Export command (source → dump file)

```bash
STAMP=$(date +%Y%m%d_%H%M%S)
pg_dump "$SOURCE_DB_URL" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --format=plain \
  --file="people_center_export_${STAMP}.sql"
```

Why these flags:

- `--schema=public` — the source `public` schema contains exactly the 15
  People Center tables, 4 helper functions, and all their indexes,
  constraints, triggers, and RLS policies (schema AND data are included by
  default). It automatically excludes `auth`, `storage`, `realtime`,
  `extensions`, and every other Supabase system schema — so `auth.users` and
  storage are excluded by construction. People Center has no storage buckets.
- `--no-owner --no-privileges` — ownership and grants are project-specific
  role wiring; CGOPS re-applies its own default privileges
  (anon/authenticated/service_role grants) automatically when the objects are
  created by its `postgres` role.
- **No `--clean`** — deliberately. The dump must never contain DROP
  statements that could touch CGOPS objects.
- RLS survives: `ENABLE ROW LEVEL SECURITY` and every `CREATE POLICY` are
  part of the schema dump. The `people_center_on_auth_user_created` trigger
  on `auth.users` is the ONE object that does not travel (§5.1).

Keep the original file untouched; make a working copy and strip the schema
statements that collide with the destination's existing `public` schema
(gotcha 4 above — the comment line is stripped too, since commenting on a
schema you may not own can also be refused):

```bash
cp "people_center_export_${STAMP}.sql" "people_center_import_${STAMP}.sql"
sed -i.bak \
  -e '/^CREATE SCHEMA public;$/d' \
  -e "/^COMMENT ON SCHEMA public IS 'standard public schema';$/d" \
  "people_center_import_${STAMP}.sql"
```

## 4. Import command (dump file → CGOPS)

**Pre-step — citext.** In the CGOPS SQL editor, check where `citext` lives:

```sql
select e.extname, n.nspname
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'citext';
```

- **No row** → install it into `public` (matching the source, so the dump's
  `public.citext` column types resolve):
  ```sql
  create extension citext with schema public;
  ```
- **Row says `public`** → nothing to do.
- **Row says `extensions`** (dashboard-installed) → do NOT move the
  extension. Instead point the dump at it:
  ```bash
  sed -i.bak 's/public\.citext/extensions.citext/g' "people_center_import_${STAMP}.sql"
  ```

**Import** (after the uuid remap, §7 step 6):

```bash
psql "$DEST_DB_URL" \
  --single-transaction \
  --set ON_ERROR_STOP=1 \
  --file="people_center_import_${STAMP}.sql"
```

- `--single-transaction` + `ON_ERROR_STOP=1` — all or nothing. Any error
  (name collision, missing auth uuid, type mismatch) rolls the entire import
  back and CGOPS is untouched.
- Nothing is dropped, nothing is wiped: the dump only CREATEs
  `people_center_*` objects alongside the existing CGOPS tables.

## 5. Post-import verification SQL (run in CGOPS)

### 5.1 First: recreate the signup trigger (the one object that doesn't travel)

```sql
drop trigger if exists people_center_on_auth_user_created on auth.users;
create trigger people_center_on_auth_user_created
  after insert on auth.users
  for each row execute function public.people_center_handle_new_user();
```

(The function came with the dump; only the trigger needs recreating. If this
errors with "must be owner of table users", your CGOPS `postgres` role lacks
the TRIGGER grant on `auth.users` — run it via Supabase support/elevated
access. Until it exists, new signups simply get no People Center profile row;
existing logins are unaffected.)

Side effect to be aware of: from now on EVERY new CGOPS signup also gets a
People Center profile row with role `viewer` — same as the source behaviour,
now applied to the shared user pool. See §11 risk R2.

### 5.2 All 15 tables exist

```sql
select count(*) as pc_tables
from pg_tables where schemaname = 'public' and tablename ~ '^people_center_';
-- expect 15
select tablename from pg_tables
where schemaname = 'public' and tablename ~ '^people_center_' order by 1;
-- expect exactly: audit_log, concepts, departments, events, import_batches,
-- import_rows, location_mappings, locations, people, position_assignments,
-- position_mappings, positions, regions, user_profiles, user_scopes
-- (each with the people_center_ prefix)
```

### 5.3 Row counts match the source

Run this identical query on BOTH projects and diff the output (run the source
side at freeze time and keep it as the reference):

```sql
select 'people_center_audit_log' t, count(*) n from people_center_audit_log
union all select 'people_center_concepts', count(*) from people_center_concepts
union all select 'people_center_departments', count(*) from people_center_departments
union all select 'people_center_events', count(*) from people_center_events
union all select 'people_center_import_batches', count(*) from people_center_import_batches
union all select 'people_center_import_rows', count(*) from people_center_import_rows
union all select 'people_center_location_mappings', count(*) from people_center_location_mappings
union all select 'people_center_locations', count(*) from people_center_locations
union all select 'people_center_people', count(*) from people_center_people
union all select 'people_center_position_assignments', count(*) from people_center_position_assignments
union all select 'people_center_position_mappings', count(*) from people_center_position_mappings
union all select 'people_center_positions', count(*) from people_center_positions
union all select 'people_center_regions', count(*) from people_center_regions
union all select 'people_center_user_profiles', count(*) from people_center_user_profiles
union all select 'people_center_user_scopes', count(*) from people_center_user_scopes
order by 1;
```

### 5.4 Functions exist (expect 4)

```sql
select p.proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname ~ '^people_center_'
order by 1;
-- expect: people_center_current_person_id, people_center_handle_new_user,
--         people_center_is_admin, people_center_set_updated_at
```

### 5.5 Triggers exist (expect 11 touch triggers + the auth trigger)

```sql
select c.relname, t.tgname
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
  and c.relname ~ '^people_center_'
order by 1;
-- expect 11 rows (set_..._updated_at on user_profiles, user_scopes, concepts,
-- regions, departments, locations, positions, people, position_assignments,
-- location_mappings, position_mappings)

select tgname from pg_trigger
where tgrelid = 'auth.users'::regclass and tgname = 'people_center_on_auth_user_created';
-- expect 1 row (after §5.1)
```

### 5.6 RLS enabled + policies exist (expect 15 / 53)

```sql
select count(*) as rls_enabled from pg_tables
where schemaname = 'public' and tablename ~ '^people_center_' and rowsecurity;
-- expect 15

select count(*) as pc_policies from pg_policies
where schemaname = 'public' and tablename ~ '^people_center_';
-- expect 53 (compare against the same query run on the source)
```

### 5.7 Indexes and constraints (expect 40 / 54 — compare with source)

```sql
select count(*) as pc_indexes from pg_indexes
where schemaname = 'public' and tablename ~ '^people_center_';
-- expect 40

select count(*) as pc_constraints
from pg_constraint c join pg_class r on r.oid = c.conrelid
join pg_namespace n on n.oid = r.relnamespace
where n.nspname = 'public' and r.relname ~ '^people_center_';
-- expect 54
```

### 5.8 Nothing unprefixed came along

```sql
select tablename from pg_tables
where schemaname = 'public' and tablename ~ '^(user_profiles|user_scopes|audit_log|events|concepts|regions|departments|locations|positions|people|position_assignments|location_mappings|position_mappings|import_batches|import_rows)$';
-- expect 0 rows: the import created ONLY prefixed objects and did not
-- create or touch any CGOPS table of the same base names
```

### 5.9 citext survived

```sql
select table_name, column_name, udt_name
from information_schema.columns
where table_schema = 'public' and udt_name = 'citext'
  and table_name ~ '^people_center_';
-- expect 2 rows: people_center_user_profiles.email, people_center_people.email

-- case-insensitivity actually works:
select count(*) from people_center_user_profiles
where email = upper(email::text)::citext;
-- expect same count as total profiles (citext compares case-insensitively)
```

### 5.10 Auth links resolve (after the uuid remap)

```sql
select count(*) as broken_profile_links
from people_center_user_profiles p
left join auth.users u on u.id = p.auth_user_id
where u.id is null;
-- expect 0
```

## 6. App cutover — environment variables

People Center reads exactly two env vars (`src/lib/supabase.ts`); there is no
service role key and there are no Edge Functions.

In Vercel → `cg-people-center` → Settings → Environment Variables (all
environments you use — Production at minimum):

| Variable | Old value | New value |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://jgwuaixztxatzjjxsvzc.supabase.co` | `https://<CGOPS_PROJECT_REF>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | source anon key | CGOPS anon key |

Also update your local `.env` for development. `.env.example` should be
updated in the repo after a successful cutover (it currently names the source
project). No other ref-specific values exist in the app.

Vite inlines env vars at build time — changing them requires a **redeploy**,
not just a variable edit.

## 7. Deployment sequence (the actual window)

Expected duration: well under an hour at current data volumes.

1. **Freeze.** Announce it. No People Center logins/edits/imports from now
   until smoke test passes. (Small team — a message is sufficient; there is
   no write traffic besides admins.)
2. **Backups, both sides.**
   ```bash
   pg_dump "$SOURCE_DB_URL" --format=custom --file="backup_people_center_$(date +%Y%m%d_%H%M%S).dump"
   pg_dump "$DEST_DB_URL"   --format=custom --file="backup_cgops_$(date +%Y%m%d_%H%M%S).dump"
   ```
   Full-database custom-format backups, kept locally. Also confirm the CGOPS
   dashboard shows a recent automated backup / PITR coverage.
3. **Snapshot source row counts** — run the §5.3 query on the SOURCE, save
   the output. This is the reference the import must match.
4. **Enumerate People Center logins** (SOURCE SQL editor):
   ```sql
   select u.id as source_auth_uid, u.email
   from auth.users u
   where u.id in (
     select auth_user_id from people_center_user_profiles
     union select auth_user_id from people_center_user_scopes
     union select auth_user_id from people_center_people where auth_user_id is not null
   )
   order by u.email;
   ```
5. **Ensure each email exists in CGOPS auth.** For each row from step 4:
   - If the email already has a CGOPS login → note its CGOPS
     `auth.users.id`.
   - If not → CGOPS dashboard → Authentication → Add user (or send an
     invite) with that email; note the new `auth.users.id`.
   ```sql
   -- in CGOPS, after creating:
   select id as cgops_auth_uid, email from auth.users
   where email in ('<email1>', '<email2>' /* ... */);
   ```
   *Passwords do not carry over with this method* — anyone who didn't already
   have a CGOPS login uses "Forgot password" (or the invite link) on first
   login. With the current user count this is a one-or-two-person task.
   (Alternative that preserves passwords: copy the specific `auth.users` +
   `auth.identities` rows from source with the same uuids. More moving parts,
   touches the auth schema directly, and collides if an email already exists
   in CGOPS — only worth it if password continuity matters. It does not,
   today.)
6. **Dump and remap.** Run the §3 export. Then, in the WORKING COPY, replace
   every source auth uuid with its CGOPS counterpart (uuids are globally
   unique random strings, so a global replace is safe and also fixes
   `audit_log.actor_auth_uid` references):
   ```bash
   sed -i.bak \
     -e 's/<source_auth_uid_1>/<cgops_auth_uid_1>/g' \
     -e 's/<source_auth_uid_2>/<cgops_auth_uid_2>/g' \
     "people_center_import_${STAMP}.sql"
   # confirm no source uuids remain:
   grep -c '<source_auth_uid_1>' "people_center_import_${STAMP}.sql"   # expect 0
   ```
7. **CGOPS pre-import checks:** citext (§4 pre-step), no existing
   `people_center_*` objects (§1 checklist query).
8. **Import** (§4 command). On ANY error: nothing was applied (single
   transaction) — diagnose, fix the dump copy, re-run. CGOPS is safe
   throughout.
9. **Recreate the signup trigger** (§5.1).
10. **Verify** — full §5 suite. Row counts must equal the step-3 snapshot
    exactly. Do not proceed on any mismatch.
11. **Cutover env vars** (§6) and **redeploy** the Vercel project.
12. **Smoke test** (§8) against the live app.
13. **Unfreeze.** Announce completion. Update `.env.example` in the repo to
    the CGOPS URL (a follow-up commit).
14. **Keep the source project untouched (and frozen) for at least 7 days** as
    the rollback target. Decommission it only after a week of green.

## 8. Smoke test checklist (production app, after cutover)

- [ ] **Login** as the admin (CGOPS-hosted auth now; use the reset/invite
      password if the account was newly created in step 5).
- [ ] **Role resolves**: user menu (top right) shows the `admin` badge —
      "Role (from people_center_user_profiles)" — not a "not resolved"
      warning. This proves the uuid remap worked.
- [ ] **Directory loads** with the full imported population, including the
      embedded position + location on each row (proves
      `people_center_position_assignments` / `positions` / `locations` joins
      and their FKs).
- [ ] **A flagged person** still shows the "Needs review" chip with its note
      (proves `data_quality_*` columns and partial index survived).
- [ ] **Directory filters** work: location dropdown populated, kind filter
      filters.
- [ ] **Data Sources view** opens and shows prior import batches with counts
      (proves `people_center_import_batches`/`import_rows`, admin-only RLS).
- [ ] **Location/position mappings load**: start a dry-run of the Push
      roster sync with the May file — the mapping stage must resolve
      positions and locations (do NOT commit the batch; cancel before
      commit — or if committed, expect all-duplicates, which is itself a
      good idempotency check).
- [ ] **Admin vs viewer**: log in as (or create) a non-admin user — they see
      the shell + directory but no Data Sources admin surface; SQL-side,
      their profile row exists with role `viewer`.
- [ ] **Audit log behaviour**: as admin, confirm
      `select count(*) from people_center_audit_log` matches the source
      snapshot; append-only intact (no UPDATE/DELETE policies — an update
      attempt as a non-service role is refused).
- [ ] **Signup trigger / profile creation**: create a throwaway user in the
      CGOPS dashboard → confirm a `people_center_user_profiles` row with role
      `viewer` appears for it (then leave it or delete the auth user — the
      profile cascades).

## 9. Rollback plan

The overriding property: **the source project is never modified by this
migration.** Every scenario below rolls back by pointing away from CGOPS or
cleaning CGOPS — never by restoring source data.

**A. Import fails (step 8).**
Nothing happened — `--single-transaction` rolled everything back and the app
is still pointed at the source. No user impact, no cleanup. Diagnose the
error in the dump copy, fix, re-run. Common causes: citext schema mismatch
(§4), a missed auth uuid in the remap (§7 step 6), client `pg_dump` older
than the source server.

**B. App deploy fails (step 11).**
Database work is done and healthy; only the app is affected. In Vercel,
"Instant Rollback" to the previous deployment (which still carries the source
env vars) — the app is back on the source project immediately. Fix the build,
redeploy with CGOPS vars when ready. Nothing in either database needs
touching.

**C. App points at CGOPS but errors (step 12 failures).**
1. Revert the two env vars to the source values, redeploy (or Vercel Instant
   Rollback). The app is back on the source project — data there is exactly
   as it was at freeze, so nothing is lost.
2. Diagnose against CGOPS at leisure (likely suspects: anon key typo, missed
   signup trigger, an RLS policy that references a helper that failed to
   import — §5 checks catch all of these).
3. Optionally clean CGOPS for a fresh attempt (see D's teardown).

**D. Data appears incomplete after import.**
1. Do NOT cut the app over (or roll back per C if already cut over).
2. Tear down ONLY the People Center objects in CGOPS — this touches nothing
   else:
   ```sql
   drop trigger if exists people_center_on_auth_user_created on auth.users;
   drop table if exists
     people_center_import_rows,
     people_center_import_batches,
     people_center_position_assignments,
     people_center_location_mappings,
     people_center_position_mappings,
     people_center_user_scopes,
     people_center_user_profiles,
     people_center_people,
     people_center_positions,
     people_center_locations,
     people_center_departments,
     people_center_regions,
     people_center_concepts,
     people_center_events,
     people_center_audit_log
   cascade;
   drop function if exists
     public.people_center_is_admin(),
     public.people_center_current_person_id(),
     public.people_center_set_updated_at(),
     public.people_center_handle_new_user();
   ```
   (The `cascade` here only cascades within the People Center object set —
   nothing in CGOPS references these objects yet by design.)
3. Re-dump from the (still frozen, still pristine) source and re-import.
4. Worst case — CGOPS itself damaged by operator error outside this runbook:
   restore from the step-2 CGOPS backup / dashboard PITR. The runbook's own
   commands cannot produce this state (no drops, single transaction).

## 10. What we are doing today / not doing today

**Doing today:**
- Copying every `people_center_*` table (schema + data + PKs + FKs + indexes
  + constraints + triggers + RLS policies) and the four
  `people_center_*` helper functions into the CGOPS Platform Supabase
  project.
- Recreating the People Center signup trigger on CGOPS's `auth.users`.
- Re-pointing the People Center app (two env vars) at the CGOPS project.
- Mapping the handful of People Center logins onto CGOPS-hosted auth
  accounts with the same emails.

**NOT doing today:**
- No CGOPS auth/SSO integration — the app keeps its own email/password
  login screen and its own `people_center_user_profiles` role model; the
  accounts merely live in the CGOPS project's auth now.
- No shared locations/positions/departments — People Center keeps its local
  copies; reconciliation stays the `external_ref` backfill, later.
- No shared permissions — CGOPS grants do not affect People Center and vice
  versa; `people_center_is_admin()` still reads only
  `people_center_user_profiles`.
- No people/data deduplication — CGOPS `user_profiles` and
  `people_center_people` continue to master their own facets.
- No schema redesign, no RLS redesign, no business-logic changes.

## 11. Known risks / consequences to accept before running

- **R1 — Shared authenticated pool widens read access.** In the source
  project, only People Center's own users could authenticate. After the move,
  EVERY CGOPS authenticated user satisfies `to authenticated` policies — so
  CGOPS users can read the People Center directory, org reference, and
  position assignments via the API (`using (true)` SELECT policies), and any
  CGOPS signup gets a viewer profile row. Admin-gated data (`audit_log`,
  `import_*`, all writes) stays locked to People Center admins. If this
  interim exposure is not acceptable for the days/weeks until Phase 2
  visibility rules, say so — the SELECT policies can be scoped to
  people-center-profile-holders as a minimal follow-up (it is an RLS change,
  so it is out of scope for this runbook by default).
- **R2 — Signup side effect.** Every future CGOPS signup (any app in the
  project) creates a `people_center_user_profiles` viewer row (§5.1). Same
  mechanism as today, wider pool. Harmless, but it will accumulate rows.
- **R3 — Password continuity.** Users whose emails did not already exist in
  CGOPS need a password reset/invite on first login (§7 step 5).
- **R4 — Migration history.** The CGOPS project's `supabase_migrations`
  ledger knows nothing about People Center's migration files. Future People
  Center schema changes applied to CGOPS should start a fresh migration
  lineage (or be applied via the CGOPS project's own tooling). Do not run the
  historical People Center migrations against CGOPS — they would create
  unprefixed tables (the old names) that the rename migration would then
  rename; the dump already carries the final state.
- **R5 — Two frozen sources of truth during the window.** Between freeze and
  smoke-test-green, the source holds the data and CGOPS holds a copy. Any
  accidental source write after the dump is lost on cutover — hence the
  freeze and the 7-day retention of the frozen source.

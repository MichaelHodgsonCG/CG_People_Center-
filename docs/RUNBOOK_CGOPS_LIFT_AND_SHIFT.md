# Runbook — People Center lift-and-shift into the CGOPS Platform Supabase project

**Revision 2 — 2026-07-02.** Simplified for the single-user reality: there is
exactly one People Center user (the admin), and the old People Center auth
model does not carry forward. CGOPS Auth becomes the single auth source;
future users are created directly in CGOPS Auth. Supersedes revision 1's
multi-user uuid-remap procedure.

**What today IS:** the People Center app runs exactly as it does now, but its
`people_center_*` tables live inside the CGOPS Platform Supabase project, and
its one login is a CGOPS auth user.

**What today is NOT:** no CGOPS SSO/permission integration, no shared
locations/positions vocabulary, no people deduplication, no schema or RLS
redesign.

---

## How auth is handled (the one design decision)

Three tables carry FKs into `auth.users`:
`people_center_user_profiles.auth_user_id`,
`people_center_user_scopes.auth_user_id`, and
`people_center_people.auth_user_id`. Rows referencing the OLD project's auth
uuids would abort the import — so instead of remapping uuids, we simply
**don't ship the legacy auth-linked rows**:

- Dump **excludes the DATA** (not the schema) of
  `people_center_user_profiles` and `people_center_user_scopes`. Those tables
  hold nothing but the old login wiring — one admin profile row and any scope
  rows, all recreatable in one statement.
- `people_center_people.auth_user_id` is expected to be NULL everywhere (the
  sync pipeline never sets it); a pre-flight query confirms.
- `people_center_audit_log.actor_auth_uid` values keep the old uuids as a
  historical trace — the column is deliberately unconstrained, so this is
  fine and preserves the audit record faithfully.
- After import, one bootstrap upsert creates your admin profile against your
  CGOPS auth user. Done — no uuid mapping anywhere.

This whole flow was dry-run end-to-end against a simulated CGOPS destination
(own `auth.users`, citext installed, pre-existing tables): import clean,
bootstrap upsert works, `people_center_is_admin()` resolves for the CGOPS
uid, full admin CRUD under RLS, destination tables untouched.

## Values to gather

| Value | Where |
|---|---|
| Source DB connection string (`SOURCE_DB_URL`) | Source project (`jgwuaixztxatzjjxsvzc`) → Connect → **Session pooler** or direct, port 5432 — not the transaction pooler (6543) |
| CGOPS DB connection string (`DEST_DB_URL`) | CGOPS project → Connect → same rule |
| CGOPS project ref + anon key | CGOPS dashboard → Settings → API |
| Your CGOPS login email | The email you'll sign in with from now on |

The app uses exactly two env vars (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) — no service role key, no Edge Functions, no
storage.

Pre-flight, run once on each side:

```sql
-- SOURCE: prefix migration applied, and no people→auth links (expect 15 / 0 / 0)
select
  (select count(*) from pg_tables where schemaname='public' and tablename ~ '^people_center_') as pc_tables,
  (select count(*) from pg_tables where schemaname='public' and tablename !~ '^people_center_') as unprefixed,
  (select count(*) from people_center_people where auth_user_id is not null) as people_auth_links;
-- if people_auth_links > 0: clear them before dumping —
--   update people_center_people set auth_user_id = null where auth_user_id is not null;
-- (relink to CGOPS uids afterwards if ever needed; nothing in the app reads this today)

-- CGOPS: no name collisions (expect 0), citext location (see step 4)
select count(*) from pg_tables where schemaname='public' and tablename ~ '^people_center_';
select e.extname, n.nspname from pg_extension e
join pg_namespace n on n.oid = e.extnamespace where e.extname = 'citext';
```

Also check `select version();` on both sides and use a `pg_dump`/`psql` at
least as new as the source server.

---

## The migration

Freeze first: no People Center edits/imports from here until the smoke test
passes. (You are the only user — just don't use the app.)

### 1. Backup both sides

```bash
export SOURCE_DB_URL='postgresql://...'   # quotes matter
export DEST_DB_URL='postgresql://...'
STAMP=$(date +%Y%m%d_%H%M%S)

pg_dump "$SOURCE_DB_URL" --format=custom --file="backup_people_center_${STAMP}.dump"
pg_dump "$DEST_DB_URL"   --format=custom --file="backup_cgops_${STAMP}.dump"
```

Keep both files. Confirm the CGOPS dashboard also shows recent automated
backup / PITR coverage. Snapshot the source row counts for the verification
diff (save the output):

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
order by 1;
-- user_profiles / user_scopes intentionally omitted: their data does not travel
```

### 2. Dump the People Center public schema + data

```bash
pg_dump "$SOURCE_DB_URL" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --format=plain \
  --exclude-table-data='public.people_center_user_profiles' \
  --exclude-table-data='public.people_center_user_scopes' \
  --file="people_center_export_${STAMP}.sql"
```

- `--schema=public` carries all 15 tables, 4 helper functions, indexes,
  constraints, triggers, and RLS policies — and by construction excludes
  `auth`, `storage`, and every Supabase system schema.
- The two `--exclude-table-data` flags ship those tables **empty** (schema,
  constraints, and policies still travel) — this is what removes the legacy
  auth dependency.
- No `--clean`: the dump contains no DROP statements, ever.

### 3. Strip the schema statements that collide with the destination

Postgres 15+ `pg_dump` emits `CREATE SCHEMA public;`, which errors on every
Supabase project and aborts the import (verified in the dry run):

```bash
cp "people_center_export_${STAMP}.sql" "people_center_import_${STAMP}.sql"
sed -i.bak \
  -e '/^CREATE SCHEMA public;$/d' \
  -e "/^COMMENT ON SCHEMA public IS 'standard public schema';$/d" \
  "people_center_import_${STAMP}.sql"
```

### 4. Import into CGOPS

First, citext (from the pre-flight query):
- absent → `create extension citext with schema public;` in the CGOPS SQL editor
- present in `public` → nothing to do
- present in `extensions` → don't move it; point the dump at it instead:
  `sed -i.bak2 's/public\.citext/extensions.citext/g' "people_center_import_${STAMP}.sql"`

Then:

```bash
psql "$DEST_DB_URL" \
  --single-transaction \
  --set ON_ERROR_STOP=1 \
  --file="people_center_import_${STAMP}.sql"
```

All-or-nothing: any error rolls the entire import back and CGOPS is
untouched. Nothing is dropped or overwritten — only `people_center_*`
objects are created, alongside existing CGOPS tables.

### 5. Create/confirm your CGOPS auth user

CGOPS dashboard → Authentication. If your email already has a CGOPS login,
you're done. If not: Add user with your email and a password. This is the
account you'll sign in to People Center with from now on.

### 6. Point People Center at your CGOPS auth id

One statement in the CGOPS SQL editor (same upsert as the README bootstrap):

```sql
insert into public.people_center_user_profiles (auth_user_id, email, role, updated_by_name)
select id, email, 'admin', 'cgops-migration'
from auth.users
where email = 'you@example.com'   -- ← your CGOPS login email
on conflict (auth_user_id) do update
  set role = 'admin', updated_by_name = 'cgops-migration';
```

That's the entire auth migration. (Scopes aren't enforced in the current
phase, so no `people_center_user_scopes` rows are needed; add them when
Phase 2 makes scopes meaningful.)

### 7. Signup trigger: **skip it** (recommended)

Do **not** recreate `people_center_on_auth_user_created` in CGOPS.

Why skipping is better here:
- In the source project, auth pool == People Center users, so auto-creating
  a profile per signup made sense. In CGOPS the pool is every platform user —
  the trigger would silently create a People Center viewer row for **every**
  CGOPS signup forever: row noise now, and a real hazard later when profile
  existence starts gating People Center access.
- People Center role grants are deliberate admin acts anyway. Creating the
  profile row IS the grant — one upsert per new user (below), done when you
  decide someone gets access. This matches the CGOPS-as-auth-source end
  state (profiles become a projection of granted access, not of signups).
- One less People Center object attached to `auth.users` — less legacy to
  unwind at full integration.

Cost: none today. The app already handles a login without a profile row
gracefully (the user menu shows "No people_center_user_profiles row … run
the admin bootstrap SQL"), which is exactly the right behaviour for a CGOPS
user who hasn't been granted People Center access.

**Adding a future People Center user** (after creating them in CGOPS Auth):

```sql
insert into public.people_center_user_profiles (auth_user_id, email, role, updated_by_name)
select id, email, 'viewer', 'admin-grant'   -- or their real role
from auth.users where email = 'new.user@example.com'
on conflict (auth_user_id) do update set role = excluded.role;
```

Optional tidy-up (the trigger function arrives with the dump and is now
unused): `drop function if exists public.people_center_handle_new_user();`
Harmless either way.

### Verification (before touching the app)

```sql
-- objects (expect 15 / 4 / 53 / 40 / 54 / 11 / 15)
select
  (select count(*) from pg_tables where schemaname='public' and tablename ~ '^people_center_') as tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname ~ '^people_center_') as functions,
  (select count(*) from pg_policies where schemaname='public' and tablename ~ '^people_center_') as policies,
  (select count(*) from pg_indexes where schemaname='public' and tablename ~ '^people_center_') as indexes,
  (select count(*) from pg_constraint c join pg_class r on r.oid=c.conrelid
     join pg_namespace n on n.oid=r.relnamespace
     where n.nspname='public' and r.relname ~ '^people_center_') as constraints,
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
     join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and not t.tgisinternal and c.relname ~ '^people_center_') as triggers,
  (select count(*) from pg_tables where schemaname='public'
     and tablename ~ '^people_center_' and rowsecurity) as rls_enabled;
-- functions count is 3 if you dropped people_center_handle_new_user in step 7

-- data: run the step-1 row-count query here and diff against the saved
-- source snapshot — must match exactly (13 tables; profiles/scopes excluded)

-- auth wiring (expect 1 / 0)
select
  (select count(*) from people_center_user_profiles where role = 'admin') as admin_profiles,
  (select count(*) from people_center_user_profiles p
     left join auth.users u on u.id = p.auth_user_id where u.id is null) as broken_links;

-- citext survived (expect 2 rows: user_profiles.email, people.email)
select table_name, column_name from information_schema.columns
where table_schema='public' and udt_name='citext' and table_name ~ '^people_center_';
```

### 8. Update Vercel env vars

Vercel → `cg-people-center` → Settings → Environment Variables (Production
at minimum; Preview/Development if you use them):

| Variable | New value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<CGOPS_PROJECT_REF>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | CGOPS anon key |

Vite inlines these at build time — a redeploy is required, not just the edit.
Update your local `.env` too, and `.env.example` in the repo afterwards.

### 9. Redeploy and smoke test

Redeploy the Vercel project, then:

- [ ] **Login** with your CGOPS credentials.
- [ ] **Role badge** shows `admin` in the user menu ("Role (from
      people_center_user_profiles)") — proves step 6 worked.
- [ ] **Directory loads** with the full population, positions and locations
      shown per row (proves people/assignments/positions/locations FKs and
      embedded joins).
- [ ] A **"Needs review"-flagged person** still shows the chip + note.
- [ ] **Directory filters**: location dropdown populated, kind filter works.
- [ ] **Data Sources** shows prior import batches with correct counts
      (admin-only RLS working).
- [ ] **Mappings resolve**: dry-run the Push roster sync with the May file —
      positions/locations map; cancel before commit (or commit and expect
      all-duplicates, which itself proves re-sync idempotency).
- [ ] **Audit log intact**: `select count(*) from people_center_audit_log;`
      equals the source snapshot.
- [ ] **No-profile behaviour**: sign in as (or create) a CGOPS user with no
      profile row — app shows the "no profile" notice in the user menu and no
      admin navigation. That's the designed post-trigger behaviour.

Unfreeze. Keep the source project untouched for **7 days**, then decommission.

### 10. Rollback plan

The source project is never modified by this runbook, so every rollback is
cheap:

- **Import fails** → `--single-transaction` already rolled everything back;
  CGOPS untouched, app still on source, zero impact. Fix (usual suspects:
  citext location, an un-stripped `CREATE SCHEMA public`, old client
  `pg_dump`), re-run.
- **Deploy fails** → Vercel Instant Rollback to the previous deployment
  (still carrying source env vars). Databases need nothing.
- **App on CGOPS but broken** → revert the two env vars / Instant Rollback →
  you're back on the source with data exactly as at freeze. Diagnose CGOPS
  at leisure (verification section pinpoints what's missing).
- **Data incomplete** → don't cut over (or roll back as above), then tear
  down ONLY the People Center objects in CGOPS and re-import:

  ```sql
  drop table if exists
    people_center_import_rows, people_center_import_batches,
    people_center_position_assignments, people_center_location_mappings,
    people_center_position_mappings, people_center_user_scopes,
    people_center_user_profiles, people_center_people, people_center_positions,
    people_center_locations, people_center_departments, people_center_regions,
    people_center_concepts, people_center_events, people_center_audit_log
  cascade;
  drop function if exists
    public.people_center_is_admin(), public.people_center_current_person_id(),
    public.people_center_set_updated_at(), public.people_center_handle_new_user();
  ```

  (Nothing in CGOPS references these objects, so the cascade stays inside the
  People Center set — verified in the dry run.)
- **Worst case, CGOPS damaged by something outside this runbook** → restore
  from the step-1 CGOPS backup / dashboard PITR. The runbook's own commands
  cannot produce this state: no drops, single transaction.

---

## Known consequences to accept

- **Shared authenticated pool.** Any CGOPS-authenticated user can read the
  People Center directory, org reference, and assignments via the API — the
  SELECT policies are `to authenticated using (true)`. Writes, `audit_log`,
  and `import_*` remain People Center-admin-only. Acceptable interim per
  revision-2 direction; Phase 2 visibility rules (or a minimal
  profile-holder scoping of those SELECT policies) close it.
- **Old audit uuids.** `people_center_audit_log.actor_auth_uid` keeps
  source-project uuids as history. `actor_name` makes rows human-readable
  regardless.
- **Migration lineage.** Never run the historical People Center migration
  files against CGOPS — the dump already carries the final state. Future
  People Center schema changes are applied to CGOPS as new, prefixed
  migrations in the CGOPS project's own lineage.

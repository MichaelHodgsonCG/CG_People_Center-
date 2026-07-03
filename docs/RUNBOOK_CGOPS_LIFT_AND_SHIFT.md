# Runbook — People Center lift-and-shift into the CGOPS Platform Supabase project

**Revision 3 — 2026-07-02.** Architecture decision: People Center keeps NO
user-profile authority. CGOPS profiles/users are the source of truth for
identity, role, and app access. This runbook has two phases:

- **Phase A (migration day):** lift-and-shift the `people_center_*` tables
  into the CGOPS project. `people_center_user_profiles` ships as an EMPTY
  schema + one temporary compatibility row for the single admin. No signup
  trigger. No legacy auth rows.
- **Phase B (immediately after cutover):** swap the permission authority to
  CGOPS profiles — two reading points, then drop the People Center profile
  tables entirely.

Phase B is deliberately NOT folded into migration day: the swap must be
written and verified against the real CGOPS profile schema (table name, role
values, RLS self-read), which only exists in the CGOPS project — and cutover
day should change one variable at a time. Details in §B.

---

## Why the compatibility row is still needed on day one (the dependency map)

`people_center_user_profiles` is load-bearing in exactly two places:

1. **Database:** `people_center_is_admin()` reads it, and that function is
   bound into every write policy and admin-only read policy (40 of the 53
   RLS policies). No admin profile row → the whole app is read-only and
   Data Sources is dark.
2. **App:** one query in `src/features/auth/useSession.ts` resolves the role;
   `App.tsx`, `permissions/index.ts`, `AppShell.tsx`, and
   `DataSourcesView.tsx` all consume the resulting object (role gate, role
   badge, import attribution).

`people_center_user_scopes` is referenced by NOTHING in app code (a type
definition only) — it ships empty and is dropped in Phase B with no code
change.

So: without the table the app runs degraded (login works, directory renders,
no admin functions, all writes RLS-blocked). One temporary row keeps 100% of
functionality on migration day; Phase B then removes the layer properly.

## Values to gather

| Value | Where |
|---|---|
| Source DB connection string (`SOURCE_DB_URL`) | Source project (`jgwuaixztxatzjjxsvzc`) → Connect → **Session pooler** or direct, port 5432 — not the transaction pooler (6543) |
| CGOPS DB connection string (`DEST_DB_URL`) | CGOPS project → Connect → same rule |
| CGOPS project ref + anon key | CGOPS dashboard → Settings → API |
| Your CGOPS login email | The account you'll sign in with |
| CGOPS profile schema facts (for Phase B) | CGOPS SQL editor — see §B.0 |

The app uses exactly two env vars (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) — no service role key, no Edge Functions, no
storage.

Pre-flight, run once on each side:

```sql
-- SOURCE: prefix migration applied; no people→auth links (expect 15 / 0 / 0)
select
  (select count(*) from pg_tables where schemaname='public' and tablename ~ '^people_center_') as pc_tables,
  (select count(*) from pg_tables where schemaname='public' and tablename !~ '^people_center_') as unprefixed,
  (select count(*) from people_center_people where auth_user_id is not null) as people_auth_links;
-- if people_auth_links > 0:
--   update people_center_people set auth_user_id = null where auth_user_id is not null;

-- CGOPS: no name collisions (expect 0), citext location (see A4)
select count(*) from pg_tables where schemaname='public' and tablename ~ '^people_center_';
select e.extname, n.nspname from pg_extension e
join pg_namespace n on n.oid = e.extnamespace where e.extname = 'citext';
```

Check `select version();` on both sides; use a `pg_dump`/`psql` at least as
new as the source server.

---

## Phase A — migration day

Freeze first: no People Center edits/imports until the smoke test passes.

### A1. Backup both sides + snapshot source counts

```bash
export SOURCE_DB_URL='postgresql://...'   # quotes matter
export DEST_DB_URL='postgresql://...'
STAMP=$(date +%Y%m%d_%H%M%S)

pg_dump "$SOURCE_DB_URL" --format=custom --file="backup_people_center_${STAMP}.dump"
pg_dump "$DEST_DB_URL"   --format=custom --file="backup_cgops_${STAMP}.dump"
```

Confirm the CGOPS dashboard also shows recent automated backup / PITR
coverage. Save the source row counts as the verification reference:

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
-- user_profiles / user_scopes intentionally omitted: their data never travels
```

### A2. Dump — schema + data, minus every legacy-auth row

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

- All 15 tables, 4 helper functions, indexes, constraints, triggers, and RLS
  policies travel; `auth`, `storage`, and system schemas are excluded by
  construction.
- The two `--exclude-table-data` flags are the "do not migrate old
  auth-linked rows" directive: those tables arrive EMPTY.
- `people_center_audit_log.actor_auth_uid` keeps old uuids as an
  unconstrained historical trace — the audit record stays faithful.
- No `--clean`: the dump contains no DROP statements.

### A3. Strip the colliding schema statements

Postgres 15+ `pg_dump` emits `CREATE SCHEMA public;`, which aborts the import
on every Supabase destination (verified in the dry run):

```bash
cp "people_center_export_${STAMP}.sql" "people_center_import_${STAMP}.sql"
sed -i.bak \
  -e '/^CREATE SCHEMA public;$/d' \
  -e "/^COMMENT ON SCHEMA public IS 'standard public schema';$/d" \
  "people_center_import_${STAMP}.sql"
```

### A4. Import into CGOPS

citext first (from pre-flight):
- absent → `create extension citext with schema public;`
- in `public` → nothing to do
- in `extensions` → `sed -i.bak2 's/public\.citext/extensions.citext/g' "people_center_import_${STAMP}.sql"`

```bash
psql "$DEST_DB_URL" \
  --single-transaction \
  --set ON_ERROR_STOP=1 \
  --file="people_center_import_${STAMP}.sql"
```

All-or-nothing; any error rolls back completely and CGOPS is untouched.

### A5. Create/confirm your CGOPS auth user

CGOPS dashboard → Authentication. If your email already has a CGOPS login,
done; otherwise Add user. This is the identity People Center uses from now
on. Future users: always created here — never a People Center-specific
signup path.

### A6. TEMPORARY compatibility row (not an authority)

One row so `people_center_is_admin()` and the app's role resolution work
until Phase B replaces them. This is scaffolding, not a profile system:

```sql
-- TEMPORARY compatibility layer — remove in Phase B (§B4)
insert into public.people_center_user_profiles (auth_user_id, email, role, updated_by_name)
select id, email, 'admin', 'phase-a-compat'
from auth.users
where email = 'you@example.com'   -- ← your CGOPS login email
on conflict (auth_user_id) do update
  set role = 'admin', updated_by_name = 'phase-a-compat';
```

Do NOT add rows for anyone else. New access grants wait for Phase B and come
from CGOPS profiles.

**A6b — CGOPS admin bridge (added 2026-07-03).** Migration
`20260703090000_cgops_admin_bridge.sql` (apply in the CGOPS SQL editor)
redefines `people_center_is_admin()` so CGOPS platform admins
(`public.user_profiles.role = 'admin'`) are People Center admins with no
compat row at all — the compat row remains honoured but is no longer
required for CGOPS admins. The app asks the same function via `rpc` when no
compat row exists (`useSession.ts`), so UI and RLS cannot disagree. Verify
the assumed CGOPS table/column/role values with the diagnostic in the
migration header before applying. This is the admin-only subset of Phase B
pulled forward; Phase B still replaces the rest and deletes the bridge.

### A7. No signup trigger — and drop the orphaned function

Per the architecture decision, `people_center_on_auth_user_created` is NOT
recreated in CGOPS: CGOPS owns signups, and People Center must not react to
them with its own profile rows. The trigger function arrived with the dump;
remove it so no one wires it back up:

```sql
drop function if exists public.people_center_handle_new_user();
```

### A8. Verify

```sql
-- objects (expect 15 / 3 / 53 / 40 / 54 / 11 / 15)
-- (3 functions: is_admin, current_person_id, set_updated_at — handle_new_user dropped in A7)
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

-- data: re-run the A1 row-count query here; must equal the saved snapshot

-- auth wiring (expect 1 / 0 / 0)
select
  (select count(*) from people_center_user_profiles) as compat_rows,
  (select count(*) from people_center_user_scopes) as scope_rows,
  (select count(*) from people_center_user_profiles p
     left join auth.users u on u.id = p.auth_user_id where u.id is null) as broken_links;

-- citext survived (expect 2 rows)
select table_name, column_name from information_schema.columns
where table_schema='public' and udt_name='citext' and table_name ~ '^people_center_';
```

### A9. Cut the app over and smoke test

Vercel → `cg-people-center` → Settings → Environment Variables:
`VITE_SUPABASE_URL` → `https://<CGOPS_PROJECT_REF>.supabase.co`;
`VITE_SUPABASE_ANON_KEY` → CGOPS anon key. Vite inlines at build time —
**redeploy required**. Update local `.env` (and `.env.example` in the repo
afterwards).

Smoke test:
- [ ] Login with CGOPS credentials.
- [ ] Role badge shows `admin` (proves A6).
- [ ] Directory loads fully, positions + locations per row.
- [ ] A flagged person still shows "Needs review" + note.
- [ ] Filters work (locations dropdown populated).
- [ ] Data Sources shows prior batches with correct counts.
- [ ] Mapping dry-run resolves positions/locations (cancel before commit, or
      commit and expect all-duplicates — that itself proves idempotency).
- [ ] `select count(*) from people_center_audit_log;` equals the snapshot.
- [ ] A CGOPS user with no compat row sees the "no profile" notice and no
      admin surface — correct interim behaviour.

Unfreeze. Keep the source project untouched for **7 days**, then decommission.

### A10. Rollback

The source is never modified, so:

- **Import fails** → single transaction already rolled back; app still on
  source; fix and re-run.
- **Deploy fails** → Vercel Instant Rollback (previous deployment carries the
  source env vars).
- **App on CGOPS but broken** → revert the two env vars / Instant Rollback;
  source data is exactly as at freeze.
- **Data incomplete** → tear down ONLY People Center objects in CGOPS and
  re-import:

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
- **Worst case (operator error outside the runbook)** → A1 CGOPS backup /
  dashboard PITR.

---

## Phase B — CGOPS becomes the authority (immediately after cutover)

Target: within days of A9, not weeks. Until B lands, the compat row is the
only thing granting admin — that is the TODO this section discharges.
The swap is small because authority is concentrated in exactly two reading
points (see the dependency map): one SQL function and one app query.

### B0. Confirm the CGOPS profile facts (fill these in first)

In the CGOPS SQL editor, confirm and record:

```sql
-- 1. the profile table's name and shape (assumed below: public.user_profiles)
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'user_profiles' order by ordinal_position;

-- 2. the role vocabulary and which value(s) mean "People Center admin"
select distinct role from public.user_profiles;

-- 3. RLS: can an authenticated user read their OWN profile row?
select policyname, cmd, qual from pg_policies
where schemaname = 'public' and tablename = 'user_profiles';
```

If any of these differ from the assumptions below, adjust the snippets —
that's exactly why B is a separate, verified step and not folded into
migration day.

### B1. Swap the database authority (one statement, all 53 policies follow)

Policies bind `people_center_is_admin()` by OID, so replacing its body swaps
the permission source everywhere at once — no policy edits:

```sql
create or replace function public.people_center_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles          -- ← CGOPS profiles (confirm name, B0)
    where auth_user_id = auth.uid()    -- ← confirm column (B0)
      and role = 'admin'               -- ← confirm CGOPS's admin semantic (B0)
  );
$$;
```

Also re-point the (currently unused, reserved for audit attribution) person
resolver at the link the schema already carries:

```sql
create or replace function public.people_center_current_person_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id
  from public.people_center_people
  where auth_user_id = auth.uid();
$$;
```

Verify before touching the app: as your CGOPS user (SQL editor impersonation
or a quick API call), `select public.people_center_is_admin();` must be true
based on your CGOPS role — with the compat row still present as a safety net.

### B2. Swap the app's profile read (one file + role mapping)

`src/features/auth/useSession.ts` is the only query. Point it at the CGOPS
profile table and adapt the row to the existing `UserProfile` shape so
`permissions/`, `AppShell`, and `DataSourcesView` need no changes:

- `.from('people_center_user_profiles')` → `.from('user_profiles')` (CGOPS —
  confirm name/columns from B0).
- Map the CGOPS role vocabulary onto People Center's `AppRole` (today only
  `admin` matters; everyone else is effectively `viewer` until Phase 2).
- `person_id` no longer comes from the profile: resolve it from
  `people_center_people.auth_user_id` (nullable; only used to attribute
  import batches), or leave null until person-linking matters.

The `can()` signature and the rest of the app stay untouched — this is the
seam the permissions module was built for.

### B3. Verify the swap

- [ ] Login → role badge reflects your CGOPS role.
- [ ] Data Sources visible and a mapping dry-run works (RLS write path via
      the new `is_admin()`).
- [ ] A non-admin CGOPS user: directory visible, no Data Sources, writes
      refused.

### B4. Remove the compatibility layer for good

```sql
-- the FK from user_profiles.person_id and the tables themselves go together;
-- nothing else references these tables (verified: app code has zero
-- user_scopes references, and B2 removed the last user_profiles read)
drop table if exists public.people_center_user_scopes;
drop table if exists public.people_center_user_profiles;
```

Update the repo to match: remove the `UserProfile`-table types if unused,
update README bootstrap/troubleshooting sections (they describe the retired
model), and record the decision as an ADR ("CGOPS profiles are the identity
and permission authority; People Center holds no user-profile tables").

### B5. Rollback (Phase B only)

Every B step is independently reversible without touching data:
- B1 → re-apply the original function bodies (in the A2 dump file) — the
  compat row still exists until B4, so behaviour reverts exactly.
- B2 → revert the commit.
- B4 is the only destructive step — do it LAST, after B3 is green. (If ever
  needed again, the empty-table DDL is in the dump file.)

---

## What this plan explicitly does NOT do

- No People Center signup trigger in CGOPS, ever (A7).
- No People Center profile authority beyond the days between A6 and B4.
- No migration of legacy auth rows, identities, or passwords.
- No schema/RLS redesign beyond the two function-body swaps that ARE the
  authority change; no shared org vocabulary; no people deduplication —
  those remain future, separate decisions.

## Known consequences to accept

- **Shared authenticated pool.** Any CGOPS-authenticated user can read the
  People Center directory, org reference, and assignments (`to authenticated
  using (true)` SELECT policies). Writes, `audit_log`, and `import_*` stay
  admin-only. Phase 2 visibility rules (or scoping those SELECTs to CGOPS
  role holders once B1 establishes the pattern) close this.
- **Old audit uuids.** `people_center_audit_log.actor_auth_uid` keeps
  source-project uuids as history; `actor_name` keeps rows readable.
- **Migration lineage.** Never run the historical People Center migration
  files against CGOPS — the dump carries the final state. Future People
  Center schema changes are new, prefixed migrations in the CGOPS project's
  own lineage (Phase B's function swaps should be committed as the first
  one).

## Lessons learned (migration day, 2026-07-03 — permanent guidance)

1. **Never use `/rest/v1/` as `VITE_SUPABASE_URL`.** The value must be the
   bare project URL (`https://<project-ref>.supabase.co`). Appending
   `/rest/v1/` silently breaks Supabase Auth — this was the final
   authentication issue, not SSO.
2. **Vite requires redeployment after environment variable changes** —
   env values are baked into the bundle at build time.
3. **Production environment variables must be updated separately from
   Preview** (Vercel scopes them independently).
4. **The hash-based SSO receiver must execute before any hash router**
   touches `location.hash`.
5. **Launcher URLs must never include a trailing `#` or `/#/`** — either
   corrupts the SSO fragment.
6. **Treat authentication and authorization separately** — auth cut over on
   day one; authorization stayed on the Phase A compatibility bridge.
7. **Phase A uses compatibility bridges instead of redesigning security** —
   one function body (`people_center_is_admin()`) bridged CGOPS platform
   admins into 40 RLS policies with zero policy edits.

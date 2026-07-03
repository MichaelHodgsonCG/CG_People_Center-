# ADR 0006 — People Center is a native CGOPS platform application (Phase A)

- **Status:** Accepted (2026-07-03) — **supersedes ADR 0001** and the
  separate-Supabase-project premise of ARCHITECTURE_REVIEW.md §6–§7 and
  CGOPS_FOUNDATIONS.md §2/§8.
- **Companion:** `docs/RUNBOOK_CGOPS_LIFT_AND_SHIFT.md` (the executed
  migration runbook, rev. 3, including lessons learned).

## Context

People Center V1 was built standalone on its own Supabase project
(`cgops-people`, ADR 0001) with local email/password auth, per the original
platform pattern of one Supabase project per application. The platform
direction consolidated: CGOPS owns authentication, user profiles, platform
permissions, the application launcher, and a **shared Supabase project**;
applications own their business logic, UI, and module-specific data within
it.

## Decision (executed — Phase A complete)

1. **Shared database.** The People Center schema was lifted-and-shifted into
   the CGOPS Platform Supabase project: 15 `people_center_*` tables,
   ~1,700 rows, RLS and policies verified. Every People Center database
   object carries the `people_center_` prefix (migration `20260702120000`);
   all new objects must follow the convention. The original `cgops-people`
   project remains online temporarily as rollback only.
2. **CGOPS owns authentication.** The standalone login is removed. People
   Center is launched from the CGOPS launcher with session tokens in a URL
   fragment (`#cgops_sso=1&access_token=…&refresh_token=…`); the receiver
   (`src/features/auth/cgopsSso.ts`) calls `setSession()`, strips the
   fragment immediately, and the app redirects to CGOPS when no session
   exists. There is no People Center signup path and no auth triggers —
   users exist only in CGOPS Auth.
3. **Authorization is Phase A compatible.** `people_center_user_profiles`
   remains the local role table, and `people_center_is_admin()` now bridges:
   a legacy compat admin row **or** a CGOPS platform admin
   (`public.user_profiles.role = 'admin'`) grants People Center admin
   (migration `20260703090000`). All RLS policies bind the function, so the
   bridge required zero policy edits. **Phase B** (CGOPS profiles become the
   sole permission authority; compat tables dropped) is deferred and
   specified in the runbook.
4. **Unchanged:** the product boundaries (Push owns employment; notes-not-
   fields; voluntary relationship data), the eligibility model (ADR 0004),
   the sync pipeline (ADR 0005), the audit/events boundary (ADR 0003), the
   actor-identity convention (ADR 0002 — with role storage now transitional
   per the runbook), and the platform design system.

## Consequences

- **ADR 0001 is superseded**: there is no separate People Center Supabase
  project going forward; `cgops-people` is rollback-only until
  decommissioned.
- **Phase 2+ schema work lands in the CGOPS project** with `people_center_`
  prefixes, and its RLS must use `people_center_is_admin()` (and future
  `people_center_*` helpers), never unprefixed names.
- The pre-rename migrations (`202607011*`–`202607021*`) plus the rename
  migration are the historical lineage; they are not individually
  re-runnable on the renamed database. New environments restore from the
  CGOPS project state, not by replaying the lineage.
- The Phase 5 integration items from the original plan (SSO, launcher,
  permission sync) are partially realized ahead of schedule; remaining
  Phase 5 scope is the CGOPS registry/roadmap ADR, summary endpoints, and
  events/outcomes emission.
- The `handle_new_user()` signup-trigger pattern and README bootstrap-by-
  signup flow are obsolete; admin access comes from CGOPS platform admin
  role or (temporarily) a compat row.

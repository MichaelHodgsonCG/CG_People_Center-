# ADR 0001 — Supabase project is `cgops-people`, not `cgops-identity`

- **Status:** ~~Accepted (2026-07-01)~~ **Superseded by ADR 0006
  (2026-07-03):** People Center migrated into the shared CGOPS Platform
  Supabase project as `people_center_*` tables; `cgops-people` is
  rollback-only until decommissioned.
- **Contract refs:** ARCHITECTURE_REVIEW.md D1; CGOPS_FOUNDATIONS.md §6, §8

## Context

The CGOPS `applications` registry seeded People Center with database
`cgops-identity`, encoding the retired framing in which identity "graduates
out of CGOPS" into People Center. The current direction is the opposite:
CGOPS is becoming the platform's auth/permissions hub, and People Center is
the leadership relationship and development platform.

## Decision

The Supabase project for this application is **`cgops-people`**
(`https://jgwuaixztxatzjjxsvzc.supabase.co`), following the platform's
kebab-case `cgops-*` convention.

## Consequences

- At Phase 5, the CGOPS `applications` row must be updated
  (`database_name = 'cgops-people'`, reframed description) and the
  `governance_roadmap` row corrected, with a CGOPS `governance_decisions`
  ADR explicitly retiring the "identity graduates out of CGOPS" direction.
- Until then, the CGOPS registry is knowingly stale on this point.

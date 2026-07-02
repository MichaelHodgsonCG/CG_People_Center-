# ADR 0004 — People Center eligibility is position-level configuration, not salary status

- **Status:** Accepted (2026-07-01)
- **Contract refs:** PRODUCT_BRIEF.md §0.2 ("manager-first, not manager-only"),
  PUSH_ROSTER_ANALYSIS.md rev. 2

## Context

The first roster analysis selected the V1 population by salary status
(salaried = management). That works for one export but encodes a payroll
fact as an architectural rule. The population People Center exists to serve
is the **leadership population** — which includes hourly leadership-pipeline
positions such as Chef de Partie, and will grow over time by HQ decision,
not by compensation change.

## Decision

1. The sync pipeline answers **"should this person exist in People
   Center?"** — decided by **position eligibility**, never salary status.
   Compensation fields are not even read (normalization whitelist).
2. Eligibility is configuration, not code:
   - `positions.people_center_eligible boolean` — HQ-approved leadership
     pipeline positions are flagged eligible;
   - `positions.default_person_kind` — what `person_kind` an imported holder
     receives (Chef de Partie → `emerging_leader`; General Manager →
     `manager`);
   - `position_mappings` — source vocabulary → positions, per source system.
3. Initial eligible set: General Manager, Assistant General Manager,
   General Manager in Training, Head Chef, Sous Chef, **Chef de Partie**,
   Beverage Manager, Service Manager, Guest Service Manager, Events Manager.
   Supervisor is mapped but explicitly **not** eligible — supervisors enter
   only as HQ-approved emerging leaders (resolves D4's nomination half: HQ
   approves; admins add).
4. Growing the population = flipping flags / adding positions and mappings.
   No importer or schema changes.

## Amendment — Supervisors are eligible as Emerging Leaders (2026-07-02, approved)

The initial decision left Supervisor mapped but not eligible
(nomination-only). Approved change: **the Supervisor position is eligible**,
with `default_person_kind = 'emerging_leader'` — HQ approved the position
wholesale instead of per-person nomination
(migration `20260702110000_make_supervisor_eligible.sql`). Implemented as a
configuration flip with zero pipeline changes, exactly as this ADR intended.
D4's remaining scope is now only about individually flagging emerging
leaders who hold non-eligible positions.

## Consequences

- "GM in Training" is a real position in the vocabulary (supersedes the
  earlier map-to-AGM recommendation, P1-3).
- The needs-review queue, not silent skipping, catches management-flagged
  rows whose position is unmapped.
- A person's continued presence in People Center is a leadership decision;
  position changes in Push never automatically remove anyone.

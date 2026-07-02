-- ============================================================================
-- Migration: make_supervisor_eligible
-- Population decision (2026-07-02): Supervisors are part of the leadership
-- pipeline and enter People Center as EMERGING LEADERS.
--
-- Supersedes the Phase 1 nomination-only stance for the Supervisor position
-- (ADR 0004 amendment): HQ has approved the position wholesale rather than
-- per-person nomination. This is the eligibility model doing its job — the
-- population grows by flipping position configuration, with zero pipeline
-- or code changes (the 'supervisor' source mapping already exists).
--
-- Idempotent: guarded UPDATE. Safe to run twice.
-- ============================================================================

update public.positions
set people_center_eligible = true,
    default_person_kind = 'emerging_leader',
    updated_by_name = 'migration 20260702110000'
where name = 'Supervisor'
  and (people_center_eligible = false or default_person_kind <> 'emerging_leader');

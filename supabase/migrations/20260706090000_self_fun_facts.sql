-- ============================================================================
-- Migration: self_fun_facts
-- Megan (2026-07-04): managers may add their own Fun Facts.
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- Widens the notes INSERT policy with a narrow self-service branch: any user
-- with app access may write a note ABOUT THEMSELVES when — and only when —
-- it is a Fun Fact (category 'relationship'), HQ visibility, and marked
-- voluntarily shared. Everything else about the model is unchanged:
--   * leadership/development/restricted writes remain leaders-and-up;
--   * self-authored fun facts are readable back by their author (the
--     existing author_auth_uid rule and the audited function's self branch);
--   * chain visibility, audit, retention, and purge semantics untouched.
--
-- Idempotent: drop-then-create policy. Safe to run twice.
-- ============================================================================

drop policy if exists people_center_notes_insert on public.people_center_notes;
create policy people_center_notes_insert on public.people_center_notes
  for insert to authenticated
  with check (
    author_auth_uid = auth.uid()
    and (
      public.people_center_current_role()
        in ('admin', 'executive', 'regional_leader', 'location_leader')
      or (
        -- self-service fun facts: about yourself, fun fact, voluntary
        public.people_center_has_app_access()
        and public.people_center_current_person_id() is not null
        and person_id = public.people_center_current_person_id()
        and category = 'relationship'
        and visibility = 'hq'
        and voluntarily_shared
      )
    )
  );

# ADR 0009 — Phase 4: succession, timeline, bench — built ahead of Phase 3

- **Status:** Accepted (2026-07-03, Michael: "let's begin on phase four —
  I would like Megan to see that")
- **Implemented by:** migration
  `20260704120000_create_succession_and_timeline.sql` + the Bench & Risk
  view and person-panel timeline.

## Decisions

1. **Phase order swap.** Phase 4 ships before Phase 3 for the VP People &
   Culture review. The Bench & Risk dashboard runs on data that exists
   today — succession coverage, key-seat depth, location leadership
   coverage (GM/Head Chef presence per location), and development-
   conversation staleness computed from notes ("never" + ">90 days") — and
   states on-screen that the readiness distribution arrives with Phase 3.
   Nothing is stored; every signal is computed live (brief §5: computed
   bench status can never go stale).
2. **Succession is executive-altitude only.** Slots and candidates are
   readable and writable by admins + executives, enforced in RLS. Exactly
   one scope per seat (location XOR region, review D9); unique person and
   unique rank per seat; deleting a seat cascades its candidates;
   "dismissed" coverage is computed (0 candidates = red, 1 = yellow,
   2+ = green).
3. **No person-linked succession events.** A "candidate added" event on a
   person's timeline would leak succession standing to chain ancestors
   below the executive level (and D6 promises subjects never see their own
   standing). Succession changes are audited normally, but events carry
   `person_id = null` with slot pointers only.
4. **Timeline visibility = the chain contract.** The Phase 0 events SELECT
   policy (admin-only) is widened to ADR 0008 rules: admins/executives, or
   strict ancestors of the subject — never the subject themselves (their
   timeline includes note.added pointers, which would reveal notes about
   them exist), with the departed-archive gate applied to the domain
   stream. The person panel renders the timeline as a projection
   (position changes, note activity), and the stream has been accumulating
   since Phase 2 — history exists from before this feature shipped.

## Consequences

- When Phase 3 ships readiness assessments, the bench view adds the
  readiness distribution and seat coverage graduates from candidate-count
  color to candidate-count × readiness (the brief's full computed bench
  status) — no schema changes to succession needed.
- Regional leaders currently see no succession surface; if their regions'
  bench view is wanted later, it is a deliberate widening of RLS +
  user_scopes, not a UI toggle.

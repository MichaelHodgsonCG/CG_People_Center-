# ADR 0008 — Chain-down visibility and the unified org graph

- **Status:** Accepted (2026-07-03) for the visibility rule and retention
  linkage (set by Michael); the org-graph ownership section records the
  agreed direction (People Center masters the graph; nothing new is built in
  CGOPS). Supersedes the role-ladder reading rules of ADR 0007 §1/§4 once
  implemented; ADR 0007's categories, constraints, audited-read mechanism,
  and author/self rules are unchanged.
- **Implementation:** COMPLETE (2026-07-03) — migrations
  `20260703140000_org_graph_bootstrap.sql` and
  `20260703150000_chain_visibility_and_archive.sql`.

## The rule

**A note about person X is readable only by people strictly ABOVE X in the
reporting chain — never peers, never anyone below X, never X themselves.**
The note's author can always read their own note. Sensitivity tiers then
narrow which ancestors qualify:

| Visibility | Readable by |
|---|---|
| `leadership` | any strict ancestor of the subject + author |
| `hq` (incl. all relationship notes) | ancestors who are HQ/executive/admin + author |
| `restricted` | author + admins + executives (unchanged) |

HQ sits at the top of the chain, so HQ/admins are ancestors of everyone —
the executive altitude is preserved. This replaces the pure role ladder: a
regional leader reads notes only within their own subtree, not across
regions; location leaders finally gain read access to notes about their own
teams (closing the D3 usability gap).

Accepted consequence: a leader evaluating a transfer-in from another subtree
cannot see that person's notes — only shared ancestors (HQ) can. Cross-
subtree exceptions, if ever needed, are a future explicit grant, not a
default.

## The org graph

- **People Center masters the entire leadership graph** in
  `people_center_people.manager_person_id` — including the HQ layer, who
  become people rows at the top of the chain ("manager-first, not
  manager-only" already permits people without imports or logins).
- **Nothing new is built in CGOPS.** CGOPS has no dedicated reporting table
  (verified 2026-07-03: only `user_profiles.manager_id`, which covers
  platform logins, not the roster). Creating the operational org chart there
  would violate CGOPS founding ADR #1. `user_profiles.manager_id` remains
  CGOPS-internal.
- **Bootstrap, not data entry.** In-location reporting lines are derived
  structurally (Chef de Partie → Sous Chef → Head Chef → GM; AGM and
  Service/Beverage/Guest Service/Events Managers and Supervisors → GM), with
  a seeded exception list. Human input needed only for: the HQ layer, the
  GM → regional/HQ mapping, and per-location exceptions.

## Retention linkage (NOTE_RETENTION_POLICY.md)

- `departed` people's notes are archived: admin-only, excluded from chain
  visibility and all surfaces. Access change only; rows stay in place.
- Only admins purge; five-year hold from departure; relationship notes
  purgeable on subject request at any time; audit log never purged.

## Confirmed org data (Michael, 2026-07-03; source: CG HQ & Ops org chart Jan 2026)

- Jody Palubiski (CEO) ← John Mackay (President, Beertown & Sociable),
  Megan Stover (VP People + Culture), Cindy Fawcett.
- John Mackay ← Tami Emuss (SKT, Oakville, Cambridge, Guelph),
  Chris Richards (London Masonville, London White Oaks, Waterloo),
  Camilla Johnson (Newmarket, Whitby), Caitlin O'Leary (Barrie, Toronto),
  Danny Walker (Etobicoke, Burlington).
- Cindy Fawcett covers The Bauer Kitchen, Sole, Wildcraft — reporting
  directly to the CEO for now.
- Supervisors operationally report to the manager on duty; their chain
  anchor is the GM (accountable manager).
- Bootstrap default: Chef de Partie → Head Chef (the template shows
  CdP → Sous, but locations have multiple sous chefs and the data cannot
  say which — admins refine per person in the panel). Sous → Head Chef →
  GM → regional; all other location roles → GM; fallbacks GM → regional;
  no-assignment people left null. manager_person_id is only set where NULL,
  so re-running the bootstrap never overwrites admin corrections.
- HQ scope: ops chain + VP People & Culture only (9 people rows); the rest
  of the HQ slide (accounting, marketing, directors) stays out until needed.

## Rollout order (data before enforcement)

1. Org-chart bootstrap: HQ people rows + derived in-location lines +
   GM → regional mapping (migration/script, idempotent).
2. `people_center_is_above(viewer_person, subject_person)` — recursive,
   cycle-guarded SECURITY DEFINER helper (review S2 realized).
3. RLS + audited-function swap to the table above; full persona matrix
   re-verified, including the departed/archive rules.
4. Departure/archive/purge machinery per the retention policy.

Flipping enforcement before the lines are populated would black out notes
for every non-author below HQ — data lands first, by design.

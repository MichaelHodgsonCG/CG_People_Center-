# Project Log

## [2026-07-16] Admin reporting-line editor (set manager in-UI)
**Shipped:**   Admins can now set a person's reporting line (manager) from the person panel's admin editor — a "Reporting line (manager)" picker listing active org members (labeled Name — Position · Location), writing manager_person_id. The person's own descendants + self are pruned from the list so a reporting loop can't be created. Fail-loud on RLS (same guard as other people writes) + records an audit row and a reporting_line.changed timeline event. Lets leadership rewire the org chart (e.g. Chef de Partie → the right Sous Chef) without SQL; chart redraws live. api.ts: fetchManagerCandidates() + setManager(). Frontend-only — deploy on Vercel to use.
**Roadmap:**   Reporting-structure admin settings -> shipped (code). Enables self-serve fixes for the CdP→Sous nesting (which Sous is leadership's call — no station data exists to infer it).
**Decisions:** Per-person manager picker in the existing AdminEditor (lowest friction, matches position/location reassignment pattern, chart redraws live) over a separate admin page; native select with descendant-pruning for cycle safety over a heavier typeahead (can upgrade later). Reporting-line change gets its own timeline event since it's business-meaningful. Confirmed RLS: people_center_people UPDATE allows admin/executive, no blocking triggers.
**Blockers:**  none
**Next:**      Deploy (batches with the undeployed item-1 seniority ordering). Then leadership sets CdP→Sous lines themselves; revisit whether a bulk reassignment tool is worth it for the ~39 Chef de Parties.

## [2026-07-16] Restaurant GMs joined to Regional Ops (roadmap 2) + Caitlin dedup
**Shipped:**   Verified the company chart is one connected tree: all 16 restaurant GMs → their Regional Operations Leader → John Mackay → Jody (CEO). The GM→ROL links were already set by the 1c HQ seed, so item 2 was functionally done. Found + fixed the one blemish: a duplicated Regional Operations Leader (HQ-seed off-roster stub with the title but no team vs. the real roster record with the 2 GMs but no title). Consolidated onto the roster record — added the ROL title to it (GMs already attached), ended the stub's assignment and marked the stub departed so it drops off the chart. Live data op (no code change). Final: Tami 4 GMs, Chris 3, Caitlin/Camilla/Danny 2 each (all → John Mackay); Cindy 3 (→ CEO).
**Roadmap:**   Roadmap item 2 (GMs → Regional Ops Leader, one company-wide chart) -> complete (live). No migration — data-only.
**Decisions:** Consolidate the duplicate onto the real roster record, not the seed stub (keeps the true identity + correct "Caitlin" spelling); retire the stub via status=departed (reversible) rather than hard delete. The stub/roster pair slipped past exact-name dedup because the seed misspelled the surname vs. the roster.
**Blockers:**  none
**Next:**      Roadmap 3: a way to ignore/remove non-emerging-leader Supervisors from the pipeline view (Michael's ask).

## [2026-07-16] Org-chart siblings ordered by seniority (roadmap 1)
**Shipped:**   OrgChartView now orders sibling nodes by position `level` (lower = more senior: GM 10 → AGM 25 → Sous 40 …) with full name as tiebreaker, instead of alphabetically. Query pulls `people_center_positions.level`; unranked positions sort last so a missing level never jumps someone above real managers. Applies to both list and chart views (they share `buildForest`). Frontend-only — deploy on Vercel to see it.
**Roadmap:**   Roadmap item 1 (org-chart seniority ordering) -> complete (code; deploy pending). Build passes (tsc + vite).
**Decisions:** Sort siblings only (children of each node); roots keep their existing descendant-count order. Unranked/null level -> Infinity (sorts last) rather than 0, so unconfigured positions don't masquerade as most-senior.
**Blockers:**  none
**Next:**      Roadmap 2: connect restaurant GMs to their Regional Ops Leader (set manager_person_id) for one company-wide chart.

## [2026-07-16] Michael admin fix + position ranking (1b) + HQ seed (1c)
**Shipped:**   (1) Root-caused the Positions-sync rejection: Michael's admin profile was linked to a deleted auth user, so the UI trusted him (role by email) but every DB write failed is_admin() (matches by auth.uid()). Re-pointed to his live auth user — all admin writes work now, no re-login. preferred_name "Michael"; login display untouched. (2) 1b: position levels (GM 10 -> Chef de Partie 50) + default_reports_to accountability lines + Senior Sous Chef. (3) 1c HQ seed: added 22 HQ titles to CGOPS positions (mirrored into People Center), created Head Office location, seeded 31 HQ people (20 new + 11 existing stubs reconciled) all off-roster with reporting lines + titles per the confirmed HQ chart. Verified tree matches.
**Roadmap:**   1b ranking + 1c HQ seed -> complete (live). Repo migration 20260716090000 (ranking) committed. HQ seed is a live data op (employee names kept out of the repo).
**Decisions:** HQ modeled as off-roster people at a "Head Office" location so titles render. HQ titles added CGOPS-side then mirrored. Riley/Darryl -> Todd Clarmo (single-manager approx of "report to Todd & Michael"). Cindy Fawcett -> CEO; Issac/Jennifer/Shanna -> CEO (change next fiscal). Chelsey -> Megan.
**Blockers:**  none. Supervisor left people_center_eligible=true (Michael's call).
**Next:**      Frontend: order org-chart siblings by position.level (data now exists). Connect restaurant GMs to their Regional Ops Leader. Queued: a way to ignore/remove supervisors who aren't emerging leaders. Then Phase 2 (upcoming-locations future view + New Restaurant Center dates) and Phase 3 (gap-analysis Word report; needs required-counts per role).

## [2026-07-15] Mobile "Visit" walk-in + org rules locked
**Shipped:**   New "Visit" nav view — mobile-first location → managers → notes: pick a restaurant, see its people seniority-ordered, tap to open the cheat sheet and read/add/save notes; last location remembered; big touch targets. Also fixed the Positions-sync error display ([object Object] → real Postgrest message). Both frontend-only; deploy on Vercel to use.
**Roadmap:**   1a Visit walk-in -> complete (code; deploy pending). Sync error-display fix -> shipped.
**Decisions:** Restaurant template locked — AGM sits between rank 2/3, reports to GM; FOH Supervisors -> GM by default; kitchen Chef de Cuisine > Senior Sous > Sous > Chef de Partie; Regional Ops Leaders -> John Mackay except Cindy Fawcett -> Jody (CEO); HQ titles created CGOPS-side then synced. Note: user is Chef Mike Hodgson — app session likely maps to a non-admin profile, the probable cause of the Positions-sync rejection.
**Blockers:**  Supabase paused at user's request — position-sync admin-role diagnosis, 1b (levels + template migration) and 1c (HQ seed) all wait on it.
**Next:**      When Supabase clears: confirm/fix sync admin-role; draft + apply 1b (position levels + per-concept required-role template) and 1c (HQ team seed from Chart 2).

## [2026-07-15] Position vocabulary sync (CGOPS -> People Center)
**Shipped:**   People Center positions now sync from the CGOPS Operational Center master instead of being a hand-seeded copy. New Data Sources → Positions tab: "Sync from CGOPS" button + a grid to toggle show-in-pickers / roster-eligibility / default kind per position. `people_center_sync_positions_from_cgops()` links by external_ref, refreshes CGOPS-owned fields, and materializes new CGOPS positions hidden+ineligible until curated. Pickers filter to curated positions; `Needs Position Review` placeholder hidden. Adding an HQ position = add once in CGOPS, sync, toggle on.
**Roadmap:**   Position vocabulary sharing -> complete (code shipped; migration 20260715120000 applied + verified on live project)
**Decisions:** Sync two tables over one shared table (ADR 0012) — the two lists are different curations (membership/granularity/columns), so sharing re-encodes the divergence + forces a live FK migration + couples PC to CGOPS lifecycle; field ownership (CGOPS=name/desc, PC=config) makes bi-directional editing safe; PC-side pull, not a CGOPS trigger, to keep PC logic off CGOPS's write path.
**Blockers:**  none
**Next:**      Deploy frontend; run first "Sync from CGOPS" (admin, in-app) to materialize the CGOPS catalog; toggle on HQ positions and fix Supervisor roster-eligibility drift in the same panel.

## [2026-07-15] Manual add + admin-confirmed Push linking
**Shipped:**   Add people by hand from the Directory — HQ (active, off-roster) and candidates (not-yet-hired), alongside incoming hires. A roster sync that name-matches an unlinked manual profile now holds it as a "possible match" (Data Sources → Pending links) for an admin to Confirm (links Push identity, preserves manual data) or Reject (imports as new). Candidates stay off the org chart. Confirmed answer to the sync-behavior question: uploads add + link, never merge/overwrite leadership-entered data.
**Roadmap:**   Manual people & Push linking -> complete (code); deploy + migration -> in progress (owner running)
**Decisions:** Admin-confirmed linking over auto-by-name (avoids false merges on common names); `candidate` status + `off_roster` flag over reusing active/incoming (distinguishes prospects and HQ; keeps sync from flagging HQ as missing); linking preserves manual data, only stamps `external_refs.push_source_key` + fills an empty assignment (upholds ADR 0005 "never overwrite"); reuse existing source_key correlation rather than a new link table.
**Blockers:**  Migration 20260709090000 must be applied to the CGOPS Platform Supabase project before the new UI works on live data (owner deploying).
**Next:**      Owner deploys + runs migration, then returns with feedback.

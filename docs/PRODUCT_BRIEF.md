# People Center — Starting Product Brief

> **Status:** Rev. 2 — reframed from "management and talent operating system"
> to **leadership relationship and development platform**; adds the manager
> cheat sheet, relationship knowledge, the four-category note system, and the
> "manager-first, not manager-only" population principle. Rev. 1 scope largely
> carries forward underneath the new framing.
> **Positioning:** a separate CG platform application — own GitHub repo
> (`cg_people_center`), own Vercel project, own Supabase project — designed
> from day one to integrate later with CGOPS.
> **Companion:** `docs/people-center/CGOPS_FOUNDATIONS.md` — the platform
> source of truth (current CGOPS architecture, naming conventions, auth
> direction, integration pattern) this brief builds on. Read it before
> scaffolding the repo.

---

## 0. Framing — what People Center is, in one sentence

**People Center is the leadership relationship and development platform for
CG: it helps HQ and senior leaders understand where each manager stands, what
they are working on, what they are capable of, what support they need, and
what we collectively know about them.**

It is a system of *relationship and development knowledge*, not a system of
employment record. Boundary statements that govern every scope decision:

1. **Do not replace Push.** Push remains the system for payroll, basic
   employee records, and team-member performance logging. People Center never
   masters that data and never duplicates HRIS/payroll functionality.
2. **Manager-first, not manager-only.** V1 populates managers and leaders —
   but the architecture treats "person in People Center" as anyone leadership
   is invested in: key team members and emerging leaders who show promise
   enter the same tables, profiles, and development machinery without any
   remodeling. Nothing in the schema may assume "person = manager."
3. **People Center owns people/talent/development data; CGOPS orchestrates.**
   Per the platform ADRs: applications own their own databases; CGOPS
   eventually orchestrates login, permissions, workflows, app access, and
   intelligence. People Center's data leaves only through deliberate,
   audience-scoped interfaces.
4. **Personal/relationship information is optional, voluntary, and
   permissioned.** It exists to help HQ build stronger relationships — never
   as surveillance, never as required fields, always auditable.

The test for any proposed feature: *does it help a leader understand, develop,
support, or deploy a person — or strengthen the relationship with them?* If
the honest answer is "it administers employment," it belongs in Push.

## 1. Purpose

People Center exists to answer, at any altitude (company → concept → region →
location), the questions HQ currently answers from memory, group chats, and
spreadsheets:

- **Who is ready for promotion?**
- **Who is open to relocating?**
- **Who needs coaching?**
- **Who has not had a development conversation recently?**
- **Who could cover a location?**
- **Who has opening experience?**
- **Which region has the strongest bench?**
- **Who should mentor this person?**
- **Who owns this assignment?**
- **Where are our people risks?**

And the relationship layer beneath them: what do we collectively know about
this person — their goals, strengths, circumstances, and context — so that
every HQ interaction starts warm instead of cold.

The strategic purpose: as CG grows, openings and operating stability are gated
by **leadership readiness and retention**, not by capital or sites. People
Center makes that constraint visible, managed, and personal.

## 2. Core users

| User | What they use it for |
|---|---|
| **HQ / executives / owners** | The manager cheat sheet before a visit or conversation; company-wide bench, readiness, and people-risk view; relocation and coverage questions; succession decisions. |
| **Regional / multi-unit leaders** | Their region's roster, readiness, and bench; capturing notes and assessments; development plans; mentor pairing. |
| **Location leaders** (GM, Head Chef) | Their own profile, development plan, and training status; notes and development for managers and emerging leaders under them. |
| **People & Culture lead** | Positions catalog, training catalog, data quality, succession review administration, note-policy stewardship. |
| **CGOPS (machine consumer, later)** | Pulls leadership/bench/readiness signal through People Center's summary endpoints for briefings and intelligence. |

Not users in V1: hourly team members at large (until flagged as emerging
leaders), recruiters/candidates, payroll/HR administrators.

## 3. Core product areas

The thirteen product areas, and what each means concretely:

1. **Manager/person directory** — everyone leadership is invested in:
   managers first, emerging leaders welcome. Search/filter by role, location,
   region, concept, readiness, flags.
2. **Leadership profile** — the full record: identity, position, location(s),
   reporting line, history, strengths, risks, career goals, relocation
   interest, mentor/successor links, development plan, readiness, training,
   notes, timeline.
3. **Manager cheat sheet** — the flagship surface: one screen that shows
   where someone stands. Leadership/business half: role, location, tenure,
   readiness, development focus, current assignments, strengths, risks,
   relocation interest, career goals, mentor and successor. Relationship half
   (permissioned, optional): family, spouse/children, hobbies, interests,
   where they live, personal context. Built as a *projection* of the profile —
   it stores nothing itself.
4. **Roles and locations** — local reference copies of the CGOPS org
   vocabulary (concepts, regions, locations, departments, positions) keyed by
   `external_ref`; never free-text names.
5. **Assignments and ownership** — two kinds: *position assignments* (person
   ↔ position ↔ location, with history) and *ownership assignments* (a person
   owns an initiative, an opening, a program, a coverage duty — so "who owns
   this?" has an answer).
6. **Development plans** — per person: plan with items (action, category,
   owner, target date, status). Lightweight kanban/checklist, not an LMS.
7. **Readiness by role** — assessments of a person against a target
   *position* (ready now / ready 6–12mo / developing / not on track), with
   assessor, date, rationale, and history. Staleness is surfaced, not hidden.
8. **Succession planning** — slots per key position per location/region:
   incumbent, ranked successors with readiness, mentor links.
9. **Training/development status** — catalog of trainings/certifications
   expected per position; per-person completion status. Tracking only — no
   content hosting.
10. **Leadership notes** — general leadership and development notes:
    attributed, timestamped, categorized observations forming the running
    leadership memory.
11. **Relationship notes** — the voluntary personal-context layer: family,
    interests, geography, circumstances. Deliberately a *flexible notes
    structure with visibility levels* rather than structured sensitive fields
    for every personal detail (see §5–6).
12. **Leadership timeline** — a person's history as a stream: position
    changes, readiness changes, plan milestones, notes, assignments — a
    projection of the append-only `events` table, not a separate data entry
    surface.
13. **Bench strength and people-risk dashboard** — the executive altitude:
    readiness distribution, bench heat map by region/concept, one-deep key
    positions, coverage candidates, stale development conversations, overdue
    training, concentration risks.

## 4. What it should NOT try to do yet

| Not yet | Why / who owns it |
|---|---|
| Payroll, compensation, benefits, employment records | Push / HR systems of record. Never People Center. |
| Team-member performance logging | Explicitly Push's job (write-ups, shift-level performance). People Center holds *leadership* development knowledge. |
| Scheduling, timekeeping, labour | Push. |
| Formal review cycles, ratings calibration, comp cycles | Heavyweight HRIS workflow; notes + readiness cover the leadership need. |
| Applicant tracking / recruiting | Different product; "emerging leader" flags are the only pipeline concept. |
| LMS / training content hosting | People Center tracks status against expectations; content lives elsewhere. |
| Engagement surveys, 360s | Future capability (§8). |
| Self-service for the broad team | No audience until the population expands. |
| CGOPS SSO / live integration on day one | Design the seams now (§7), integrate when CGOPS services exist. V1 runs standalone. |
| Native mobile app | Responsive web first — the cheat sheet must be excellent on a phone, but as a web page. |

## 5. Core data model

Owned by People Center's own Supabase project (shape — keys and essential
columns, not a migration). Follows the platform patterns documented in
`CGOPS_FOUNDATIONS.md` §10: RLS everywhere, audit columns everywhere,
append-only where history matters.

```sql
-- ORG REFERENCE (local copies of CGOPS vocabulary; external_ref = CGOPS uuid)
concepts    (id, name, external_ref, sort_order)
regions     (id, name, external_ref, sort_order)
locations   (id, name, code, concept_id, region_id, status, external_ref)
departments (id, name, external_ref, sort_order)
positions   (id, name, department_id, level int, is_key_position boolean,
             success_profile text, external_ref)

-- PEOPLE — anyone leadership is invested in (person ≠ auth user, ≠ employee record)
people (
  id, full_name, preferred_name, email, phone, photo_url,
  status text,                    -- 'active' | 'leave' | 'departed'
  person_kind text,               -- 'manager' | 'emerging_leader' | 'key_team_member'
  hire_date date,
  manager_person_id uuid,         -- reporting line within People Center
  home_city text,                 -- where they live (coarse, voluntary)
  relocation_interest text,       -- 'open' | 'preferred' | 'not_open' | 'unknown'
  career_goals text,
  strengths text,
  risks text,                     -- flight risk, burnout, gaps — leadership-visible
  mentor_person_id uuid,
  auth_user_id uuid,              -- nullable; linked when the person has a login
  external_refs jsonb             -- { cgops_user_id, push_employee_id } when known
)

-- ASSIGNMENTS — two kinds
position_assignments (
  id, person_id, position_id, location_id,
  is_primary boolean, started_on date, ended_on date       -- open-ended = current
)
ownership_assignments (
  id, person_id, title, description,
  kind text,                      -- 'initiative' | 'opening' | 'program' | 'coverage' | 'other'
  location_id?, region_id?,
  status text, started_on date, ended_on date
)

-- DEVELOPMENT
development_plans (id, person_id, title, status, owner_person_id, period)
development_plan_items (
  id, plan_id, description,
  category text,                  -- 'skill' | 'experience' | 'exposure' | 'training'
  owner_person_id, due_on,
  status text,                    -- 'open' | 'in_progress' | 'done' | 'dropped'
  completed_on, notes
)

-- READINESS BY POSITION (append-only history; latest surfaced, staleness shown)
readiness_assessments (
  id, person_id, target_position_id,
  rating text,                    -- 'ready_now' | 'ready_soon' | 'developing' | 'not_on_track'
  rationale, assessed_by, assessed_on
)

-- TRAINING (status only — no content)
trainings (id, key, title, category, validity_months?)
position_training_expectations (id, position_id, training_id, required boolean)
training_records (
  id, person_id, training_id,
  status text,                    -- 'complete' | 'in_progress' | 'overdue' | 'waived'
  completed_on, expires_on, verified_by
)

-- NOTES — one flexible structure, four categories, visibility levels
people_notes (
  id, person_id, author_id,
  category text,                  -- 'leadership' | 'development' | 'relationship' | 'restricted'
  visibility text,                -- 'chain' | 'leadership' | 'hq' | 'restricted'
  body, noted_on,
  voluntarily_shared boolean,     -- relationship notes: subject shared this willingly
  created_at                      -- append-only; deletion only via audited purge
)

-- SUCCESSION
succession_slots (id, position_id, location_id?, region_id?, incumbent_person_id?)
succession_candidates (id, slot_id, person_id, rank int, notes)
-- bench status (green/yellow/red) is COMPUTED from slots + candidates + latest readiness

-- EXPERIENCE FLAGS (answers "who has opening experience?" without archaeology)
person_flags (id, person_id, flag text, granted_on, granted_by)
  -- e.g. 'opening_experience' | 'multi_unit_ready' | 'trainer' | 'relief_gm'

-- PLATFORM SEAM (from day one)
events (id, event_type, person_id?, actor_id, context jsonb, created_at)
  -- append-only; the Leadership Timeline is a per-person projection of this
outcomes (id, category, person_id?, location_id?, summary, context jsonb, created_at)
audit_log (id, actor_id, actor_name, action, entity_type, entity_id,
           entity_label, summary, created_at)
  -- append-only, CGOPS pattern + a 'view' action for restricted/relationship reads
```

Design notes:

- **`people` ≠ auth users ≠ employee records.** A person exists without a
  login and without a Push record; `auth_user_id` and `external_refs` link
  the facets. This is both the "manager-first, not manager-only" seam and the
  future-SSO seam.
- **Relationship knowledge lives in notes, not columns.** The only structured
  personal fields are the ones leadership decisions actually turn on
  (`home_city`, `relocation_interest`); family, hobbies, and personal context
  are `relationship`-category notes with visibility levels — flexible,
  optional, purgeable, and permissioned as a class rather than field by field.
- **Cheat sheet and timeline are projections**, not tables — they render from
  `people` + latest readiness + plans + flags + notes (cheat sheet) and from
  `events` (timeline). Nothing to keep in sync.
- **History is first-class.** Assignments, readiness, notes, events are
  append-only; "time in role," "readiness trajectory," and "what happened
  around their last move" fall out of the model.
- **Computed bench status** — derives live from readiness + candidates so it
  can never go stale.
- **`external_ref` on all org tables** — CGOPS is the vocabulary master
  (`CGOPS_FOUNDATIONS.md` §7); People Center references, never renames.

## 6. Permission model

Talent and relationship data is the most sensitive data CG will hold. A
relationship note leaking — or a manager reading their own restricted notes —
is a trust-ending event. Strict by default, enforced in the database.

**V1 (local, Supabase RLS — patterns per `CGOPS_FOUNDATIONS.md` §3, §10):**

- **App roles:** `admin`, `executive`, `regional_leader`, `location_leader`,
  `viewer` — deliberately distinct from *positions* (jobs).
- **Scopes:** `user_scopes (auth_user_id, region_id?, location_id?)`; row
  access = role + (scope ∪ reporting line), enforced in RLS on every table.
- **Note visibility levels** (on top of row access), applying to all four
  categories:
  - `chain` — the subject's management chain and above;
  - `leadership` — regional leaders and above;
  - `hq` — executives/HQ and admins (the default for relationship notes);
  - `restricted` — author, admins, and executives only.
- **Relationship-note rules:** optional and voluntary by design — the UI
  frames them as "shared with us," `voluntarily_shared` is recorded, defaults
  to `hq` visibility, and the subject's relationship notes can be purged on
  request (the audited exception to append-only).
- **Restricted reads are audited:** `restricted` and `relationship` notes are
  read through an RPC/edge function that writes a `view` row to `audit_log`,
  not via direct table SELECT.
- **Self-view:** a person sees their own profile, development plan, and
  training status. They do **not** see notes about themselves or their
  readiness/succession standing in V1.
- **No `anon` access of any kind; every table born with RLS.**

**Designed-in CGOPS seam:** all checks flow through one `permissions` module
(`can(user, action, resource)`); roles/scopes live in two small tables. When
CGOPS becomes the permission authority, those tables become a synced
projection of CGOPS grants (RLS keeps enforcing locally); app code doesn't
change.

## 7. Integration points with CGOPS

People Center runs standalone in V1; every seam is designed in from day one.
Current platform reality — including the June 30 removal of the capability
contract layer — is documented in `CGOPS_FOUNDATIONS.md` §2–4; this section
assumes it.

1. **Identity / login.** V1: own Supabase Auth (email/password — the
   platform's current standard; PIN auth is retired). Target: CGOPS SSO; the
   `people.auth_user_id` link plus the `permissions` module make the swap a
   bounded change.
2. **Permissions.** Target: CGOPS grants (who may open People Center, at what
   role, over what scope) sync into local scope tables; RLS stays the local
   enforcer. CGOPS decides, People Center enforces.
3. **Application registry & launcher.** People Center is already seeded in
   the CGOPS `applications` table (repo `cg_people_center`); its row gets
   updated to the new framing, access flows through `application_access`, and
   it launches from CGOPS like every other app.
4. **Summary endpoints (contract-shaped).** People Center exposes named,
   versioned, read-only endpoints from its own Supabase — `get_bench_strength`,
   `get_people_readiness_summary`, `get_succession_risk`,
   `get_development_activity` — returning audience-scoped summaries and
   reference pointers, never raw notes and never relationship content. These
   are designed the way the retired capability contracts were shaped, so
   whatever integration mechanism CGOPS lands on can consume them unchanged.
5. **Executive/company briefing inputs.** The Company HQ Briefing (live in
   CGOPS today, V1) and the future Briefing Engine consume those endpoints:
   a "People & Bench" segment — readiness changes, red benches, stale
   development conversations — with leadership/business signal only.
6. **Org master data (consumer).** People Center seeds its org reference from
   CGOPS values and, once a sync exists, treats CGOPS as the vocabulary
   master via `external_ref` (locations, concepts, regions, departments,
   positions).
7. **Events / Context / Outcomes.** People Center emits the learning surface
   the platform roadmap already assigns it, for the future Continuous
   Learning Engine.

## 8. Future capabilities (explicitly out of V1)

- **9-box / talent grids** over readiness + notes signal.
- **Broader population** — the manager-first architecture opening to wider
  emerging-leader and key-team-member coverage as leadership practice matures.
- **Development conversation cadence** — structured 1:1/check-in workflows,
  potentially authored on the CGOPS Workflow Engine with People Center as the
  data home.
- **AI leadership briefing** — "prep me for my visit to Beertown Waterloo":
  cheat-sheet synthesis with strict category exclusions (relationship and
  restricted content never enters AI outputs by default).
- **Mentor-matching suggestions** from flags, readiness, and history.
- **Hiring-need forecasting** — growth plans × bench data ("we need 4
  GM-ready leaders by Q3").
- **Engagement & retention signal**; flight-risk indicators beyond the manual
  `risks` field.
- **Push read-reference** — read-only correlation of employment facts by
  external id through a connector. Read-only, ever.
- **LMS/training completion sync** into `training_records`.

## 9. Risks

| Risk | Notes / mitigation |
|---|---|
| **Relationship data misuse or leak** — the highest-stakes risk; personal context leaking destroys the trust the product exists to build. | Notes-not-fields design; `hq`-default visibility; voluntary framing + `voluntarily_shared`; audited reads; purge-on-request; excluded from all endpoints and AI outputs by design. This outranks features. |
| **Scope creep into HRIS/Push territory** | §0 boundaries + §4 table are the contract; "understand/develop/support/deploy or strengthen the relationship" is the admission test. |
| **Competing people masters** — CGOPS `user_profiles`, Push employees, People Center `people`. | Each masters its own facet; correlation via `external_refs`; a person requires neither a login nor a Push record (`CGOPS_FOUNDATIONS.md` §7). |
| **Notes as liability** — commentary that is discoverable, biased, or weaponized. | Category + visibility discipline; attribution and timestamps always; UI guidance ("observable, specific, developmental"); retention policy for `restricted` decided before Phase 2 ships broadly. |
| **Adoption failure** — empty dashboards if regional leaders don't capture notes/assessments. | Optimize the weekly capture loop and make the cheat sheet immediately useful to HQ — the cheat sheet being consulted is what motivates keeping it current. |
| **Stale data misleading decisions** | Assessment dates everywhere; staleness as a first-class dashboard signal ("no development conversation in 90 days" is itself an answer to a core question). |
| **Premature CGOPS coupling** — CGOPS SSO/permissions/contracts are still moving (capability layer was just removed). | Standalone V1; contract-shaped endpoints; integrate when services are real. |
| **Overbuild** — thirteen product areas is a platform, not a V1. | The build sequence ships a usable product by Phase 2; areas 12–13 are projections of data captured earlier, not new machinery. |

## 10. Recommended first build sequence

Detailed in `CGOPS_FOUNDATIONS.md` §9; summary — each phase ends with
something a leader uses:

- **Phase 0 — Skeleton:** repo, Supabase Auth, RLS baseline, brand shell,
  `audit_log` + `events`, permissions module.
- **Phase 1 — Directory, org reference, assignments:** the population is in
  and browsable; replaces the spreadsheet.
- **Phase 2 — Notes + Cheat Sheet v1:** four-category notes with enforced
  visibility; the flagship "where does this person stand" screen. *The HQ
  loop works from here.*
- **Phase 3 — Development, readiness, training:** plans, readiness-by-position
  with staleness, training status; the cheat sheet gets its development half.
- **Phase 4 — Succession, timeline, bench/risk dashboard:** the executive
  altitude; the ten questions in §1 are answerable.
- **Phase 5 — CGOPS integration:** registry/roadmap updates + ADR, SSO when
  available, summary endpoints, briefing segment, outcomes.

---

## Open questions (for review)

1. **Population boundary for V1:** managers + which emerging leaders? Who may
   add an `emerging_leader` person — regional leaders, or HQ only?
2. **Relationship-note default visibility:** `hq` (proposed) or wider
   (`leadership`)?
3. **Self-view line:** own plan and training visible, notes and readiness not
   — confirm.
4. **Supabase project name:** `cgops-people` (recommended) vs the registry's
   current `cgops-identity` (`CGOPS_FOUNDATIONS.md` §8).
5. **Restricted-note retention:** how long do `restricted` notes live, who
   can purge, and who owns the policy? Needed before Phase 2 ships broadly.

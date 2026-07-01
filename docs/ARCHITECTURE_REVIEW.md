# People Center — Architectural Review

> **Status:** Rev. 1 — pre-implementation review of `PRODUCT_BRIEF.md` (rev. 2)
> and `CGOPS_FOUNDATIONS.md` (rev. 1). Written before any code or migrations
> exist in this repository. Once approved, this review plus the two source
> documents form the architectural contract for `cg_people_center`.
> **Verdict up front:** the architecture is sound, consistent with the CGOPS
> platform philosophy, and buildable as specified. The issues below are
> clarifications and trims, not redesigns.

---

## 1. Understanding of the product vision (in my own words)

People Center is the institutional memory of Charcoal Group's leadership
bench. It answers two families of questions:

1. **Deployment questions** — who is ready for promotion, who could cover a
   location, who is open to relocating, which region's bench is thin, who owns
   this initiative, where are the people risks. Today these are answered from
   memory, group chats, and a spreadsheet; the company's growth rate is gated
   on leadership readiness, so the answers need to be visible, current, and
   queryable at every altitude (company → concept → region → location).

2. **Relationship questions** — what do we collectively know about this
   person: their goals, strengths, family context, circumstances — so every
   HQ interaction starts warm. This layer is voluntary, permissioned,
   audited, and purgeable by design, because leaking it would destroy the
   trust the product exists to build.

The flagship surface is the **manager cheat sheet**: one screen, excellent on
a phone, that shows where a person stands — a pure projection of data
captured elsewhere in the app, storing nothing itself.

What it deliberately is **not**: an HRIS. Push keeps payroll, employment
records, scheduling, and team-member performance logging. People Center holds
the *talent view* of a person, and a person can exist in it without a login
and without a Push record ("manager-first, not manager-only").

Architecturally it is a standard CG platform application: own repo, own
Vercel project, own Supabase project; standalone in V1 with every CGOPS seam
(SSO, permission sync, launcher, summary endpoints, events/outcomes) designed
in from day one but wired up only in Phase 5, when CGOPS services actually
exist. The admission test for any feature: *does it help a leader understand,
develop, support, or deploy a person — or strengthen the relationship?* If it
administers employment, it belongs in Push.

## 2. Contradictions, missing decisions, and clarifications needed

### 2.1 Contradictions found

**C1 — `restricted` is both a note category and a visibility level.**
`people_notes` has `category ∈ {leadership, development, relationship,
restricted}` and `visibility ∈ {chain, leadership, hq, restricted}`. The
brief's definition of a restricted *note* ("author, admins, and executives
only") is exactly the definition of `restricted` *visibility* — the two axes
encode the same fact twice, and the model permits incoherent rows like
`category='restricted', visibility='chain'`. §6 says visibility levels apply
"to all four categories," which makes the overlap worse, not better.
**Recommendation:** category describes *content type*, visibility describes
*audience*. Either (a) drop `restricted` as a category — a restricted note is
any note with `visibility='restricted'` — or (b) keep the four categories for
UI framing but enforce a category→minimum-visibility constraint in the
database (`relationship` ⇒ at least `hq`, `restricted` ⇒ exactly
`restricted`). Option (a) is simpler; either resolves the contradiction.
*Decision needed before Phase 2.*

**C2 — Who is an "actor": `person_id` vs `auth_user_id` is inconsistent.**
The model has `people_notes.author_id`, `readiness_assessments.assessed_by`,
`person_flags.granted_by`, `training_records.verified_by`,
`events.actor_id`, `audit_log.actor_id` — with no stated type. RLS naturally
checks `auth.uid()`, but auth identities are the thing that gets *swapped*
when CGOPS SSO lands, and a note whose author is an auth uuid loses its
attribution if identity migrates. **Recommendation:** every domain-level
actor/author column references `people.id` (with a denormalized
`*_name` per house style), resolved via a `current_person_id()`
SECURITY DEFINER helper alongside `is_admin()`. Only `audit_log` should also
record the raw auth uuid. This makes attribution survive the SSO swap —
which is the whole point of the `people ≠ auth` split.

**C3 — Purge-on-request vs append-only `events`.**
Relationship notes are purgeable, but note capture presumably also emits an
`events` row (the timeline is a projection of `events`). If note content or
even the note's existence is echoed into `events.context`, purge is
incomplete — the timeline would still show "relationship note added" after
the note is gone. **Recommendation:** make it a stated rule that `events`
rows carry **pointers, never content** (`entity_type`, `entity_id`,
content-free `context`) for purgeable categories — and that a purge cascades
to the events referencing the purged rows (purge remains the single audited
exception to append-only, now covering both tables). Simplest safe rule:
relationship/restricted notes emit **no** event at all; they are cheat-sheet
material, not timeline material.

### 2.2 Missing decisions (blocking, in phase order)

| # | Decision | Blocks | Notes |
|---|---|---|---|
| D1 | **Supabase project name** — `cgops-people` (recommended in both docs) vs registry's `cgops-identity` | Phase 0 | Already flagged; just needs a yes. |
| D2 | **Where app roles live.** §6 names five roles (`admin, executive, regional_leader, location_leader, viewer`) but the data model defines only `user_scopes(auth_user_id, region_id?, location_id?)` — no table holds the role itself. | Phase 0 | Recommend a CGOPS-style `user_profiles` table (`auth_user_id, person_id?, role, email`) created by a `handle_new_user()` trigger, with `user_scopes` alongside. This mirrors CGOPS exactly and is the projection target for future CGOPS grants. |
| D3 | **How `chain` visibility is evaluated.** "The subject's management chain and above" requires walking `people.manager_person_id` recursively inside RLS, mapping the viewer's `auth_user_id` → `person_id`, and explicitly *excluding the subject* (self-view says people never see notes about themselves, yet a person is trivially in their own chain). Also: a manager without a linked login can never be resolved as a viewer. | Phase 2 | Needs a defined algorithm and a SECURITY DEFINER helper (see §4/S2), not ad-hoc policy SQL. |
| D4 | **Population boundary & who may add people** (brief open question 1) | Phase 1 | Also determines who may set `person_kind='emerging_leader'`. |
| D5 | **Relationship-note default visibility** — `hq` (proposed) vs `leadership` (brief open question 2) | Phase 2 | Recommend `hq`; widen later if practice earns it. Narrowing later is a trust event; widening is not. |
| D6 | **Self-view line** — own plan + training visible; notes, readiness, succession not (brief open question 3) | Phase 2–3 | Recommend confirming as proposed. |
| D7 | **Restricted-note retention policy** — owner, lifetime, purge authority (brief open question 5) | Before Phase 2 ships broadly | Policy document, not schema. |
| D8 | **Read-audit granularity for the cheat sheet.** §6 says relationship and restricted notes are read via an RPC that writes a `view` audit row. The cheat sheet's relationship half will be the most-viewed surface in the app — auditing per note per render produces noise that buries signal. | Phase 2 | Recommend: one `view` audit row per (viewer, person, surface) per cheat-sheet load — "X viewed Y's relationship panel" — and per-note auditing only for `restricted`. |
| D9 | **`succession_slots` scoping** — `location_id?` and `region_id?` are both optional; can a slot be both, neither (company-wide)? | Phase 4 | Recommend a CHECK enforcing exactly one scope, or an explicit `scope_kind`. |

### 2.3 Smaller clarifications (non-blocking)

- `trainings.key` — purpose undefined (stable import identifier?). Name it or drop it.
- `locations.status` appears in the People Center copy but has no CGOPS counterpart (CGOPS has `exclude_from_reporting`). Fine as a local field, but say so.
- `position_assignments` should state its integrity rule: at most one *current primary* assignment per person (a partial unique index — worth deciding now, painful to retrofit).
- The house convention of "no router, view state in `App.tsx`" comes from CGOPS. People Center wants shareable deep links (a cheat sheet URL you can send before a visit). Recommend confirming: keep the convention in Phase 0–1, revisit at Phase 2 when the cheat sheet ships. Not blocking.

## 3. Architecture that should be simplified

**S1 — Collapse the note category/visibility matrix (from C1).** Two enums ×
two enums = 16 combinations, most meaningless. One visibility axis plus a
content-category tag with enforced minimums is the same product with half the
policy surface.

**S2 — One `visible_people` helper instead of per-table scope SQL.** "Row
access = role + (scope ∪ reporting line)" re-implemented in RLS on every
table (people, notes, plans, assessments, assignments, flags…) is the
recursion/duplication trap CGOPS already paid for once with `is_admin()`.
Define **one** SECURITY DEFINER function — `can_view_person(person_id)` or a
`visible_person_ids()` set — encapsulating role + scope + reporting-subtree +
chain logic, and have every person-scoped RLS policy delegate to it. One
place to reason about, one place to test, one place to fix.

**S3 — Two append-only streams need a written boundary.** `audit_log` and
`events` will otherwise drift into double-entry ("do I write one or both?").
Boundary: **`audit_log` is the compliance record** (every mutation + sensitive
reads; actor, entity, summary; never purged), **`events` is the domain
record** (business-meaningful moments: position change, readiness change,
plan milestone, leadership note — feeding timeline and future learning;
pointers, never content). One `record_event()` helper in the app enforces the
discipline.

**S4 — Skip the CSV importer UI in Phase 1.** The V1 population is the
management bench — dozens of rows, not thousands. A guarded seed script or an
admin "add person" form gets the data in for a fraction of the cost of a
column-mapping import UI. Revisit if the population ever expands 10×.

## 4. Over-engineered for the MVP

The brief already names the big risk ("thirteen product areas is a platform")
and mitigates it well — areas 12–13 being projections is the key insight.
Remaining trims:

1. **`outcomes` table in Phase 0.** Nothing writes it before Phase 5 and no
   consumer exists (the Continuous Learning Engine is future). An empty
   append-only table costs little, but it is pure ceremony with zero users —
   defer to Phase 5 alongside the summary endpoints. `events` + `audit_log`
   stay in Phase 0; they have day-one consumers (timeline, compliance).
2. **Five app roles at birth.** Phase 0–1 has an admin and a handful of
   viewers. Recommend: define the five-role enum now (cheap, and the
   vocabulary matters), but implement only `admin` vs non-admin enforcement
   until Phase 2, when notes make `executive/regional_leader/location_leader`
   distinctions real. Don't build and test five roles' worth of policy against
   an empty database.
3. **`chain` visibility in V1** (from D3). It is the hardest visibility level
   to enforce and only matters once location leaders are active users with
   reliably populated reporting lines. Shipping Phase 2 with
   `leadership/hq/restricted` and adding `chain` when the chain data is real
   is a legitimate cut — flagging it as an option, not a requirement.
4. **Training expiry machinery** (`validity_months`, `expires_on`, overdue
   computation) can land as a follow-up within Phase 3; plain status tracking
   answers the core question first.
5. **Versioned summary endpoints** are correctly deferred to Phase 5 — noting
   only that they should *stay* deferred even if tempting earlier; the
   "contract-shaped, not contract-coupled" stance is exactly right given
   CGOPS just removed its capability layer.

None of these change the schema's shape — they change when policy and
machinery get built.

## 5. Data model improvements (vision-preserving)

1. **`user_profiles` + explicit role storage** (D2): `user_profiles
   (id, auth_user_id unique, person_id?, email, role)` +
   `user_scopes (id, auth_user_id, region_id?, location_id?)`. Mirrors CGOPS,
   is the SSO projection target, and gives RLS a place to read roles from.
2. **All actor columns are `person_id` + denormalized name** (C2), resolved
   by `current_person_id()`.
3. **`events` gains `entity_type` / `entity_id`** and a no-content rule (C3),
   so the timeline can link to sources and purges stay complete.
4. **Note constraints** (C1): category→minimum-visibility CHECK; and
   `voluntarily_shared` required-true when `category='relationship'` (the
   column exists precisely for this; make the database say it).
5. **Integrity constraints stated now, not retrofitted:** one current primary
   position assignment per person (partial unique index); exactly-one-scope
   on `succession_slots` (D9); unique `(slot_id, person_id)` and unique
   `(slot_id, rank)` on `succession_candidates`; unique `(person_id, flag)`
   on `person_flags`.
6. **`person_flags.flag` gets a vocabulary.** Free-text flags recreate the
   `location_name` cleanup lesson in miniature. A seeded `flag_types` table
   (admin-extendable) keeps flags queryable — "who has opening experience"
   only works if the flag is spelled one way.
7. **Text-CHECK enums, not Postgres `enum` types**, for every `status`/
   `category`/`rating` column — alterable without migration pain, matching
   the idempotent-migration house style.
8. **`people.email` as `citext` + unique-where-not-null**, since it will be
   the natural correlation key when `auth_user_id` gets linked at SSO time.

Everything else in the §5 model I endorse as-is — in particular:
relationship knowledge in notes rather than columns, cheat sheet and timeline
as projections, computed bench status, append-only history, `external_ref`
on all org reference tables, and `people` independent of both auth and Push.

## 6. Consistency with the CGOPS platform philosophy — confirmed

| Principle | Verdict |
|---|---|
| Separate application (own repo `cg_people_center`, own Vercel `cg-people-center`) | ✅ Matches the established `cg_*` / kebab-case conventions. |
| Separate Supabase project (`cgops-people`, pending D1) | ✅ Owns its database; no cross-database reads in either direction. |
| Separate repository | ✅ This repo. |
| CGOPS as auth/permissions hub | ✅ with one *deliberate, documented* temporary divergence: V1 runs local Supabase Auth because CGOPS SSO does not exist yet. The `people.auth_user_id` link, the `user_profiles`/`user_scopes` projection tables, and the single `permissions` module make the swap a bounded change. This is the right call — coupling to a service that was partially dismantled on June 30 would be premature. |
| CGOPS as workflow / launcher / intelligence hub | ✅ Registry + `application_access` launch seam; contract-shaped read-only summary endpoints that never expose relationship/restricted content; events/outcomes emission per ADR 4. |
| ADR 1–3 (CGOPS never masters operational data; apps own their databases; CGOPS orchestrates) | ✅ People Center masters the talent facet; CGOPS masters org vocabulary and identity; Push masters employment. Correlation via `external_ref(s)` only. |

One required follow-through (already in the docs, restating as contract): at
Phase 5, the CGOPS `applications` row (`cgops-identity`, "identity graduating
out of CGOPS") and the `governance_roadmap` row must be updated and the
reframing recorded as a `governance_decisions` ADR — otherwise two
contradictory directions coexist in the platform registry.

## 7. Recommended initial repository structure

```
cg_people_center/
├── README.md                      # what this app is, boundaries, setup
├── docs/
│   ├── PRODUCT_BRIEF.md           # source of truth (rev. 2, committed)
│   ├── CGOPS_FOUNDATIONS.md       # platform ground truth (rev. 1, committed)
│   ├── ARCHITECTURE_REVIEW.md     # this document — the contract
│   └── decisions/                 # local ADRs, numbered (0001-*.md), starting
│                                  #   with the decisions in §2.2 as they close
├── supabase/
│   ├── migrations/                # YYYYMMDDHHMMSS_snake_case.sql, idempotent,
│   │                              #   doc comment block at top (house style)
│   └── functions/                 # edge functions (audited reads, later the
│                                  #   summary endpoints)
├── src/
│   ├── main.tsx
│   ├── App.tsx                    # top-level view state (house convention)
│   ├── assets/                    # CG brand per BRAND.md pattern
│   ├── lib/
│   │   └── supabase.ts            # single client, anon key only
│   ├── permissions/               # THE permissions module: can(user, action,
│   │                              #   resource) — every check flows through it
│   ├── types/                     # domain types mirroring the schema
│   ├── components/                # shared UI primitives
│   └── features/                  # one folder per product area as it lands:
│       ├── auth/                  #   Phase 0
│       ├── directory/             #   Phase 1
│       ├── people/                #   Phase 1 (profile)
│       ├── cheatsheet/            #   Phase 2
│       └── notes/                 #   Phase 2
├── index.html
├── package.json
├── vite.config.ts                 # publicDir: false, per house style
├── tailwind.config.ts
├── tsconfig.json
└── .env.example                   # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

Conventions carried from CGOPS: React 18 + Vite + TypeScript + Tailwind,
`lucide-react`, `@supabase/supabase-js`, no router library (revisit at
Phase 2 per §2.3), brand assets imported as modules, service-role keys only
inside edge functions, feature branches + descriptive migration filenames.

## 8. Phase 0 — Skeleton (proposed first milestone)

**Goal:** a scoped user logs into an empty, branded People Center shell;
every table is born with deny-by-default RLS; the audit and event seams
exist; the permissions module is the only door.

**Prerequisite decisions:** D1 (project name) and D2 (role storage). Both
have recommendations above; everything else in §2.2 can close later.

**Deliverables:**

1. **Scaffold** — Vite + React 18 + TS + Tailwind per §7; CG brand shell
   (monogram, wordmark, app frame); `.env.example`; README with the boundary
   statements from the brief §0.
2. **Supabase project** `cgops-people`; email/password auth enabled;
   no anon access anywhere.
3. **Migration 1 — identity & helpers:**
   `user_profiles` (auth link, email, role — five-role CHECK, `admin` the
   only role enforced in Phase 0), `handle_new_user()` trigger,
   `user_scopes`, `is_admin()` and `current_person_id()` as
   `SECURITY DEFINER STABLE, SET search_path = public`; deny-by-default RLS
   (`authenticated` only) on both tables.
4. **Migration 2 — platform seam:**
   `audit_log` (append-only: INSERT + SELECT policies only; actor person_id
   + auth uuid + denormalized name; `action` includes `view` for later) and
   `events` (append-only, with `entity_type`/`entity_id`, content-free
   `context` rule documented in the migration header). `outcomes` deferred
   to Phase 5 per §4.1.
5. **Permissions module** — `src/permissions` exporting
   `can(user, action, resource)`; Phase 0 truth table is small
   (admin: everything; others: sign in and see the shell) but every check in
   app code goes through it from the first commit.
6. **Auth flow** — login screen, session handling, signed-in empty shell
   ("Directory coming in Phase 1"), sign out. First admin bootstrapped by a
   guarded seed (promote-by-email), documented in the README.
7. **ADRs 0001–0003** in `docs/decisions/`: project naming (D1), role
   storage & actor-identity convention (D2/C2), audit-vs-events boundary
   (S3).

**Explicitly out of Phase 0:** `people` and all domain tables (Phase 1); any
CGOPS communication; CSV import (cut per S4); edge functions (none needed —
no restricted reads yet).

**Exit criteria:** a fresh clone + `.env` + migrations runs; an admin and a
non-admin can each log in and see the branded shell; a manual RLS probe as
`anon` and as non-admin `authenticated` returns zero rows from every table;
`audit_log` rejects UPDATE/DELETE; all migrations are idempotent (run-twice
test passes).

---

## Summary of what needs a decision to proceed

Phase 0 is unblocked by exactly two decisions — **D1** (`cgops-people`) and
**D2** (role storage; recommendation given). The three contradictions
(C1–C3) have concrete recommended resolutions and block Phase 2, not
Phase 0. Everything else is sequenced in §2.2. On approval of this review —
with amendments as decided — it becomes the contract for the repository.

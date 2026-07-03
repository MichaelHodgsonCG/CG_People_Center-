# People Center — Note Retention Policy

> **Status:** v1 — rules set by Michael Hodgson (policy owner, per ADR 0007
> D7) on 2026-07-03, with implementation refinements accepted. Applies to all
> `people_center_notes` categories and visibility levels, including
> restricted. This policy unblocks broad note capture by regional and
> location leaders.

## Rules

1. **Active people.** Notes live for as long as the subject is active (or on
   leave). No age-based expiry while employed.
2. **Purge authority.** Only admins may purge notes, ever. Every purge is an
   audited act (a `delete` row in `people_center_audit_log` recording actor,
   subject, and scope). Purging is the sole exception to the append-only
   rule.
3. **Departure → archive.** When a person's status becomes `departed`, all
   notes about them are **archived**: readable by admins only, excluded from
   every other surface (cheat sheet, timeline, chain visibility). Archive is
   an access change, not a data move — rows stay in place.
4. **Five-year hold.** Archived notes are retained for five years from the
   departure date, then purged in an annual admin review. Enforcement is
   manual-first (departure action archives; annual review purges); no
   automation until volume justifies it.
5. **Relationship-note exception (unchanged, absolute).** A subject's
   relationship-category notes are purgeable **on their request at any
   time**, regardless of employment status — this founding product
   commitment (PRODUCT_BRIEF.md §0.4) is not subject to the lifecycle above.
   Executed by an admin, audited.
6. **The audit log outlives the notes.** `people_center_audit_log` is never
   purged; the record that notes existed, were viewed, and were purged is
   permanent.

## Ownership

Michael Hodgson owns this policy; changes are made by amending this document
and recording the change in `docs/decisions/`.

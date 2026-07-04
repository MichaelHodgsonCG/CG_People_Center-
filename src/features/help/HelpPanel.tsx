// Help & info drawer — plain-language guide to every surface, opened from
// the header. Static content; sections note when a surface is role-gated.
// The succession section condenses docs/guides/SUCCESSION_PLANNING.md.

import { HelpCircle, X } from 'lucide-react'

export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <>
      <button
        aria-label="Close help"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-charcoal/20"
      />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col overflow-y-auto border-l border-surface-line bg-surface shadow-xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-surface-line bg-surface px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <HelpCircle className="h-5 w-5 text-cg-orange" /> How People Center works
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-charcoal/50 hover:bg-surface-muted hover:text-charcoal"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-4 p-5 text-sm leading-relaxed">
          <Section title="What this is">
            People Center is CG's leadership relationship and development
            platform: where each leader stands, what they're working on, and
            what we collectively know about them. It is not an HR system —
            payroll, scheduling, and employment records stay in Push.
          </Section>

          <Section title="Directory">
            Everyone leadership is invested in — managers, chefs, supervisors,
            emerging leaders. Search by name, filter by position, location, or
            kind. Click any person to open their cheat sheet. Admins and
            executives can also <b>add an incoming hire</b> — someone signed
            but not in Push yet — who appears immediately with their start
            date and is activated automatically when a later roster sync
            finds them.
          </Section>

          <Section title="The cheat sheet">
            One screen per person: role, location, reporting line, relocation
            interest, career goals, strengths, risks, notes, their development
            path progress, and their timeline. Use it before a visit or
            conversation so you start warm. Admins and executives can edit
            profiles, fix positions and reporting lines, and clear review
            flags from the Edit button.
          </Section>

          <Section title="Notes — and who can see them">
            Three kinds: <b>Leadership</b> (observations), <b>Development</b>{' '}
            (growth and coaching), and <b>Fun Facts</b> (personal context
            someone shared willingly — family, interests, circumstances).
            Visibility follows the reporting chain: <b>you can only read
            notes about people below you — never peers, never anyone above
            you, never yourself.</b> Fun facts save into their own Fun Facts
            section on the cheat sheet; they're HQ-only and every HQ view of
            them is recorded in the audit log (you always see the ones you
            wrote). Restricted notes are tighter still: author and executives
            only, in the Restricted section at the bottom. Write notes that
            are observable, specific, and developmental. And anyone can share
            a <b>fun fact about themselves</b> from their own cheat sheet —
            voluntary, removable on request.
          </Section>

          <Section title="Org Chart">
            The live reporting structure, from the CEO down, in two views:
            a compact <b>list</b> and a boxes-and-lines <b>chart</b> (the
            toggle is at the top right). It draws itself from each person's
            manager — fix a reporting line in someone's panel and the chart
            updates. People without a reporting line appear in their own list
            at the bottom so gaps stay visible.
          </Section>

          <Section title="Bench & Risk + Succession (executives only)">
            The company-wide view: leadership population, succession seats
            less than two deep, locations missing a GM or Chef de Cuisine,
            and stale development conversations (no note in 90+ days). Below
            the numbers, <b>succession planning</b>: create a seat per key
            position per location, name the incumbent, and rank successors —
            coverage computes itself (red = none, yellow = one deep, green =
            two+). The <b>FOH and BOH pipeline grids</b> show who holds every
            management seat at every restaurant; naming a seat's incumbent
            marks an already-hired leader as <i>(incoming)</i> at an upcoming
            location. Succession is invisible outside the executive level:
            nobody ever sees their own standing, and nothing about it appears
            on timelines. Full guide: <i>docs/guides/SUCCESSION_PLANNING.md</i>{' '}
            in the project repository.
          </Section>

          <Section title="Suggestions">
            The lightbulb in the header. Any idea, gap, or wording fix — big
            or small. You'll see your own suggestions and their status;
            admins triage all of them.
          </Section>

          <Section title="Data Sources (admins only)">
            Where the Push roster and the development-path workbooks load
            from. Re-uploading a newer roster is safe: people already in
            People Center are left untouched, new leaders are added, and
            anything ambiguous is imported with a "needs review" flag instead
            of being dropped. Development paths work the same way — sync the
            master workbook when questions change, upload a location's filled
            workbook (one tab per manager) to record quarterly scores, and
            re-uploads merge rather than overwrite.
          </Section>

          <Section title="Privacy, in one paragraph">
            Sensitive reads are audited, fun facts are voluntary and
            purgeable on request, departed people's notes are archived
            admin-only with a five-year hold, and every rule above is
            enforced in the database — not just the screen.
          </Section>
        </div>
      </aside>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-surface-line p-4">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-charcoal/50">
        {title}
      </h3>
      <p className="text-charcoal/80">{children}</p>
    </section>
  )
}

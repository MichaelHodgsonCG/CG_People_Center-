// Person detail side panel — Cheat Sheet v1 (PLATFORM_DESIGN_SYSTEM.md:
// details open in side panels; the cheat sheet is the flagship screen).
// Everything shown is a PROJECTION of people + assignments + notes; the
// panel stores nothing itself. The relationship half loads through the
// AUDITED database function — opening it IS the audit event (D8).

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Heart,
  History,
  Loader2,
  Lock,
  Pencil,
  Plus,
  X,
} from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { can, toPermissionUser } from '../../permissions'
import { DevelopmentPathSection } from './DevelopmentPathSection'
import type {
  Note,
  NoteCategory,
  NoteVisibility,
  UserProfile,
} from '../../types'
import {
  addNote,
  clearReviewFlag,
  purgeRelationshipNotes,
  fetchNotes,
  fetchTimeline,
  type TimelineEvent,
  fetchPersonDetail,
  fetchPersonName,
  fetchReferenceOptions,
  fetchRelationshipNotes,
  fetchRestrictedNotes,
  reassignPrimary,
  updatePersonProfile,
  type PersonDetail,
  type ProfileEdits,
  type ReferenceOption,
} from './api'

const KIND_LABELS = {
  manager: 'Manager',
  emerging_leader: 'Emerging leader',
  key_team_member: 'Key team member',
} as const

const RELOCATION_LABELS = {
  open: 'Open to relocating',
  preferred: 'Prefers to relocate',
  not_open: 'Not open',
  unknown: 'Unknown',
} as const

interface PersonPanelProps {
  personId: string
  session: Session
  profile: UserProfile | null
  onClose: () => void
  onChanged: () => void
}

export function PersonPanel({ personId, session, profile, onClose, onChanged }: PersonPanelProps) {
  const user = profile ? toPermissionUser(profile) : null
  const actor = actorFrom(profile, session)
  const isAdmin = user?.role === 'admin'
  const canEdit = can(user, 'update', 'person')
  const canWriteNotes = isAdmin || can(user, 'create', 'notes')

  const [person, setPerson] = useState<PersonDetail | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [relationshipNotes, setRelationshipNotes] = useState<Note[] | null>(null)
  const [restrictedNotes, setRestrictedNotes] = useState<Note[] | null>(null)
  const [managerName, setManagerName] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const reload = useCallback(() => {
    fetchPersonDetail(personId)
      .then((p) => {
        setPerson(p)
        if (p.manager_person_id) {
          void fetchPersonName(p.manager_person_id).then(setManagerName)
        } else {
          setManagerName(null)
        }
      })
      .catch((e: Error) => setError(e.message))
    fetchNotes(personId).then(setNotes).catch((e: Error) => setError(e.message))
    fetchTimeline(personId).then(setTimeline).catch(() => setTimeline([]))
    // Fun Facts load for everyone: privileged roles get the full HQ panel
    // (this call writes the panel-view audit row — D8, by design), everyone
    // else gets only the fun facts they authored themselves, un-audited.
    fetchRelationshipNotes(personId)
      .then(setRelationshipNotes)
      .catch((e: Error) => setError(e.message))
  }, [personId])

  useEffect(() => {
    setPerson(null)
    setNotes([])
    setRelationshipNotes(null)
    setRestrictedNotes(null)
    setEditing(false)
    setError(null)
    setSavedNotice(null)
    reload()
  }, [personId, reload])

  const currentPrimary = person?.position_assignments.find(
    (a) => a.is_primary && !a.ended_on,
  )
  const otherCurrent =
    person?.position_assignments.filter((a) => !a.is_primary && !a.ended_on) ?? []

  return (
    <>
      <button
        aria-label="Close panel"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-charcoal/20"
      />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col overflow-y-auto border-l border-surface-line bg-surface shadow-xl">
        <header className="sticky top-0 flex items-start justify-between gap-3 border-b border-surface-line bg-surface px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold leading-tight">
              {person?.full_name ?? 'Loading…'}
            </h2>
            {person && (
              <p className="mt-0.5 text-sm text-charcoal/60">
                {currentPrimary?.positions?.name ?? 'No current position'}
                {currentPrimary?.locations?.name
                  ? ` — ${currentPrimary.locations.name}`
                  : ''}
              </p>
            )}
            {person && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">
                  {KIND_LABELS[person.person_kind]}
                </span>
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs capitalize">
                  {person.status}
                </span>
                {person.data_quality_status === 'needs_review' && (
                  <span
                    title={person.data_quality_note ?? undefined}
                    className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
                  >
                    <AlertTriangle className="h-3 w-3" /> Needs review
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && person && (
              <button
                onClick={() => setEditing((e) => !e)}
                className="flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-sm hover:bg-surface-muted"
              >
                <Pencil className="h-4 w-4" /> {editing ? 'View' : 'Edit'}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-charcoal/50 hover:bg-surface-muted hover:text-charcoal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {error && (
          <p className="mx-5 mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {!person ? (
          <p className="flex items-center gap-2 p-6 text-sm text-charcoal/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : editing && canEdit ? (
          <AdminEditor
            person={person}
            actor={actor}
            canPurge={isAdmin}
            onSaved={() => {
              setEditing(false)
              reload()
              onChanged()
            }}
          />
        ) : (
          <div className="space-y-5 p-5">
            {person.status === 'departed' && (
              <p className="rounded-md border border-surface-line bg-surface-muted px-3 py-2 text-sm text-charcoal/70">
                Departed{person.departed_on ? ` ${person.departed_on}` : ''} — notes
                are archived (admin-only) with a five-year hold per the retention
                policy.
              </p>
            )}
            {/* Leadership half of the cheat sheet */}
            <section className="rounded-xl border border-surface-line p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-charcoal/50">
                Where they stand
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Fact label="Reporting line" value={managerName ?? '—'} />
                <Fact label="Hired" value={person.hire_date ?? 'Unknown'} />
                <Fact
                  label="Relocation"
                  value={RELOCATION_LABELS[person.relocation_interest]}
                />
                <Fact label="Home city" value={person.home_city ?? '—'} />
              </dl>
              {otherCurrent.length > 0 && (
                <p className="mt-2 text-xs text-charcoal/60">
                  Also:{' '}
                  {otherCurrent
                    .map(
                      (a) =>
                        `${a.positions?.name ?? '?'} at ${a.locations?.name ?? '?'}`,
                    )
                    .join('; ')}
                </p>
              )}
              <FactBlock label="Career goals" value={person.career_goals} />
              <FactBlock label="Strengths" value={person.strengths} />
              <FactBlock label="Risks" value={person.risks} />
            </section>

            {/* Development path — chain-visible projection (ADR 0010);
                renders nothing when RLS returns no assessments */}
            <DevelopmentPathSection personId={person.id} />

            {/* Notes */}
            <section className="rounded-xl border border-surface-line p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-charcoal/50">
                Leadership & development notes
              </h3>
              {savedNotice && (
                <p className="mb-3 flex items-center gap-1.5 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> {savedNotice}
                </p>
              )}
              {canWriteNotes ? (
                <NoteForm
                  onSubmit={async (n) => {
                    await addNote(actor, {
                      ...n,
                      personId: person.id,
                      personName: person.full_name,
                    })
                    // Tell the author exactly where their note now lives —
                    // fun facts and restricted notes render in their own
                    // sections below, not in this list.
                    if (n.visibility === 'restricted') {
                      setSavedNotice(
                        'Note saved — find it in the Restricted section below.',
                      )
                      fetchRestrictedNotes(person.id)
                        .then(setRestrictedNotes)
                        .catch((e: Error) => setError(e.message))
                    } else if (n.category === 'relationship') {
                      setSavedNotice(
                        'Fun fact saved — find it in the Fun Facts section below.',
                      )
                    } else {
                      setSavedNotice('Note saved.')
                    }
                    reload()
                  }}
                />
              ) : null}
              <NoteList
                notes={notes.filter(
                  (n) =>
                    n.visibility !== 'restricted' && n.category !== 'relationship',
                )}
                empty="No notes visible at your level yet."
              />
            </section>

            {/* Fun Facts (relationship category) — audited for HQ readers */}
            {relationshipNotes !== null && (
              <section className="rounded-xl border border-surface-line bg-surface-muted/40 p-4">
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal/50">
                  <Heart className="h-3.5 w-3.5" /> Fun Facts (shared with us)
                </h3>
                <p className="mb-3 flex items-center gap-1 text-[11px] text-charcoal/40">
                  <Eye className="h-3 w-3" />
                  {can(user, 'view', 'relationship_notes') || isAdmin
                    ? 'Viewing this panel is recorded in the audit log'
                    : 'You see the fun facts you wrote; HQ sees them all (audited)'}
                </p>
                <NoteList
                  notes={relationshipNotes}
                  empty="Nothing shared yet — fun facts are voluntary."
                />
              </section>
            )}

            {/* Leadership timeline — projection of the events stream */}
            {timeline.length > 0 && (
              <section className="rounded-xl border border-surface-line p-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal/50">
                  <History className="h-3.5 w-3.5" /> Timeline
                </h3>
                <ul className="space-y-1.5">
                  {timeline.map((ev) => (
                    <li key={ev.id} className="flex items-baseline gap-2 text-sm">
                      <span className="shrink-0 text-xs tabular-nums text-charcoal/40">
                        {new Date(ev.created_at).toLocaleDateString()}
                      </span>
                      <span>{describeEvent(ev)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Restricted — audited, behind an explicit action. Note authors
                also get this section: the database serves them only the
                restricted notes they wrote themselves (un-audited). */}
            {(isAdmin ||
              can(user, 'view', 'restricted_notes') ||
              can(user, 'create', 'notes')) && (
              <section className="rounded-xl border border-surface-line p-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal/50">
                  <Lock className="h-3.5 w-3.5" /> Restricted
                </h3>
                {restrictedNotes === null ? (
                  <button
                    onClick={() =>
                      fetchRestrictedNotes(person.id)
                        .then(setRestrictedNotes)
                        .catch((e: Error) => setError(e.message))
                    }
                    className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
                  >
                    {isAdmin || can(user, 'view', 'restricted_notes')
                      ? 'Load restricted notes (audited)'
                      : 'Show restricted notes I wrote'}
                  </button>
                ) : (
                  <NoteList notes={restrictedNotes} empty="No restricted notes." />
                )}
              </section>
            )}
          </div>
        )}
      </aside>
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-charcoal/40">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function FactBlock({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wide text-charcoal/40">{label}</p>
      <p className="whitespace-pre-wrap text-sm">{value}</p>
    </div>
  )
}

// UI label for the note category — the database keeps 'relationship' as the
// stored value; leadership renamed it "Fun Facts" for the screen (2026-07-03).
const CATEGORY_LABELS: Record<NoteCategory, string> = {
  leadership: 'leadership',
  development: 'development',
  relationship: 'fun fact',
}

function NoteList({ notes, empty }: { notes: Note[]; empty: string }) {
  if (notes.length === 0) {
    return <p className="text-sm text-charcoal/50">{empty}</p>
  }
  return (
    <ul className="space-y-3">
      {notes.map((n) => (
        <li key={n.id} className="rounded-md border border-surface-line/70 bg-surface p-3">
          <p className="whitespace-pre-wrap text-sm">{n.body}</p>
          <p className="mt-1.5 text-xs text-charcoal/50">
            {n.author_name} · {n.noted_on} · {CATEGORY_LABELS[n.category] ?? n.category} ·{' '}
            <span className={n.visibility === 'restricted' ? 'text-warning' : ''}>
              {n.visibility}
            </span>
          </p>
        </li>
      ))}
    </ul>
  )
}

const CATEGORY_DEFAULTS: Record<NoteCategory, NoteVisibility> = {
  leadership: 'leadership',
  development: 'leadership',
  relationship: 'hq', // D5 default
}

function NoteForm({
  onSubmit,
}: {
  onSubmit: (n: {
    category: NoteCategory
    visibility: NoteVisibility
    body: string
    voluntarilyShared: boolean
  }) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<NoteCategory>('leadership')
  const [visibility, setVisibility] = useState<NoteVisibility>('leadership')
  const [body, setBody] = useState('')
  const [voluntary, setVoluntary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRelationship = category === 'relationship'
  const visibilityChoices: NoteVisibility[] = isRelationship
    ? ['hq', 'restricted']
    : ['leadership', 'hq', 'restricted']

  function pickCategory(c: NoteCategory) {
    setCategory(c)
    setVisibility(CATEGORY_DEFAULTS[c])
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        category,
        visibility,
        body,
        voluntarilyShared: isRelationship ? voluntary : false,
      })
      setBody('')
      setVoluntary(false)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 flex items-center gap-1.5 rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover"
      >
        <Plus className="h-4 w-4" /> Add note
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-md border border-surface-line p-3">
      <div className="flex flex-wrap gap-2">
        <select
          value={category}
          onChange={(e) => pickCategory(e.target.value as NoteCategory)}
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="leadership">Leadership</option>
          <option value="development">Development</option>
          <option value="relationship">Fun fact</option>
        </select>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as NoteVisibility)}
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        >
          {visibilityChoices.map((v) => (
            <option key={v} value={v}>
              {v === 'leadership'
                ? 'Visible: regional leaders+'
                : v === 'hq'
                  ? 'Visible: HQ/executives'
                  : 'Restricted (author + executives)'}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        rows={3}
        placeholder={
          isRelationship
            ? 'A fun fact they shared with us — family, interests, milestones — voluntary, never required…'
            : 'Observable, specific, developmental…'
        }
        className="w-full rounded-md border border-surface-line bg-surface px-3 py-2 text-sm focus:border-charcoal focus:outline-none"
      />
      {isRelationship && (
        <label className="flex items-start gap-2 text-xs text-charcoal/70">
          <input
            type="checkbox"
            checked={voluntary}
            onChange={(e) => setVoluntary(e.target.checked)}
            required
            className="mt-0.5"
          />
          They shared this willingly (required — fun facts are voluntary by
          design and can be purged at their request)
        </label>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save note'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// Admin-only editor: profile fields, primary reassignment, review-flag clear.
function AdminEditor({
  person,
  actor,
  canPurge,
  onSaved,
}: {
  person: PersonDetail
  actor: ReturnType<typeof actorFrom>
  canPurge: boolean
  onSaved: () => void
}) {
  const [edits, setEdits] = useState<ProfileEdits>({
    preferred_name: person.preferred_name,
    email: person.email,
    phone: person.phone,
    status: person.status,
    person_kind: person.person_kind,
    home_city: person.home_city,
    relocation_interest: person.relocation_interest,
    career_goals: person.career_goals,
    strengths: person.strengths,
    risks: person.risks,
  })
  const [options, setOptions] = useState<{
    positions: ReferenceOption[]
    locations: ReferenceOption[]
  } | null>(null)
  const currentPrimary = person.position_assignments.find(
    (a) => a.is_primary && !a.ended_on,
  )
  const [positionId, setPositionId] = useState(currentPrimary?.position_id ?? '')
  const [locationId, setLocationId] = useState(currentPrimary?.location_id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchReferenceOptions().then(setOptions).catch((e: Error) => setError(e.message))
  }, [])

  function set<K extends keyof ProfileEdits>(key: K, value: ProfileEdits[K]) {
    setEdits((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await updatePersonProfile(actor, person.id, person.full_name, edits)
      const positionChanged =
        positionId &&
        locationId &&
        (positionId !== currentPrimary?.position_id ||
          locationId !== currentPrimary?.location_id)
      if (positionChanged && options) {
        await reassignPrimary(
          actor,
          person,
          positionId,
          locationId,
          options.positions.find((p) => p.id === positionId)?.name ?? '?',
          options.locations.find((l) => l.id === locationId)?.name ?? '?',
        )
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 p-5">
      {person.data_quality_status === 'needs_review' && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="mb-2 text-warning">{person.data_quality_note}</p>
          <button
            onClick={() =>
              clearReviewFlag(actor, person.id, person.full_name)
                .then(onSaved)
                .catch((e: Error) => setError(e.message))
            }
            className="rounded-md border border-warning/50 px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning/10"
          >
            Mark as reviewed (clear flag)
          </button>
        </div>
      )}

      {canPurge && (
      <div className="rounded-md border border-surface-line p-3 text-sm">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal/50">
          Retention actions (admin only)
        </p>
        <button
          onClick={() => {
            if (
              window.confirm(
                `Purge ALL fun facts about ${person.full_name}? This is the subject-request purge — irreversible and audited.`,
              )
            ) {
              purgeRelationshipNotes(person.id)
                .then((n) => {
                  window.alert(`${n} fun fact(s) purged (audited).`)
                  onSaved()
                })
                .catch((e: Error) => setError(e.message))
            }
          }}
          className="rounded-md border border-danger/40 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger/5"
        >
          Purge fun facts (subject request)
        </button>
      </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Preferred name">
          <input
            value={edits.preferred_name ?? ''}
            onChange={(e) => set('preferred_name', e.target.value || null)}
            className="w-full rounded-md border border-surface-line px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Email">
          <input
            value={edits.email ?? ''}
            onChange={(e) => set('email', e.target.value || null)}
            className="w-full rounded-md border border-surface-line px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Phone">
          <input
            value={edits.phone ?? ''}
            onChange={(e) => set('phone', e.target.value || null)}
            className="w-full rounded-md border border-surface-line px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Home city (voluntary)">
          <input
            value={edits.home_city ?? ''}
            onChange={(e) => set('home_city', e.target.value || null)}
            className="w-full rounded-md border border-surface-line px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Kind">
          <select
            value={edits.person_kind}
            onChange={(e) => set('person_kind', e.target.value as ProfileEdits['person_kind'])}
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="manager">Manager</option>
            <option value="emerging_leader">Emerging leader</option>
            <option value="key_team_member">Key team member</option>
          </select>
        </Field>
        <Field label="Status">
          <select
            value={edits.status}
            onChange={(e) => set('status', e.target.value as ProfileEdits['status'])}
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="active">Active</option>
            <option value="leave">Leave</option>
            <option value="departed">Departed</option>
          </select>
        </Field>
        <Field label="Relocation interest">
          <select
            value={edits.relocation_interest}
            onChange={(e) =>
              set('relocation_interest', e.target.value as ProfileEdits['relocation_interest'])
            }
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="unknown">Unknown</option>
            <option value="open">Open</option>
            <option value="preferred">Preferred</option>
            <option value="not_open">Not open</option>
          </select>
        </Field>
      </div>

      <Field label="Career goals">
        <textarea
          value={edits.career_goals ?? ''}
          onChange={(e) => set('career_goals', e.target.value || null)}
          rows={2}
          className="w-full rounded-md border border-surface-line px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Strengths">
        <textarea
          value={edits.strengths ?? ''}
          onChange={(e) => set('strengths', e.target.value || null)}
          rows={2}
          className="w-full rounded-md border border-surface-line px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Risks (leadership-visible)">
        <textarea
          value={edits.risks ?? ''}
          onChange={(e) => set('risks', e.target.value || null)}
          rows={2}
          className="w-full rounded-md border border-surface-line px-2 py-1.5 text-sm"
        />
      </Field>

      <div className="rounded-md border border-surface-line p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal/50">
          Current primary assignment
        </p>
        <div className="grid grid-cols-2 gap-3">
          <select
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">— position —</option>
            {options?.positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">— location —</option>
            {options?.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1.5 text-xs text-charcoal/50">
          Changing this ends the current primary assignment (history kept) and
          starts the new one today.
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      )}
      <button
        onClick={() => void handleSave()}
        disabled={saving}
        className="rounded-md bg-cg-orange px-4 py-2 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wide text-charcoal/50">
        {label}
      </span>
      {children}
    </label>
  )
}

function describeEvent(ev: TimelineEvent): string {
  const ctx = ev.context ?? {}
  switch (ev.event_type) {
    case 'position.changed':
      return `Primary assignment set to ${String(ctx.position ?? '?')} at ${String(ctx.location ?? '?')}`
    case 'note.added':
      return `${String(ctx.category ?? 'leadership')} note added`
    default:
      return ev.event_type.replace(/[._]/g, ' ')
  }
}

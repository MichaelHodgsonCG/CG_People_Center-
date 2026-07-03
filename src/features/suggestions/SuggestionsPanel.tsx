// Suggestion box — header lightbulb opens this drawer. Any role holder
// submits; authors see their own; admins see all and triage with a status.
// Built for review loops (e.g. the VP People & Culture pass): capture the
// thought where it occurs, with the current view recorded as context.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Lightbulb, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { UserProfile } from '../../types'

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  planned: 'Planned',
  done: 'Done',
  dismissed: 'Dismissed',
}

interface Suggestion {
  id: string
  body: string
  page_context: string | null
  status: keyof typeof STATUS_LABELS
  admin_response: string | null
  author_name: string
  created_at: string
}

interface SuggestionsPanelProps {
  profile: UserProfile | null
  pageContext: string
  onClose: () => void
}

export function SuggestionsPanel({ profile, pageContext, onClose }: SuggestionsPanelProps) {
  const isAdmin = profile?.role === 'admin'
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    supabase
      .from('people_center_suggestions')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setSuggestions((data as Suggestion[]) ?? [])
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('people_center_suggestions').insert({
      body,
      page_context: pageContext,
      author_name: profile?.display_name ?? profile?.email ?? 'unknown',
    })
    if (err) {
      setError(err.message)
    } else {
      setBody('')
      load()
    }
    setSaving(false)
  }

  async function setStatus(id: string, status: string) {
    const { error: err } = await supabase
      .from('people_center_suggestions')
      .update({ status, updated_by_name: profile?.display_name ?? profile?.email ?? 'admin' })
      .eq('id', id)
    if (err) setError(err.message)
    else load()
  }

  return (
    <>
      <button
        aria-label="Close suggestions"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-charcoal/20"
      />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col overflow-y-auto border-l border-surface-line bg-surface shadow-xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-surface-line bg-surface px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Lightbulb className="h-5 w-5 text-cg-orange" /> Suggestions
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-charcoal/50 hover:bg-surface-muted hover:text-charcoal"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <form
            onSubmit={handleSubmit}
            className="space-y-2 rounded-xl border border-surface-line p-4"
          >
            <label htmlFor="suggestion" className="block text-sm font-medium">
              What would make People Center better?
            </label>
            <textarea
              id="suggestion"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={3}
              placeholder="Ideas, gaps, wording, anything — big or small…"
              className="w-full rounded-md border border-surface-line bg-surface px-3 py-2 text-sm focus:border-charcoal focus:outline-none"
            />
            {error && <p className="text-xs text-danger">{error}</p>}
            <button
              type="submit"
              disabled={saving || !body.trim()}
              className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
            >
              {saving ? 'Sending…' : 'Send suggestion'}
            </button>
          </form>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal/50">
              {isAdmin ? 'All suggestions' : 'Your suggestions'}
            </h3>
            {suggestions.length === 0 ? (
              <p className="text-sm text-charcoal/50">Nothing yet — be the first.</p>
            ) : (
              <ul className="space-y-3">
                {suggestions.map((s) => (
                  <li key={s.id} className="rounded-md border border-surface-line p-3">
                    <p className="whitespace-pre-wrap text-sm">{s.body}</p>
                    <p className="mt-1.5 text-xs text-charcoal/50">
                      {s.author_name} · {new Date(s.created_at).toLocaleDateString()}
                      {s.page_context ? ` · from ${s.page_context}` : ''}
                    </p>
                    {s.admin_response && (
                      <p className="mt-1.5 rounded bg-surface-muted px-2 py-1 text-xs text-charcoal/70">
                        Response: {s.admin_response}
                      </p>
                    )}
                    <div className="mt-2">
                      {isAdmin ? (
                        <select
                          value={s.status}
                          onChange={(e) => void setStatus(s.id, e.target.value)}
                          className="rounded-md border border-surface-line bg-surface px-2 py-1 text-xs"
                        >
                          {Object.entries(STATUS_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">
                          {STATUS_LABELS[s.status]}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}

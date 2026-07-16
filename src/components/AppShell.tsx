// App shell per docs/platform/PLATFORM_DESIGN_SYSTEM.md: minimal header
// (logo, app name, brand indicator, user menu — no primary navigation),
// collapsed-by-default left navigation rail (icons always visible,
// expandable, preference remembered), light business-app theme.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ChevronsLeft,
  ChevronsRight,
  BarChart3,
  ClipboardList,
  Database,
  HelpCircle,
  Lightbulb,
  MapPin,
  Network,
  LogOut,
  ShieldAlert,
  Store,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { signOut } from '../features/auth/useSession'
import { can, toPermissionUser, type Resource } from '../permissions'
import type { UserProfile } from '../types'
import { SuggestionsPanel } from '../features/suggestions/SuggestionsPanel'
import { HelpPanel } from '../features/help/HelpPanel'
import monogram from '../assets/CG Logo Small.png'

export type View =
  | 'directory'
  | 'visit'
  | 'org_chart'
  | 'upcoming'
  | 'gaps'
  | 'bench'
  | 'data_sources'
  | 'users'

const NAV: { view: View; label: string; resource: Resource; icon: LucideIcon }[] = [
  { view: 'directory', label: 'Directory', resource: 'directory', icon: Users },
  { view: 'visit', label: 'Visit', resource: 'directory', icon: MapPin },
  { view: 'org_chart', label: 'Org Chart', resource: 'org_chart', icon: Network },
  { view: 'upcoming', label: 'Upcoming', resource: 'org_chart', icon: Store },
  { view: 'gaps', label: 'Gap Analysis', resource: 'bench', icon: ClipboardList },
  { view: 'bench', label: 'Bench & Risk', resource: 'bench', icon: BarChart3 },
  { view: 'data_sources', label: 'Data Sources', resource: 'data_sources', icon: Database },
  { view: 'users', label: 'Users', resource: 'admin_area', icon: UserCog },
]

const NAV_PREF_KEY = 'pc.nav.expanded'

interface AppShellProps {
  session: Session
  profile: UserProfile | null
  profileError: string | null
  view: View
  onNavigate: (view: View) => void
  children: ReactNode
}

export function AppShell({
  session,
  profile,
  profileError,
  view,
  onNavigate,
  children,
}: AppShellProps) {
  const user = profile ? toPermissionUser(profile) : null
  const visibleNav = NAV.filter((n) => can(user, 'view', n.resource))
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(NAV_PREF_KEY) === '1',
  )
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  function toggleNav() {
    setExpanded((prev) => {
      localStorage.setItem(NAV_PREF_KEY, prev ? '0' : '1')
      return !prev
    })
  }

  return (
    <div className="flex min-h-screen bg-surface text-charcoal">
      {/* Left navigation rail — collapsed by default, icons always visible */}
      <aside
        className={`flex shrink-0 flex-col border-r border-surface-line bg-surface-muted transition-all ${
          expanded ? 'w-52' : 'w-14'
        }`}
      >
        <div className="flex h-14 items-center justify-center border-b border-surface-line">
          <img src={monogram} alt="CG" className="h-6 w-auto" />
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Primary">
          {visibleNav.map((n) => {
            const Icon = n.icon
            const active = view === n.view
            return (
              <button
                key={n.view}
                onClick={() => onNavigate(n.view)}
                title={expanded ? undefined : n.label}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm ${
                  active
                    ? 'bg-cg-orange-soft font-medium text-cg-orange'
                    : 'text-charcoal/70 hover:bg-surface hover:text-charcoal'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {expanded && <span className="truncate">{n.label}</span>}
              </button>
            )
          })}
        </nav>
        <button
          onClick={toggleNav}
          aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
          className="m-2 flex items-center justify-center rounded-md p-2 text-charcoal/50 hover:bg-surface hover:text-charcoal"
        >
          {expanded ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header — app identity + user menu only */}
        <header className="flex h-14 items-center justify-between border-b border-surface-line bg-surface px-4 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-wide">People Center</span>
            <span className="hidden text-xs uppercase tracking-widest text-charcoal/40 sm:inline">
              CG Platform — Charcoal Group
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHelpOpen(true)}
              title="Help"
              aria-label="Help"
              className="rounded-md border border-surface-line p-1.5 text-charcoal/60 hover:bg-surface-muted hover:text-cg-orange"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            <button
              onClick={() => setSuggestionsOpen(true)}
              title="Suggestions"
              aria-label="Suggestions"
              className="rounded-md border border-surface-line p-1.5 text-charcoal/60 hover:bg-surface-muted hover:text-cg-orange"
            >
              <Lightbulb className="h-4 w-4" />
            </button>
            <UserMenu session={session} profile={profile} profileError={profileError} />
          </div>
        </header>
        <main className="flex-1 bg-surface">{children}</main>
      </div>

      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}

      {suggestionsOpen && (
        <SuggestionsPanel
          profile={profile}
          pageContext={view === 'data_sources' ? 'Data Sources' : view === 'org_chart' ? 'Org Chart' : view === 'upcoming' ? 'Upcoming' : view === 'gaps' ? 'Gap Analysis' : view === 'bench' ? 'Bench & Risk' : view === 'users' ? 'Users' : view === 'visit' ? 'Visit' : 'Directory'}
          onClose={() => setSuggestionsOpen(false)}
        />
      )}
    </div>
  )
}

// User menu with the role indicator: shows exactly what the app resolved
// from people_center_user_profiles (or why it resolved nothing), so
// role/permission issues are diagnosable from the UI instead of guesswork.
function UserMenu({
  session,
  profile,
  profileError,
}: {
  session: Session
  profile: UserProfile | null
  profileError: string | null
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const displayName =
    profile?.display_name ?? profile?.email ?? session.user.email ?? 'Signed in'

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-surface-line px-2.5 py-1.5 text-sm hover:bg-surface-muted"
      >
        {!profile && <ShieldAlert className="h-4 w-4 text-warning" />}
        <span className="max-w-40 truncate font-medium">{displayName}</span>
        {profile && <RoleBadge role={profile.role} />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-surface-line bg-surface p-3 text-sm shadow-lg">
          <p className="font-medium">{displayName}</p>
          <p className="text-xs text-charcoal/60">{session.user.email}</p>
          <div className="my-2 border-t border-surface-line" />
          <div className="flex items-center justify-between py-1">
            <span className="text-xs uppercase tracking-wide text-charcoal/50">
              Role (from people_center_user_profiles)
            </span>
            {profile ? (
              <RoleBadge role={profile.role} />
            ) : (
              <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                not resolved
              </span>
            )}
          </div>
          {!profile && (
            <p className="rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning">
              {profileError ?? 'No profile row found for this login.'}
            </p>
          )}
          <p className="mt-2 break-all text-[10px] text-charcoal/40">
            auth uid: {session.user.id}
          </p>
          <button
            onClick={() => void signOut()}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-sm hover:bg-surface-muted"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        role === 'admin'
          ? 'bg-cg-orange-soft text-cg-orange'
          : 'bg-surface-muted text-charcoal/70'
      }`}
    >
      {role.replace(/_/g, ' ')}
    </span>
  )
}

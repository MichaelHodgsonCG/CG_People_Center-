import { lazy, Suspense, useState } from 'react'
import { useSession } from './features/auth/useSession'
import { RedirectToCgops } from './features/auth/RedirectToCgops'
import { AppShell, type View } from './components/AppShell'
import { SessionTimeoutManager } from './components/SessionTimeoutManager'
import { UsersView } from './features/admin/UsersView'
import { DirectoryView } from './features/directory/DirectoryView'
import { VisitView } from './features/visit/VisitView'
import { OrgChartView } from './features/org/OrgChartView'
import { UpcomingView } from './features/upcoming/UpcomingView'
import { GapView } from './features/gaps/GapView'
import { BenchView } from './features/bench/BenchView'
import { can, toPermissionUser } from './permissions'

// Lazy: the sync pipeline (and its xlsx parser) only loads for admins who
// open Data Sources.
const DataSourcesView = lazy(() =>
  import('./features/data-sources/DataSourcesView').then((m) => ({
    default: m.DataSourcesView,
  })),
)

// Top-level view state lives here (house convention — no router library;
// revisit at Phase 2 per ARCHITECTURE_REVIEW.md §2.3 when the cheat sheet
// wants shareable deep links).
export default function App() {
  const { session, profile, profileError, loading } = useSession()
  const [view, setView] = useState<View>('directory')

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-charcoal/50">Loading…</p>
      </div>
    )
  }

  // Phase A: no standalone login — unauthenticated visits (and sign-outs)
  // go to CGOPS, which relaunches with the SSO handoff fragment.
  if (!session) return <RedirectToCgops />

  const user = profile ? toPermissionUser(profile) : null
  const guarded =
    (view === 'data_sources' && !can(user, 'view', 'data_sources')) ||
    (view === 'bench' && !can(user, 'view', 'bench')) ||
    (view === 'gaps' && !can(user, 'view', 'bench')) ||
    (view === 'users' && !can(user, 'view', 'admin_area'))
  const effectiveView: View = guarded ? 'directory' : view

  return (
    <>
      {/* Platform inactivity timeout (CGOPS authority — Platform Security.md):
          mounted once for the signed-in app; on timeout it signs out and the
          no-session branch above returns the user to the CGOPS login. */}
      <SessionTimeoutManager />
    <AppShell
      session={session}
      profile={profile}
      profileError={profileError}
      view={effectiveView}
      onNavigate={setView}
    >
      {effectiveView === 'data_sources' ? (
        <Suspense fallback={<p className="p-6 text-sm text-charcoal/50">Loading…</p>}>
          <DataSourcesView profile={profile} session={session} />
        </Suspense>
      ) : effectiveView === 'users' ? (
        <UsersView session={session} profile={profile} />
      ) : effectiveView === 'visit' ? (
        <VisitView session={session} profile={profile} />
      ) : effectiveView === 'org_chart' ? (
        <OrgChartView session={session} profile={profile} />
      ) : effectiveView === 'upcoming' ? (
        <UpcomingView session={session} profile={profile} />
      ) : effectiveView === 'gaps' ? (
        <GapView session={session} profile={profile} />
      ) : effectiveView === 'bench' ? (
        <BenchView session={session} profile={profile} />
      ) : (
        <DirectoryView session={session} profile={profile} isAdmin={user?.role === 'admin'} />
      )}
    </AppShell>
    </>
  )
}

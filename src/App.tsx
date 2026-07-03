import { lazy, Suspense, useState } from 'react'
import { useSession } from './features/auth/useSession'
import { RedirectToCgops } from './features/auth/RedirectToCgops'
import { AppShell, type View } from './components/AppShell'
import { DirectoryView } from './features/directory/DirectoryView'
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
  const effectiveView: View =
    view === 'data_sources' && !can(user, 'view', 'data_sources')
      ? 'directory'
      : view

  return (
    <AppShell
      session={session}
      profile={profile}
      profileError={profileError}
      view={effectiveView}
      onNavigate={setView}
    >
      {effectiveView === 'data_sources' ? (
        <Suspense fallback={<p className="p-6 text-sm text-charcoal/50">Loading…</p>}>
          <DataSourcesView profile={profile} />
        </Suspense>
      ) : (
        <DirectoryView isAdmin={user?.role === 'admin'} />
      )}
    </AppShell>
  )
}

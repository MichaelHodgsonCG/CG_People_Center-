// THE permissions module — every access check in app code flows through
// can(); no ad-hoc role checks in components (ARCHITECTURE_REVIEW.md §8.5,
// CGOPS_FOUNDATIONS.md §3). RLS remains the enforcement layer; this module
// exists so the UI and the database agree on one vocabulary.
//
// Authority decision (2026-07-02, supersedes the projection plan): CGOPS
// profiles are the source of truth for identity, role, and app access.
// people_center_user_profiles is only a temporary compatibility layer until
// Phase B of docs/RUNBOOK_CGOPS_LIFT_AND_SHIFT.md maps CGOPS roles into
// PermissionUser here — this signature is the seam and stays unchanged.
//
// Phase 0 truth table is deliberately tiny: admins can do everything; any
// authenticated user may view the shell. The five-role vocabulary is defined
// now, but executive/regional_leader/location_leader distinctions only become
// real in Phase 2 when notes land (review §4.2).

import type { AppRole, UserProfile } from '../types'

export type Action = 'view' | 'create' | 'update' | 'delete' | 'administer'

export type Resource =
  | 'shell'
  | 'admin_area'
  | 'directory'
  | 'org_chart'
  | 'bench' // succession + bench/risk dashboard (executive altitude)
  | 'data_sources'
  | 'person' // profile editing, assignments, review-flag clearing
  | 'notes' // leadership/development/relationship capture
  | 'own_fun_facts' // self-service fun facts on your own profile (20260706090000)
  | 'relationship_notes' // the cheat sheet's relationship half (audited read)
  | 'restricted_notes' // restricted-visibility notes (audited read)

export interface PermissionUser {
  role: AppRole
  personId: string | null
}

export function toPermissionUser(profile: UserProfile): PermissionUser {
  return { role: profile.role, personId: profile.person_id }
}

export function can(
  user: PermissionUser | null,
  action: Action,
  resource: Resource,
): boolean {
  if (!user) return false
  if (user.role === 'admin') return true

  // Phase 2 truth table — MUST mirror the RLS/definer rules in migration
  // 20260703120000 (the database is the enforcement layer; this module only
  // keeps the UI honest about it):
  //   * any role: shell + directory
  //   * executive / regional_leader / location_leader: write notes
  //   * executive (hq): relationship + restricted audited reads
  //   * person editing, Data Sources: admin only
  switch (resource) {
    case 'shell':
    case 'directory':
    case 'org_chart':
      return action === 'view'
    case 'notes':
      return (
        action === 'create' &&
        ['executive', 'regional_leader', 'location_leader'].includes(user.role)
      )
    case 'own_fun_facts':
      // Anyone with app access and a linked person record may share a fun
      // fact about themselves (migration 20260706090000 enforces the shape:
      // relationship category, hq visibility, voluntary).
      return action === 'create' && user.personId !== null
    case 'relationship_notes':
    case 'restricted_notes':
      return action === 'view' && user.role === 'executive'
    case 'bench':
      return user.role === 'executive'
    case 'person':
      // HQ profile editing (20260704160000) + incoming-hire creation
      // (20260707090000): executives edit profiles/assignments and add
      // incoming hires; delete stays admin-only.
      return (action === 'update' || action === 'create') && user.role === 'executive'
    default:
      return false
  }
}

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

export type Resource = 'shell' | 'admin_area' | 'directory' | 'data_sources'

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
  // Phase 1: any authenticated leader may view the shell and the directory;
  // Data Sources (lineage contains legal names) and all writes are
  // admin-only until Phase 2 makes the other roles real.
  return action === 'view' && (resource === 'shell' || resource === 'directory')
}

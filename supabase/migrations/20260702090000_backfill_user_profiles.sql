-- ============================================================================
-- Migration: backfill_user_profiles
-- Repair — create missing user_profiles rows for pre-existing auth users.
--
-- Context: handle_new_user() creates a profile when an auth user is INSERTED.
-- Any auth user created BEFORE the Phase 0 migrations were applied has no
-- profile row, which means:
--   * the app resolves no role (no navigation beyond the shell/directory);
--   * the promote-by-email UPDATE in the README silently matches 0 rows.
--
-- This migration backfills a 'viewer' profile for every auth user without
-- one, and re-asserts the trigger. Promotion to admin remains a manual step
-- (see README "Bootstrap the first admin", which now uses an upsert that
-- works whether or not the profile row exists).
--
-- Idempotent: guarded insert (ON CONFLICT DO NOTHING), drop-then-create
-- trigger. Safe to run any time.
-- ============================================================================

insert into public.user_profiles (auth_user_id, email)
select u.id, u.email
from auth.users u
where u.email is not null
on conflict do nothing;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

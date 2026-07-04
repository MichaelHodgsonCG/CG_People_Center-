import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getLastActivity, markActivity } from '../lib/sessionActivity';

// ---------------------------------------------------------------------------
// Platform inactivity timeout — the shared session manager for every CGOPS
// application (CGOPS and People Center in Phase 1; future apps mount this
// same component instead of building their own).
//
// Behaviour:
// - Watches mouse, keyboard, touch, scroll and hash navigation, plus API
//   activity (the supabase client marks activity on every data call — see
//   src/lib/supabase.ts). The clock is shared across tabs via localStorage.
// - The policy (enabled / 60 min timeout / 2 min warning) is read from the
//   platform via the get_session_policy() RPC, so Admin Center ->
//   Security -> Session Policy governs every app from one place. If the
//   policy can't be read, the defaults below still enforce the timeout.
// - Two minutes before timeout a warning dialog with a live countdown asks
//   the user to continue. Passive activity is intentionally ignored while
//   the warning is up — only "Stay signed in" (or activity in another tab)
//   dismisses it. With no response, the user is signed out and lands back
//   on the CGOPS login page.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MINUTES = 60;
const DEFAULT_WARNING_MINUTES = 2;

// LoginPage reads this to explain why the user was signed out.
export const TIMED_OUT_FLAG = 'cgops.session.timedOut';

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll', 'hashchange',
];

interface SessionPolicy {
  enabled: boolean;
  timeoutMs: number;
  warningMs: number;
}

export function SessionTimeoutManager() {
  const [policy, setPolicy] = useState<SessionPolicy>({
    enabled: true,
    timeoutMs: DEFAULT_TIMEOUT_MINUTES * 60_000,
    warningMs: DEFAULT_WARNING_MINUTES * 60_000,
  });
  const [warningOpen, setWarningOpen] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  // Refs mirror state the event/interval handlers need without re-binding.
  const warningOpenRef = useRef(false);
  const timedOutRef = useRef(false);

  // The session starts "active": signing in counts as activity.
  useEffect(() => { markActivity(); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_session_policy');
        const row = Array.isArray(data) ? data[0] : data;
        if (!cancelled && !error && row) {
          setPolicy({
            enabled: Boolean(row.timeout_enabled),
            timeoutMs: Number(row.timeout_minutes) * 60_000,
            warningMs: Number(row.warning_minutes) * 60_000,
          });
        }
      } catch {
        /* keep enforcing the defaults */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signOut = useCallback(async (dueToInactivity: boolean) => {
    if (timedOutRef.current) return;
    timedOutRef.current = true;
    if (dueToInactivity) {
      try { sessionStorage.setItem(TIMED_OUT_FLAG, '1'); } catch { /* ignore */ }
    }
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Inactivity sign-out failed:', err);
      timedOutRef.current = false;
    }
    // The auth state listener clears the user, returning the app to the
    // CGOPS login page.
  }, []);

  const continueSession = useCallback(() => {
    markActivity();
    warningOpenRef.current = false;
    setWarningOpen(false);
  }, []);

  useEffect(() => {
    if (!policy.enabled) return;

    const onActivity = () => {
      // While the warning is showing, a stray mouse move must not silently
      // extend the session — the dialog asks for an explicit answer.
      if (!warningOpenRef.current) markActivity();
    };
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }

    const tick = () => {
      const idle = Date.now() - getLastActivity();
      if (idle >= policy.timeoutMs) {
        void signOut(true);
      } else if (idle >= policy.timeoutMs - policy.warningMs) {
        warningOpenRef.current = true;
        setWarningOpen(true);
        setRemainingSeconds(Math.max(1, Math.ceil((policy.timeoutMs - idle) / 1000)));
      } else if (warningOpenRef.current) {
        // Activity in a sibling tab pushed the shared clock forward.
        warningOpenRef.current = false;
        setWarningOpen(false);
      }
    };
    tick();
    const interval = window.setInterval(tick, 1_000);

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
      window.clearInterval(interval);
    };
  }, [policy, signOut]);

  if (!warningOpen) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 flex items-center justify-center mb-4">
          <Clock className="w-7 h-7 text-amber-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Are you still there?</h2>
        <p className="text-sm text-slate-600">
          You've been inactive for a while. For security, you'll be signed out in
        </p>
        <p className="text-3xl font-bold text-slate-900 tabular-nums my-3">
          {minutes}:{String(seconds).padStart(2, '0')}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <button
            onClick={continueSession}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors"
          >
            Stay signed in
          </button>
          <button
            onClick={() => void signOut(false)}
            className="flex-1 flex items-center justify-center gap-2 border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-2.5 px-4 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}

export default SessionTimeoutManager;

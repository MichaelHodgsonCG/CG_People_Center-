// ---------------------------------------------------------------------------
// Shared user-activity clock for the platform inactivity timeout.
//
// This module is deliberately tiny and dependency-free so any CGOPS
// application can reuse it (People Center imports the same pair of files —
// see docs/platform/Platform Security.md). The last-activity timestamp is
// mirrored to localStorage so every tab of the same app shares one idle
// clock: activity in any tab keeps all of them alive, and the timeout fires
// only when the user is idle everywhere.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'cgops.session.lastActivity';

// How stale the persisted timestamp may get before we rewrite it. Activity
// events (mousemove especially) fire continuously; writing localStorage on
// every one would thrash storage events across tabs for no precision gain.
const WRITE_THROTTLE_MS = 5_000;

let lastActivity = Date.now();
let lastWrite = 0;

/** Record user or API activity "now". */
export function markActivity(): void {
  const now = Date.now();
  lastActivity = now;
  if (now - lastWrite >= WRITE_THROTTLE_MS) {
    lastWrite = now;
    try {
      localStorage.setItem(STORAGE_KEY, String(now));
    } catch {
      /* storage unavailable (private mode etc.) — in-memory clock still works */
    }
  }
}

/** Most recent activity across this tab and sibling tabs. */
export function getLastActivity(): number {
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    /* ignore */
  }
  return Math.max(lastActivity, stored);
}

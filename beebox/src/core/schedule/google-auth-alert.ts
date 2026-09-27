/**
 * Keep the Google grant verdict fresh, run by the scheduler daemon after each
 * box's tick (`box-alerts.ts`).
 *
 * Two jobs, in order:
 *  1. Refresh the verdict — `probeGoogleAuthIfStale` forces a token refresh at
 *     most about once a day, so an idle box still learns its grant expired
 *     rather than discovering it the next time someone syncs.
 *  2. Record each breakage once. The latch stores the `needsReauthSince` stamp
 *     already recorded, so the scheduler log names an episode once, and a
 *     repaired-then-broken-again grant is a new episode.
 *
 * A dead grant is a health entry (the `google-auth` check, with the reconnect
 * link) and never notifies on its own (docs/implemented-plans/notifications.md, Track E).
 * A boxholder-requested schedule it stops is promoted separately
 * (`promotion.ts`). See docs/plans/google-auth-reauth-health.md.
 */

import { probeGoogleAuthIfStale } from "../../google/auth-status.js";
import { loadTransientState, updateTransientState } from "../../transient-state.js";

const LATCH_NAME = "google-auth-alert";

interface AlertLatch {
  /** The `needsReauthSince` stamp already recorded, if any. */
  alertedForSince: string | null;
}

const EMPTY_LATCH: AlertLatch = { alertedForSince: null };

export interface GoogleAuthEpisode {
  /** Whether a fresh probe ran this tick. */
  probed: boolean;
  /** When the newly recorded breakage began. */
  since: string;
}

async function setLatch(boxRoot: string, alertedForSince: string | null): Promise<void> {
  await updateTransientState<AlertLatch>({
    boxRoot,
    connectorName: LATCH_NAME,
    defaultValue: EMPTY_LATCH,
    update: (s) => ({ ...s, alertedForSince }),
  });
}

/**
 * Probe if stale, then return the breakage episode when it is new. Returns
 * null when there is nothing new (grant healthy, never connected, or this
 * episode already recorded).
 */
export async function refreshGoogleAuth(boxRoot: string, { now }: { now: Date }): Promise<GoogleAuthEpisode | null> {
  const { probed, status } = await probeGoogleAuthIfStale(boxRoot, { now });
  const latch = await loadTransientState<AlertLatch>({ boxRoot, connectorName: LATCH_NAME, defaultValue: EMPTY_LATCH });

  // Healthy again (or never broken): drop the latch so the next breakage is new.
  if (!status.needsReauthSince) {
    if (latch.alertedForSince !== null) await setLatch(boxRoot, null);
    return null;
  }
  if (latch.alertedForSince === status.needsReauthSince) return null;
  await setLatch(boxRoot, status.needsReauthSince);
  return { probed, since: status.needsReauthSince };
}

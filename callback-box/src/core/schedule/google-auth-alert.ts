/**
 * Proactive "your Google connection died" alert, run by the scheduler daemon
 * after each box's tick (scheduler.ts), beside the scheduled-task health alert.
 *
 * Two jobs, in order:
 *  1. Refresh the verdict — `probeGoogleAuthIfStale` forces a token refresh at
 *     most about once a day, so an idle box still learns its grant expired
 *     rather than discovering it the next time someone syncs.
 *  2. Alert once per breakage. The latch stores the `needsReauthSince` stamp it
 *     alerted for, so a repaired-then-broken-again grant alerts again while a
 *     grant that stays broken stays quiet. No re-nag: the condition also holds
 *     a permanent dashboard warning and a `cb health` line, so repeating the
 *     message would add pressure without adding information.
 *
 * The notification carries a link to the admin page's Google Services section
 * rather than a one-click reconnect: `googleSetup` is an owner-gated procedure
 * that mints a one-time nonce, and pre-minting one into an outbound message is
 * exactly the token-fixation surface `google-oauth-state.ts` exists to close.
 *
 * See docs/plans/google-auth-reauth-health.md.
 */

import { boxSlug } from "../../lib/box-slug.js";
import { probeGoogleAuthIfStale } from "../../connectors/google-auth-status.js";
import { reauthorizeUrl } from "../../webapp/trpc/routers/health-google.js";
import { loadTransientState, updateTransientState } from "../../connectors/transient-state.js";
import { notifyBoxholder, notifyChannels } from "../notify-boxholder.js";
import type { TelegramService } from "../../services/telegram.js";
import type { PushService } from "../../services/push.js";

const LATCH_NAME = "google-auth-alert";

interface AlertLatch {
  /** The `needsReauthSince` stamp we have already alerted about, if any. */
  alertedForSince: string | null;
}

const EMPTY_LATCH: AlertLatch = { alertedForSince: null };

export interface GoogleAuthAlertResult {
  /** Whether a fresh probe ran this tick. */
  probed: boolean;
  /** The breakage timestamp alerted about, or null if nothing was sent. */
  alertedForSince: string | null;
  /** Whether the alert reached at least one channel. */
  delivered: boolean;
}

/**
 * Probe if stale, then send one notification per breakage episode. Returns null
 * when there is nothing to say (grant healthy, never connected, or already
 * alerted for this episode).
 */
export async function checkGoogleAuthAndAlert(
  boxRoot: string,
  { now, tg, push }: { now: Date; tg?: TelegramService; push?: PushService },
): Promise<GoogleAuthAlertResult | null> {
  const { probed, status } = await probeGoogleAuthIfStale(boxRoot, { now });

  const latch = await loadTransientState<AlertLatch>({
    boxRoot,
    connectorName: LATCH_NAME,
    defaultValue: EMPTY_LATCH,
  });

  // Healthy again (or never broken): drop the latch so the next breakage alerts.
  if (!status.needsReauthSince) {
    if (latch.alertedForSince !== null) {
      await updateTransientState<AlertLatch>({
        boxRoot,
        connectorName: LATCH_NAME,
        defaultValue: EMPTY_LATCH,
        update: (s) => ({ ...s, alertedForSince: null }),
      });
    }
    return null;
  }

  if (latch.alertedForSince === status.needsReauthSince) return null;

  const channels = await notifyChannels(boxRoot);
  if (!channels.telegram && !channels.push) return null;

  const slug = await boxSlug(boxRoot);
  const url = reauthorizeUrl(slug);
  const result = await notifyBoxholder(boxRoot, {
    title: `Google connection needs re-authorization (${slug})`,
    body: [
      "Your Google connection stopped working — the authorization expired or was revoked.",
      "Gmail, Calendar and Drive sync are paused until you reconnect.",
      "",
      `Reconnect: ${url}`,
    ].join("\n"),
    url,
    severity: "alert",
    name: "google-auth-alert",
    deliver: true,
    now,
    tg,
    push,
  });

  // Latch the episode. A delivery failure leaves an inspectable `failed` output
  // card rather than vanishing, so latching here can't silently drop the alert.
  await updateTransientState<AlertLatch>({
    boxRoot,
    connectorName: LATCH_NAME,
    defaultValue: EMPTY_LATCH,
    update: (s) => ({ ...s, alertedForSince: status.needsReauthSince }),
  });

  return {
    probed,
    alertedForSince: status.needsReauthSince,
    delivered: result.channels.length > 0,
  };
}

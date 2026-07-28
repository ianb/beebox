/**
 * Google-authorization health check.
 *
 * A dead OAuth grant used to surface only as a generic connector sync failure
 * in the logs. This turns it into a typed condition with the one action that
 * fixes it. It is a pure READER of the state recorded by
 * `connectors/google-auth-status.ts` — the refresh probe that keeps that state
 * fresh runs about daily from the scheduler tick, so health queries stay cheap
 * and can be run as often as anyone likes.
 *
 * See docs/plans/google-auth-reauth-health.md.
 */

import { readGoogleAuthStatus } from "../../../connectors/google-auth-status.js";
import { boxSlug } from "../../../lib/box-slug.js";
import { formatDurationShort } from "../../../core/schedule/health-box.js";
import type { HealthCheck } from "./health.js";

/** Where the admin page's Google Services section lives, ready to reconnect. */
export function reauthorizeUrl(slug: string): string {
  return `/${slug}/admin?reconnect=google`;
}

/**
 * One `google-auth` check, or none at all.
 *
 * Returns an empty list when Google isn't configured for this deployment or the
 * box has simply never connected it — neither is a problem, and a permanent
 * "not connected" line would be noise on every box that doesn't use Google.
 */
export async function googleAuthHealthChecks(
  boxRoot: string,
  { now }: { now: Date },
): Promise<HealthCheck[]> {
  const status = await readGoogleAuthStatus(boxRoot);
  if (!status.configured || !status.connected) return [];

  if (status.needsReauthSince) {
    const since = new Date(status.needsReauthSince).getTime();
    const age = Number.isNaN(since) ? null : formatDurationShort(now.getTime() - since);
    const reason = status.reauthReason ? ` (${status.reauthReason.split("\n")[0]})` : "";
    const slug = await boxSlug(boxRoot);
    return [{
      name: "google-auth",
      ok: false,
      message:
        `Google authorization expired or was revoked${age ? ` ${age} ago` : ""}${reason}`
        + " — Gmail, Calendar and Drive sync are paused."
        + ` Reconnect at ${reauthorizeUrl(slug)}`,
      severity: "warning",
    }];
  }

  const checked = status.authCheckedAt ? new Date(status.authCheckedAt).getTime() : null;
  const verified =
    checked !== null && !Number.isNaN(checked)
      ? `last verified ${formatDurationShort(now.getTime() - checked)} ago`
      : "not verified yet";
  return [{
    name: "google-auth",
    ok: true,
    message: `Google authorization is live (${verified})`,
    severity: "warning",
  }];
}

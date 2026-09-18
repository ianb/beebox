/**
 * The daily digest: once a day, one popup that summarises every schedule's
 * alerts, so nothing but `important` interrupts in between.
 *
 * The digest is a view over the alert records plus one timestamp
 * (`<store>/digest.json`); it keeps no list of its own. It runs early in the
 * tick, before any schedule, because schedules run serially and one can take
 * hours.
 *
 * Design: beebox/docs/plans/schedule-alert-signal.md (Track B).
 */

import type { Alert } from "./schedules.js";
import { readAllAlerts, readDigestState, writeAlert, writeDigestState } from "./schedules-store.js";
import { ALERTS_PAGE_URL, type RunnerDeps } from "./schedules-alerts.js";
import { closeAlert, FILING_RETRY_MS } from "./schedules-alert-lifecycle.js";

/** Local hour of the day the digest becomes due. A laptop asleep then sends it
 *  at the first tick after waking. */
export const DIGEST_HOUR = 9;

/** Due once per local day, at or after `DIGEST_HOUR`. */
export function digestDue(now: Date, lastDigestAt: string | null): boolean {
  const today = new Date(now);
  today.setHours(DIGEST_HOUR, 0, 0, 0);
  if (now.getTime() < today.getTime()) return false;
  return lastDigestAt === null || Date.parse(lastDigestAt) < today.getTime();
}

export interface DigestPlan {
  /** Null when there is nothing to say: no popup, but the stamp still moves. */
  popup: { title: string; message: string } | null;
  /** Open alerts this digest lists; each gets `digestedAt`. */
  listed: Alert[];
  /** fyi alerts an earlier digest listed: closed now. */
  closing: Alert[];
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * What one digest says and does. Every open `important` is listed (it stays
 * urgent until closed); `normal` alerts raised or updated since the last
 * digest; each `fyi` exactly once. Filing outcomes and cleared conditions whose
 * issue is still open ride along as lines of the message.
 */
export function digestPlan(alerts: readonly Alert[], input: { now: Date; lastDigestAt: string | null }): DigestPlan {
  const since = input.lastDigestAt === null ? Number.NEGATIVE_INFINITY : Date.parse(input.lastDigestAt);
  const nowMs = input.now.getTime();
  const open = alerts.filter((alert) => alert.state === "open");
  const important = open.filter((alert) => alert.priority === "important");
  const normal = open.filter((alert) => alert.priority === "normal" && Date.parse(alert.lastSeenAt) > since);
  const fyi = open.filter((alert) => alert.priority === "fyi" && alert.digestedAt === null);
  const closing = open.filter((alert) => alert.priority === "fyi" && alert.digestedAt !== null);
  const filed = open.filter((alert) => alert.issue !== null);
  const unfiled = open.filter((alert) =>
    alert.issue === null && alert.filingFailedSince !== null && nowMs - Date.parse(alert.filingFailedSince) >= FILING_RETRY_MS);
  const cleared = alerts.filter((alert) =>
    alert.state === "acknowledged" && alert.closedBy === "schedule" && alert.issue !== null
    && alert.acknowledgedAt !== null && Date.parse(alert.acknowledgedAt) > since);

  const counts = [
    important.length > 0 ? `${String(important.length)} important` : null,
    normal.length > 0 ? `${String(normal.length)} normal` : null,
    fyi.length > 0 ? `${String(fyi.length)} fyi` : null,
  ].filter((part) => part !== null);
  const lines = [
    filed.length > 0 ? `${plural(filed.length, "standing condition")} filed as issues` : null,
    unfiled.length > 0 ? `${plural(unfiled.length, "condition")} could not be filed` : null,
    cleared.length > 0 ? `${plural(cleared.length, "filed condition")} cleared; the issue can be closed` : null,
  ].filter((line) => line !== null);
  const popup = counts.length === 0 && lines.length === 0
    ? null
    : { title: `Schedules: ${counts.length === 0 ? "nothing new" : counts.join(" · ")}`, message: lines.length === 0 ? "Open the alerts page to review." : lines.join(" · ") };
  return { popup, listed: [...important, ...normal, ...fyi], closing };
}

/** Run the digest when it is due; called by the tick under its lock. */
export async function digestIfDue(deps: RunnerDeps): Promise<boolean> {
  const now = deps.now();
  const state = await readDigestState(deps.storeRoot);
  const lastDigestAt = state === null ? null : state.lastDigestAt;
  if (!digestDue(now, lastDigestAt)) return false;
  const plan = digestPlan(await readAllAlerts(deps.storeRoot), { now, lastDigestAt });
  const at = now.toISOString();
  for (const alert of plan.closing) await writeAlert(deps.storeRoot, closeAlert(alert, { closedBy: "digest", at }));
  for (const alert of plan.listed) await writeAlert(deps.storeRoot, { ...alert, digestedAt: at });
  // Stamped before the popup: a failed delivery must not send it twice.
  await writeDigestState(deps.storeRoot, { lastDigestAt: at });
  if (plan.popup !== null) {
    await deps.notify({ ...plan.popup, group: "schedule-digest", destination: ALERTS_PAGE_URL });
  }
  return true;
}

/**
 * Health checks over the notification log: notifications that failed on a
 * channel, notifications no channel could carry, and whether the log itself
 * can be appended to. The first two read the last 24 hours of the log; the
 * third probes by opening the file for append, so an unwritable log is
 * reported by a check that does not depend on reading it. The Jev budget
 * check rides along: a judgment deferred for budget is a check that did not
 * run, so a notification that did not go out. See
 * docs/plans/notifications.md (Tracks A and D).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errorMessage } from "../../lib/error-guards.js";
import { notificationLogPath, readRecent, type LoggedNotification } from "./log.js";
import { jevBudgetHealthCheck } from "../judgment/budget.js";

/** Structurally a `HealthCheck` (`webapp/trpc/routers/health.ts`). */
interface NotificationHealthCheck {
  name: string;
  ok: boolean;
  message: string;
  severity: "error" | "warning";
}

const MAX_LISTED = 5;

function listTitles(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED).join("; ");
  return items.length > MAX_LISTED ? `${shown}; and ${items.length - MAX_LISTED} more` : shown;
}

function undeliveredCheck(recent: LoggedNotification[]): NotificationHealthCheck {
  const failed = recent.flatMap((n) => {
    const failures = n.deliveries.filter((d) => d.status === "failed");
    if (failures.length === 0) return [];
    return [`"${n.intent.title}" (${failures.map((d) => `${d.channel}: ${d.detail ?? "failed"}`).join(", ")})`];
  });
  return {
    name: "notifications-undelivered",
    ok: failed.length === 0,
    message: failed.length === 0
      ? "No notification failed to deliver in the last 24 hours"
      : `${failed.length} notification(s) could not be delivered in the last 24 hours: ${listTitles(failed)}`,
    severity: "warning",
  };
}

/**
 * Nothing sent, nothing failed, and nobody present: no channel could carry it.
 * An intent with no delivery lines at all (a process that died between the two
 * writes) is not counted; the person may well have been reached.
 */
function hadNoChannel(n: LoggedNotification): boolean {
  return n.deliveries.length > 0 && n.deliveries.every((d) => d.status === "skipped" && d.detail !== "present");
}

function noChannelCheck(recent: LoggedNotification[]): NotificationHealthCheck {
  const stranded = recent.filter(hadNoChannel).map((n) => `"${n.intent.title}"`);
  return {
    name: "notifications-no-channel",
    ok: stranded.length === 0,
    message: stranded.length === 0
      ? "Every notification in the last 24 hours had a channel to reach the boxholder"
      : `${stranded.length} notification(s) in the last 24 hours had no channel to reach the boxholder ` +
        `(open the paired iPhone app, subscribe a browser to push, or set healthAlerts.telegramChat): ${listTitles(stranded)}`,
    severity: "warning",
  };
}

async function logWritableCheck(boxRoot: string): Promise<NotificationHealthCheck> {
  const logPath = notificationLogPath(boxRoot);
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const handle = await fs.open(logPath, "a");
    await handle.close();
    return { name: "notification-log-writable", ok: true, message: "The notification log is writable", severity: "warning" };
  } catch (e) {
    return {
      name: "notification-log-writable",
      ok: false,
      message: `The notification log is not writable (${errorMessage(e)}); notifications still send but leave no record`,
      severity: "warning",
    };
  }
}

export async function notificationHealthChecks(
  boxRoot: string,
  opts: { now: Date },
): Promise<NotificationHealthCheck[]> {
  const writable = await logWritableCheck(boxRoot);
  const budget = await jevBudgetHealthCheck(boxRoot, opts);
  let recent: LoggedNotification[];
  try {
    recent = await readRecent(boxRoot, { days: 1, now: opts.now });
  } catch (e) {
    return [
      writable,
      budget,
      {
        name: "notification-log-readable",
        ok: false,
        message: `The notification log could not be read: ${errorMessage(e)}`,
        severity: "warning",
      },
    ];
  }
  return [undeliveredCheck(recent), noChannelCheck(recent), writable, budget];
}

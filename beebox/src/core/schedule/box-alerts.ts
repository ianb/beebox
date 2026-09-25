/**
 * The proactive alerts the scheduler daemon runs after each box's tick. Each
 * one is isolated: an alert that throws is logged under its own event and
 * cannot suppress the others.
 *
 * - `health-alert`: scheduled tasks newly failing, overdue or invalid.
 * - `google-auth-alert`: refreshes the Google grant verdict about daily and
 *   alerts once per breakage.
 * - `connector-activity-alert`: a connector went quiet or keeps failing; one
 *   message per episode.
 */

import { errorMessage } from "../../lib/error-guards.js";
import { checkHealthAndAlert } from "./health-alert.js";
import { checkGoogleAuthAndAlert } from "./google-auth-alert.js";
import { checkConnectorActivityAndAlert } from "./connector-activity-alert.js";

/** A scheduler log entry, less the box, which the caller adds. */
type BoxAlertLogEntry = { ts: string; event: string } & Record<string, unknown>;

interface BoxAlert {
  event: string;
  /** Run the alert; returns the log fields for a sent alert, or null when there was nothing to say. */
  run: (boxRoot: string, now: Date) => Promise<Record<string, unknown> | null>;
}

const BOX_ALERTS: BoxAlert[] = [
  {
    event: "health-alert",
    run: async (boxRoot, now) => {
      const alert = await checkHealthAndAlert(boxRoot, { now });
      return alert === null ? null : { tasks: alert.alerted, delivered: alert.delivered };
    },
  },
  {
    event: "google-auth-alert",
    run: async (boxRoot, now) => {
      const alert = await checkGoogleAuthAndAlert(boxRoot, { now });
      return alert === null ? null : { since: alert.alertedForSince, delivered: alert.delivered };
    },
  },
  {
    event: "connector-activity-alert",
    run: async (boxRoot, now) => {
      const alert = await checkConnectorActivityAndAlert(boxRoot, { now });
      return alert === null ? null : { connectors: alert.alerted, delivered: alert.delivered };
    },
  },
];

export async function runBoxAlerts(boxRoot: string, log: (entry: BoxAlertLogEntry) => Promise<void>): Promise<void> {
  for (const alert of BOX_ALERTS) {
    try {
      const fields = await alert.run(boxRoot, new Date());
      if (fields !== null) await log({ ts: new Date().toISOString(), event: alert.event, ...fields });
    } catch (err) {
      await log({ ts: new Date().toISOString(), event: alert.event, error: errorMessage(err) });
    }
  }
}

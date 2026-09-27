/**
 * The health passes the scheduler daemon runs after each box's tick. None of
 * them notifies: each condition is a health check on the dashboard
 * (docs/implemented-plans/notifications.md, Track E). They keep each condition's
 * once-per-episode latch, and the scheduler log records an episode when it
 * begins. Each one is isolated: a pass that throws is logged under its own
 * event and cannot suppress the others.
 *
 * - `health-alert`: scheduled tasks newly failing, overdue or invalid.
 * - `google-auth-alert`: refreshes the Google grant verdict about daily and
 *   records each breakage.
 * - `connector-activity-alert`: brings connector quiet/failing episodes up to
 *   date, which the dashboard check and dismissals read.
 */

import { errorMessage } from "../../lib/error-guards.js";
import { recordScheduleEpisodes } from "./health-alert.js";
import { refreshGoogleAuth } from "./google-auth-alert.js";
import { updateConnectorEpisodes } from "./connector-activity-alert.js";

/** A scheduler log entry, less the box, which the caller adds. */
type BoxAlertLogEntry = { ts: string; event: string } & Record<string, unknown>;

interface BoxAlert {
  event: string;
  /** Run the pass; returns the log fields for a new episode, or null when there was nothing new. */
  run: (boxRoot: string, now: Date) => Promise<Record<string, unknown> | null>;
}

const BOX_ALERTS: BoxAlert[] = [
  {
    event: "health-alert",
    run: async (boxRoot, now) => {
      const episode = await recordScheduleEpisodes(boxRoot, { now });
      return episode === null ? null : { tasks: episode.tasks };
    },
  },
  {
    event: "google-auth-alert",
    run: async (boxRoot, now) => {
      const episode = await refreshGoogleAuth(boxRoot, { now });
      return episode === null ? null : { since: episode.since };
    },
  },
  {
    event: "connector-activity-alert",
    run: async (boxRoot, now) => {
      const episode = await updateConnectorEpisodes(boxRoot, { now });
      return episode === null ? null : { connectors: episode.connectors };
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

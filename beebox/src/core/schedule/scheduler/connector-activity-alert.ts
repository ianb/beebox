/**
 * Connector quiet/failing episodes, run by the scheduler daemon after each
 * box's tick (`box-alerts.ts`).
 *
 * The episode lives in the connector activity record (`connectors/activity.ts`):
 * it is stored when a verdict turns quiet or failing, stamped `notifiedAt` once
 * this pass has recorded it, and dropped when the condition clears, so a
 * relapse is a new episode. The dashboard shows the condition as a
 * `connector-activity:<name>` health check until it clears or the boxholder
 * dismisses it there.
 *
 * A new `failing` episode also sends one `quiet` notification: a connector
 * whose every sync fails has stopped bringing in what the boxholder connected
 * it for, which is the promotion rule's test ("health stays in the app unless
 * it blocks something asked for", docs/implemented-plans/notifications.md,
 * Track E; boxholder decision 2026-10-22, docs/plans/connector-failing-reaches-people.md).
 * A `quiet` episode is a statistical guess and stays on the dashboard. A
 * boxholder-requested schedule that needs the connector is promoted
 * separately (`promotion.ts`).
 */

import { boxLocalDay, updateConnectorActivity } from "../../../connector-activity/core.js";
import { evaluateConnectors, withEpisodes, type ConnectorEpisodeState } from "../../../connector-activity/verdict.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { notifyBoxholder, type NotifyServices } from "../../notify-boxholder.js";
import { GOOGLE_TARGET, RECONNECT_GOOGLE, googleReconnectApplies } from "../promotion.js";

interface ConnectorEpisodeResult {
  /** Connectors whose episode began since the last pass. */
  connectors: string[];
}

/** A newly failing connector, as the notice names it. */
interface FailingConnector {
  connector: string;
  since: string;
}

/** How a person knows each connector; others go by their connector name. */
const DISPLAY_NAMES: Record<string, string> = {
  gmail: "Gmail",
  "google-calendar": "Google Calendar",
  "google-drive": "Google Drive",
};

function isNew(state: ConnectorEpisodeState): boolean {
  return state.episode !== null && state.episode.notifiedAt === null && state.episode.dismissedAt === null;
}

function displayName(connector: string): string {
  return DISPLAY_NAMES[connector] ?? connector;
}

function joinNames(names: readonly string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * Tell the boxholder, once, that these connectors fail every sync. One
 * attempt: the episodes are already stamped, so a send that throws is logged
 * and never retried, and the dashboard warning still stands.
 */
async function notifyFailingConnectors(
  boxRoot: string,
  { failing, now, services }: { failing: FailingConnector[]; now: Date; services?: NotifyServices | undefined },
): Promise<void> {
  const names = failing.map(({ connector }) => displayName(connector));
  const reconnect = await googleReconnectApplies(boxRoot, failing.map(({ connector }) => connector));
  const body = [
    ...failing.map(({ connector, since }) => `${displayName(connector)} has failed every sync since ${since}.`),
    "New items may not be arriving. The error is on the dashboard.",
    ...(reconnect ? [RECONNECT_GOOGLE] : []),
  ].join("\n");
  try {
    await notifyBoxholder(boxRoot, {
      intent: {
        title: `${joinNames(names)} ${failing.length === 1 ? "has" : "have"} stopped syncing`,
        body,
        target: reconnect ? GOOGLE_TARGET : { kind: "dashboard" },
        loudness: "quiet",
        source: "connector-activity",
      },
      now,
      services,
    });
  } catch (e) {
    console.error(`[connector-activity] could not tell the boxholder that ${names.join(", ")} keep failing: ${errorMessage(e)}`);
  }
}

/**
 * Bring every connector's episode up to date, stamp the new ones, and send one
 * notice for those that are failing. Returns null when no episode is new.
 */
export async function updateConnectorEpisodes(
  boxRoot: string,
  { now, services }: { now: Date; services?: NotifyServices | undefined },
): Promise<ConnectorEpisodeResult | null> {
  const today = await boxLocalDay(boxRoot, now);
  let fresh: ConnectorEpisodeState[] = [];
  await updateConnectorActivity(boxRoot, (file) => {
    const states = evaluateConnectors(file, today);
    fresh = states.filter(isNew);
    const stamped = states.map((state) =>
      isNew(state) && state.episode !== null ? { ...state, episode: { ...state.episode, notifiedAt: now.toISOString() } } : state,
    );
    return withEpisodes(file, stamped);
  });
  const failing = fresh.flatMap(({ connector, verdict }) => verdict.kind === "failing" ? [{ connector, since: verdict.since }] : []);
  if (failing.length > 0) await notifyFailingConnectors(boxRoot, { failing, now, services });
  return fresh.length === 0 ? null : { connectors: fresh.map(({ connector }) => connector) };
}

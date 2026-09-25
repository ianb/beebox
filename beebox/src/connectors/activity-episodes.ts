/**
 * Reading and dismissing connector episodes for the dashboard. The scheduler
 * alert (`core/schedule/connector-activity-alert.ts`) is the only writer of new
 * episodes; this module reports them and records the boxholder's "this is
 * expected".
 */

import { boxLocalDay, loadConnectorActivity, updateConnectorActivity } from "./activity.js";
import { evaluateConnectors, withEpisodes, type ConnectorEpisodeState } from "./activity-verdict.js";

/** The connector has no quiet or failing episode to dismiss (it cleared, or never started). */
export class NoConnectorEpisodeError extends Error {
  constructor(connector: string) {
    super(`${connector} has no open quiet or failing episode to dismiss`);
    this.name = "NoConnectorEpisodeError";
  }
}

/** Connectors whose current episode the boxholder has not dismissed, computed live. */
export async function undismissedEpisodes(boxRoot: string, now: Date): Promise<ConnectorEpisodeState[]> {
  const today = await boxLocalDay(boxRoot, now);
  const states = evaluateConnectors(await loadConnectorActivity(boxRoot), today);
  return states.filter(({ episode }) => episode !== null && episode.dismissedAt === null);
}

/**
 * Mark `connector`'s current episode expected. It stays dismissed until the
 * condition clears; the next episode is a new one and is reported again.
 */
export async function dismissConnectorEpisode(boxRoot: string, opts: { connector: string; now: Date }): Promise<void> {
  const { connector, now } = opts;
  const today = await boxLocalDay(boxRoot, now);
  await updateConnectorActivity(boxRoot, (file) => {
    const states = evaluateConnectors(file, today).map((state) => {
      if (state.connector !== connector) return state;
      if (state.episode === null) throw new NoConnectorEpisodeError(connector);
      return { ...state, episode: { ...state.episode, dismissedAt: now.toISOString() } };
    });
    if (!states.some((state) => state.connector === connector)) throw new NoConnectorEpisodeError(connector);
    return withEpisodes(file, states);
  });
}

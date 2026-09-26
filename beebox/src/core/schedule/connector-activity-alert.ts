/**
 * Connector quiet/failing episodes, run by the scheduler daemon after each
 * box's tick (`box-alerts.ts`).
 *
 * The episode lives in the connector activity record (`connectors/activity.ts`):
 * it is stored when a verdict turns quiet or failing, stamped `notifiedAt` once
 * this pass has recorded it, and dropped when the condition clears, so a
 * relapse is a new episode. The dashboard shows the condition as a
 * `connector-activity:<name>` health check until it clears or the boxholder
 * dismisses it there. It never notifies on its own (docs/plans/notifications.md,
 * Track E); a boxholder-requested schedule that needs the connector is
 * promoted separately (`promotion.ts`).
 */

import { boxLocalDay, updateConnectorActivity } from "../../connectors/activity.js";
import { evaluateConnectors, withEpisodes, type ConnectorEpisodeState } from "../../connectors/activity-verdict.js";

interface ConnectorEpisodeResult {
  /** Connectors whose episode began since the last pass. */
  connectors: string[];
}

function isNew(state: ConnectorEpisodeState): boolean {
  return state.episode !== null && state.episode.notifiedAt === null && state.episode.dismissedAt === null;
}

/**
 * Bring every connector's episode up to date and stamp the new ones. Returns
 * null when no episode is new.
 */
export async function updateConnectorEpisodes(boxRoot: string, { now }: { now: Date }): Promise<ConnectorEpisodeResult | null> {
  const today = await boxLocalDay(boxRoot, now);
  let fresh: string[] = [];
  await updateConnectorActivity(boxRoot, (file) => {
    const states = evaluateConnectors(file, today);
    fresh = states.filter(isNew).map(({ connector }) => connector);
    const stamped = states.map((state) =>
      isNew(state) && state.episode !== null ? { ...state, episode: { ...state.episode, notifiedAt: now.toISOString() } } : state,
    );
    return withEpisodes(file, stamped);
  });
  return fresh.length === 0 ? null : { connectors: fresh };
}

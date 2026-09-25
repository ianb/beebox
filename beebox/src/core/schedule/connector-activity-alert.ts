/**
 * "A connector went quiet or keeps failing" alert, run by the scheduler daemon
 * after each box's tick (scheduler.ts), beside the task-health and Google-auth
 * alerts.
 *
 * One message per episode. The episode lives in the connector activity record
 * (`connectors/activity.ts`): it is stored when a verdict turns quiet or
 * failing, stamped `notifiedAt` once the message is sent, and dropped when the
 * condition clears, so a relapse alerts again while a condition that holds
 * stays quiet. The dashboard warning holds the condition until then, and the
 * boxholder can dismiss it there. Nothing repeats.
 *
 * With no channel configured nothing is stamped: the dashboard still shows the
 * warning, and a channel added later gets the message.
 */

import { boxSlug } from "../../lib/box-slug.js";
import { boxLocalDay, updateConnectorActivity } from "../../connectors/activity.js";
import { describeVerdict, evaluateConnectors, withEpisodes, type ConnectorEpisodeState } from "../../connectors/activity-verdict.js";
import { notifyBoxholder, notifyChannels } from "../notify-boxholder.js";
import type { TelegramService } from "../../services/telegram.js";
import type { PushService } from "../../services/push.js";

interface ConnectorActivityAlertResult {
  /** Connectors named in the message. */
  alerted: string[];
  /** Whether the message reached at least one channel. */
  delivered: boolean;
}

function needsMessage(state: ConnectorEpisodeState): boolean {
  return state.episode !== null && state.episode.notifiedAt === null && state.episode.dismissedAt === null;
}

/**
 * Bring every connector's episode up to date, then send one message covering
 * the episodes nobody has been told about. Returns null when there is nothing
 * new to say or no channel to say it on.
 */
export async function checkConnectorActivityAndAlert(
  boxRoot: string,
  { now, tg, push }: { now: Date; tg?: TelegramService; push?: PushService },
): Promise<ConnectorActivityAlertResult | null> {
  const today = await boxLocalDay(boxRoot, now);
  let fresh: ConnectorEpisodeState[] = [];
  await updateConnectorActivity(boxRoot, (file) => {
    const states = evaluateConnectors(file, today);
    fresh = states.filter(needsMessage);
    return withEpisodes(file, states);
  });
  if (fresh.length === 0) return null;

  const channels = await notifyChannels(boxRoot);
  if (!channels.telegram && !channels.push) return null;

  const slug = await boxSlug(boxRoot);
  const lines = fresh.flatMap(({ connector, verdict }) => {
    const line = describeVerdict(connector, verdict);
    return line === null ? [] : [`- ${line}`];
  });
  const result = await notifyBoxholder(boxRoot, {
    title: `A connector needs attention (${slug})`,
    body: [...lines, "", "If this is expected, dismiss it on the box dashboard."].join("\n"),
    url: `/${slug}/`,
    severity: "alert",
    name: "connector-activity-alert",
    deliver: true,
    now,
    tg,
    push,
  });

  // Stamp only the episodes this message covered, and only if they are still
  // the stored episode: one that ended or restarted meanwhile gets its own.
  // A delivery failure leaves an inspectable `failed` output card, so stamping
  // here cannot silently drop the alert (same contract as google-auth-alert).
  const sent = new Map(fresh.map(({ connector, episode }) => [connector, episode]));
  await updateConnectorActivity(boxRoot, (file) => {
    const connectors = { ...file.connectors };
    for (const [connector, episode] of sent) {
      const activity = connectors[connector];
      const stored = activity?.episode;
      if (activity === undefined || stored == null || episode === null) continue;
      if (stored.kind !== episode.kind || stored.since !== episode.since) continue;
      connectors[connector] = { ...activity, episode: { ...stored, notifiedAt: now.toISOString() } };
    }
    return { ...file, connectors };
  });

  return { alerted: fresh.map(({ connector }) => connector), delivered: result.channels.length > 0 };
}

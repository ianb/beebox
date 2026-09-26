/**
 * Which channels to try for one intent, from its loudness, who each channel
 * can reach, and whether a person is present in an open web app. Pure.
 *
 * - `loud`: every channel with an audience.
 * - `quiet`: every channel with an audience, unless someone is present, then
 *   none: the open app shows it.
 * - `dot`: `apns` only, whatever the presence. A dot is a badge; suppressing
 *   it for a person on some unrelated tab would lose it.
 *
 * Every candidate channel not tried gets a `skipped` delivery (`present` or
 * `no-audience`) for the caller to log. `web-push` and `telegram` are not
 * candidates for a `dot`, so they get no line. See docs/plans/notifications.md
 * (Track A).
 */

import { CHANNELS, type ChannelName, type Delivery, type Loudness } from "./intent.js";
import type { Presence } from "./presence.js";

/** Whether each channel has anyone to deliver to for this box. */
export type Audience = Record<ChannelName, boolean>;

export interface ChannelPlan {
  channels: ChannelName[];
  skipped: Delivery[];
}

function candidates(loudness: Loudness): readonly ChannelName[] {
  return loudness === "dot" ? ["apns"] : CHANNELS;
}

export function channelsToTry(opts: {
  intent: { loudness: Loudness };
  audience: Audience;
  presence: Presence;
}): ChannelPlan {
  const { intent, audience, presence } = opts;
  const channels: ChannelName[] = [];
  const skipped: Delivery[] = [];
  for (const channel of candidates(intent.loudness)) {
    if (intent.loudness === "quiet" && presence.activeWeb > 0) {
      skipped.push({ channel, status: "skipped", detail: "present" });
    } else if (!audience[channel]) {
      skipped.push({ channel, status: "skipped", detail: "no-audience" });
    } else {
      channels.push(channel);
    }
  }
  return { channels, skipped };
}

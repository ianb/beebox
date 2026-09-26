/**
 * Which channels to try for one intent, from its loudness, who each channel
 * can reach, and whether a person is present in an open web app. Pure.
 *
 * - `loud`: every channel with an audience.
 * - `quiet`: every channel with an audience, unless someone is present, then
 *   none: the open app shows it.
 * - `dot`: `apns` only, whatever the presence. A dot is a badge; suppressing
 *   it for a person on some unrelated tab would lose it.
 * - `onScreen`: the caller knows the target is on screen right now (a chat
 *   callout while a web session is present), so a `quiet` or `loud` is
 *   skipped `present` on every channel. A `dot` still badges.
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
  onScreen?: boolean | undefined;
}): ChannelPlan {
  const { intent, audience, presence } = opts;
  const suppressed =
    intent.loudness !== "dot" && (opts.onScreen === true || (intent.loudness === "quiet" && presence.activeWeb > 0));
  const channels: ChannelName[] = [];
  const skipped: Delivery[] = [];
  for (const channel of candidates(intent.loudness)) {
    if (suppressed) {
      skipped.push({ channel, status: "skipped", detail: "present" });
    } else if (!audience[channel]) {
      skipped.push({ channel, status: "skipped", detail: "no-audience" });
    } else {
      channels.push(channel);
    }
  }
  return { channels, skipped };
}

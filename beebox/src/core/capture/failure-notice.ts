/**
 * A capture that failed for good tells the person who has left: one `quiet`
 * notification to the chat it was headed for, sent only when nobody is present
 * in the app (an open app already shows the failed capture bubble). Success
 * sends nothing. See docs/implemented-plans/notifications.md (Track E). A bulk
 * upload that fails after its seal sends the same notice through
 * {@link notifyStagingFailed}, whatever the presence: no web UI shows it.
 */

import { errorMessage } from "../../shared/error-guards.js";
import { getBoxTime } from "../../lib/time.js";
import type { Target } from "../notification/target.js";
import { livePresence } from "../notification/presence.js";
import { notifyBoxholder, type NotifyResult, type NotifyServices } from "../notify-boxholder.js";
import { readStagingSession } from "./staging-manifest-io.js";

/**
 * Send the failure notice for staging session `id`. `reason` is one sentence
 * for the person. Returns null when someone is present and nothing was sent.
 * Never throws: it runs on an error path that must not mask the failure.
 */
export async function notifyCaptureFailed(
  boxRoot: string,
  opts: { id: string; reason: string; services?: NotifyServices | undefined },
): Promise<NotifyResult | null> {
  return notifyStagingFailed(boxRoot, {
    ...opts,
    title: "A capture could not be finished",
    source: "capture",
    // An open app already shows the failed capture bubble.
    skipWhenPresent: true,
  });
}

/**
 * The shared body of a staging failure notice: one `quiet` notification to the
 * chat the staged work was headed for (a new chat when none was resolved).
 * `skipWhenPresent` sends nothing while someone has the web app open, for a
 * flow whose own UI already shows the failure. Never throws.
 */
export async function notifyStagingFailed(
  boxRoot: string,
  opts: {
    id: string;
    title: string;
    reason: string;
    source: string;
    skipWhenPresent: boolean;
    services?: NotifyServices | undefined;
  },
): Promise<NotifyResult | null> {
  try {
    const now = getBoxTime(boxRoot);
    if (opts.skipWhenPresent && (await livePresence(boxRoot, { now })).activeWeb > 0) return null;
    const session = await readStagingSession({ boxRoot, id: opts.id });
    const sessionId = session?.targetSessionId ?? null;
    // With no chat resolved yet, a new chat carries the notice as its banner.
    const target: Target = sessionId === null ? { kind: "chat-new" } : { kind: "chat", sessionId };
    return await notifyBoxholder(boxRoot, {
      intent: { title: opts.title, body: opts.reason, target, loudness: "quiet", tag: `${opts.source}:${opts.id}`, source: opts.source },
      now,
      services: opts.services,
    });
  } catch (e) {
    console.error(`[${opts.source}] could not send the failure notice for ${opts.id}:`, e);
    return null;
  }
}

/** The one-sentence reason for a preparation that threw. */
export function capturePreparationReason(err: unknown): string {
  const first = errorMessage(err).split("\n")[0] ?? "";
  return `The capture could not be prepared: ${first}`;
}

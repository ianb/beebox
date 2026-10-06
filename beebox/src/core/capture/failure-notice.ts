/**
 * A capture that failed for good tells the person who has left: one `quiet`
 * notification to the chat it was headed for, sent only when nobody is present
 * in the app (an open app already shows the failed capture bubble). Success
 * sends nothing. See docs/implemented-plans/notifications.md (Track E).
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
  try {
    const now = getBoxTime(boxRoot);
    if ((await livePresence(boxRoot, { now })).activeWeb > 0) return null;
    const session = await readStagingSession({ boxRoot, id: opts.id });
    const sessionId = session?.targetSessionId ?? null;
    // With no chat resolved yet, a new chat carries the notice as its banner.
    const target: Target = sessionId === null ? { kind: "chat-new" } : { kind: "chat", sessionId };
    return await notifyBoxholder(boxRoot, {
      intent: { title: "A capture could not be finished", body: opts.reason, target, loudness: "quiet", tag: `capture:${opts.id}`, source: "capture" },
      now,
      services: opts.services,
    });
  } catch (e) {
    console.error(`[capture] could not send the failure notice for ${opts.id}:`, e);
    return null;
  }
}

/** The one-sentence reason for a preparation that threw. */
export function capturePreparationReason(err: unknown): string {
  const first = errorMessage(err).split("\n")[0] ?? "";
  return `The capture could not be prepared: ${first}`;
}

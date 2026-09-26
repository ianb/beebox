/**
 * Presence heartbeat. An open web tab calls `heartbeat` every 30 seconds while
 * a person has interacted with it in the last two minutes; the server counts
 * the tabs heard from in the last 90 seconds per box and keeps
 * `.beebox/presence.json` current for every process that decides whether to
 * notify (`core/notification/presence.ts`). See docs/plans/notifications.md
 * (Track A, presence).
 */

import { z } from "zod";
import { router, authedProcedure } from "../trpc.js";
import { createPresenceTracker, type PresenceTracker } from "../../../core/notification/presence-tracker.js";
import { writePresence } from "../../../core/notification/presence.js";
import { getBoxTime } from "../../../lib/time.js";

/** Often enough to write a drop to zero soon after the last tab's session expires. */
const SWEEP_MS = 15_000;

interface BoxPresence {
  tracker: PresenceTracker;
  sweep: ReturnType<typeof setInterval> | null;
}

const boxes = new Map<string, BoxPresence>();

function presenceFor(boxRoot: string): BoxPresence {
  let entry = boxes.get(boxRoot);
  if (entry === undefined) {
    entry = { tracker: createPresenceTracker(), sweep: null };
    boxes.set(boxRoot, entry);
  }
  return entry;
}

/** Write the file when the tracker says it is due; keep sweeping while anyone is present. */
async function flush(boxRoot: string, entry: BoxPresence): Promise<void> {
  const now = getBoxTime(boxRoot);
  const activeWeb = entry.tracker.due(now);
  if (activeWeb !== null) {
    await writePresence(boxRoot, { activeWeb, now });
    entry.tracker.written({ activeWeb, now });
  }
  const anyone = entry.tracker.count(now) > 0;
  if (anyone && entry.sweep === null) {
    entry.sweep = setInterval(() => {
      flush(boxRoot, entry).catch((e: unknown) => {
        console.warn("[presence] could not write presence.json; notifications may treat the box as unattended:", e);
      });
    }, SWEEP_MS);
    entry.sweep.unref();
  } else if (!anyone && activeWeb === null && entry.sweep !== null) {
    clearInterval(entry.sweep);
    entry.sweep = null;
  }
}

export const presenceRouter = router({
  heartbeat: authedProcedure
    .input(z.object({ sessionId: z.string().regex(/^[\w-]{8,64}$/) }))
    .mutation(async ({ ctx, input }) => {
      const entry = presenceFor(ctx.boxRoot);
      entry.tracker.heard(input.sessionId, getBoxTime(ctx.boxRoot));
      await flush(ctx.boxRoot, entry);
      return { ok: true };
    }),
});

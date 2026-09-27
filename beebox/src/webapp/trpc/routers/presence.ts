/**
 * Presence heartbeat. An open web tab calls `heartbeat` every 30 seconds while
 * a person has interacted with it in the last two minutes; the server counts
 * the tabs heard from in the last 90 seconds per box and keeps
 * `.beebox/presence.json` current for every process that decides whether to
 * notify (`core/notification/presence.ts`). See docs/implemented-plans/notifications.md
 * (Track A, presence).
 */

import { z } from "zod";
import { router, authedProcedure } from "../trpc.js";
import { createPresenceRegistry } from "../../../core/notification/presence-registry/core.js";
import { getBoxTime } from "../../../lib/time.js";

/** Often enough to write a drop to zero soon after the last tab's session expires. */
const SWEEP_MS = 15_000;

const presence = createPresenceRegistry({ sweepMs: SWEEP_MS, now: getBoxTime });

export const presenceRouter = router({
  heartbeat: authedProcedure
    .input(z.object({ sessionId: z.string().regex(/^[\w-]{8,64}$/) }))
    .mutation(async ({ ctx, input }) => {
      await presence.heartbeat(ctx.boxRoot, input.sessionId);
      return { ok: true };
    }),
});

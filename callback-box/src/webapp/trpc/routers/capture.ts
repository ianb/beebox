/**
 * tRPC router for capture UI state (Track 4).
 *
 * `pendingSessions` lists the in-flight capture staging sessions bound to a
 * chat — those sealed but not yet delivered (or failed and retryable) — so the
 * chat can render a server-derived pending bubble that survives reload, another
 * tab, or a server restart. It reads the on-disk staging manifests directly
 * (no live registry needed); the pending bubble refetches this on each
 * `capture-status` bus event and uses it as reload-safe ground truth.
 *
 * The capture upload/create/finalize/cancel endpoints stay raw Fastify routes
 * (`webapp/routes/capture.ts`) — multipart + `X-Capture-*` headers don't fit the
 * tRPC request/response shape. Only this read-side query lives here.
 */

import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { listStagingSessions } from "../../../core/capture/staging-store.js";
import { selectPendingCaptures, type PendingCapture } from "../../../core/capture/pending.js";

export const captureRouter = router({
  pendingSessions: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input, ctx }): Promise<{ pending: PendingCapture[] }> => {
      const sessions = await listStagingSessions({ boxRoot: ctx.boxRoot });
      return { pending: selectPendingCaptures({ sessions, sessionId: input.sessionId }) };
    }),
});

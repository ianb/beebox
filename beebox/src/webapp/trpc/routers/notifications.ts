/**
 * The notification log, read for the Admin "Recent" list and the `chat:new`
 * banner. The log (`core/notification/log.ts`) is the record; this router only
 * reads it. See docs/plans/notifications.md (Track A).
 */

import { z } from "zod";
import { router, authedProcedure } from "../trpc.js";
import { getIntent, readRecent, type LoggedNotification } from "../../../core/notification/log.js";

export const notificationsRouter = router({
  /** Intents logged in the last `days` days (default 3), newest first, each with its deliveries. */
  recent: authedProcedure
    .input(z.object({ days: z.number().int().min(1).max(60).optional() }).optional())
    .query(async ({ ctx, input }): Promise<LoggedNotification[]> => {
      const logged = await readRecent(ctx.boxRoot, { days: input?.days ?? 3 });
      return logged.toReversed();
    }),

  /** One intent by id, or null when it is not in the log (never written, or rotated away). */
  get: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<LoggedNotification | null> => getIntent(ctx.boxRoot, input.id)),
});

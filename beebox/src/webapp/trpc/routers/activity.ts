/**
 * tRPC router for the activity log: the page's queue posts batches of what a
 * person did in views and figures. The server stamps time and user and
 * appends them to `.beebox/activity.jsonl` (core/activity/log.ts); invalid
 * entries are dropped, never failing the batch.
 */

import { z } from "zod";
import { recordActivity } from "../../../core/activity/log.js";
import { authedProcedure, router } from "../procedures.js";

export const activityRouter = router({
  record: authedProcedure
    .input(z.object({ entries: z.array(z.unknown()).min(1).max(200) }))
    .mutation(async ({ input, ctx }): Promise<{ accepted: number }> => {
      const accepted = await recordActivity(ctx.boxRoot, { entries: input.entries, user: ctx.user?.email ?? null });
      return { accepted };
    }),
});

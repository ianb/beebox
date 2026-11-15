/**
 * tRPC router for the activity log: the page's queue posts batches of what a
 * person did in views and figures. The server stamps time and user and
 * appends them to `.beebox/activity.jsonl` (core/activity/log.ts); invalid
 * entries are dropped, never failing the batch. A batch that names a session
 * with an armed trigger schedules the runner.
 */

import { z } from "zod";
import { recordActivity } from "../../../core/activity/log.js";
import { getTriggerRunner } from "../../../core/triggers/runner/core.js";
import { isRecord } from "../../../shared/is-record.js";
import { authedProcedure, router } from "../procedures.js";

/** The bound sessions a batch names; entries still under a `pendingChat` wait for the next batch after binding. */
function sessionsIn(entries: readonly unknown[]): string[] {
  return entries.flatMap((entry) => (isRecord(entry) && typeof entry["chat"] === "string" ? [entry["chat"]] : []));
}

export const activityRouter = router({
  record: authedProcedure
    .input(z.object({ entries: z.array(z.unknown()).min(1).max(200) }))
    .mutation(async ({ input, ctx }): Promise<{ accepted: number }> => {
      const accepted = await recordActivity(ctx.boxRoot, { entries: input.entries, user: ctx.user?.email ?? null });
      // After the append: the runner reads the log when the session's activity settles (plan:activity-triggers, Track C).
      if (accepted > 0) {
        void getTriggerRunner(ctx.boxRoot)?.onActivity(sessionsIn(input.entries)).catch((e: unknown) => { console.warn("[triggers] could not schedule an evaluation:", e); });
      }
      return { accepted };
    }),
});

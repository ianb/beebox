/**
 * Force a wakeup now, from wherever the caller is.
 *
 * The box agent's shell deliberately holds no connector credential, so `bbx
 * wakeup` in that shell runs a cycle in which every Google connector finds no
 * service and reports nothing new — forcing produced a different answer from
 * letting it happen, invisibly. This procedure is the fix: the server, which
 * holds the credential, runs the SAME supervised `bbx wakeup` child the UI Sync
 * button and the scheduler run, with the same `--connector` flag the seeded
 * schedules pass. Forcing and letting it happen are the same code by
 * construction (`docs/plans/agent-capability-delegation.md`).
 *
 * A forced wakeup runs everything the scheduled one does, on-wakeup scripts
 * included (boxholder, 2026-09-14): skipping a step would be the first
 * exception to that equivalence.
 *
 * What comes back is the child's typed outcome, not its output. An agent
 * should never parse prose to learn whether Drive synced, and a wakeup's
 * output is long, box-specific, and full of paths.
 */

import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { runBbxWakeup } from "../../../core/commands/wakeup.js";
import type { WakeupRunResult } from "../../../core/commands/wakeup-runner.js";

/**
 * Enough of the tail to see what a failing child said, without making the
 * response a log shipper. The tail, not the head: the failure is at the end.
 */
const MAX_OUTPUT_CHARS = 8000;

function tail(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `…(${String(output.length - MAX_OUTPUT_CHARS)} earlier characters omitted)\n${output.slice(-MAX_OUTPUT_CHARS)}`;
}

/**
 * One sentence about the run as a whole, for a caller that will relay it.
 *
 * A cycle that skipped because another held the lock is a SUCCESSFUL call with
 * a skipped outcome: nothing failed, and nothing ran. Reporting it as an error
 * would make the ordinary case of two wakeups overlapping look broken.
 */
function detailFor(result: WakeupRunResult): string {
  if (!result.ok) return result.detail;
  if (result.outcome === null) {
    return "The wakeup finished, but produced no outcome line — what it did is unknown. Check the box's logs, or run it again.";
  }
  if (result.outcome.skipped === "wakeup-running") {
    return "Another wakeup cycle was already running on this box, so this one did nothing. Try again once it finishes.";
  }
  return "";
}

export const wakeupRouter = router({
  /**
   * Run a wakeup cycle now — the whole box, or one connector.
   *
   * A mutation because it changes the box: it syncs connectors, drains jobs,
   * and pushes.
   */
  force: publicProcedure
    .input(
      z.object({
        /** Matched against `Connector.name` exactly (`google-drive`, not `drive`). */
        connector: z.string().min(1).optional(),
        /** Ask for the child's output too, for a human debugging a failure. */
        includeOutput: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = ctx.services.wakeupRunner ?? runBbxWakeup;
      const result = await run({
        boxRoot: ctx.boxRoot,
        triggeredBy: "force-wakeup",
        ...(input.connector === undefined ? {} : { connector: input.connector }),
      });
      return {
        ok: result.ok,
        detail: detailFor(result),
        outcome: result.outcome,
        ...(input.includeOutput === true ? { output: tail(result.output) } : {}),
      };
    }),
});

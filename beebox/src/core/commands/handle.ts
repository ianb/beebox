/**
 * `bbx handle` — run one pass of the handle stage.
 *
 * Reads `inbox/triaged/<category>/` buckets and invokes the
 * corresponding handler procedure for each non-empty one. See
 * `src/core/handle.ts`.
 */

import type { CommandDefinition } from "../command-types.js";
import { runHandle, formatHandlingLines, handleVerdict, describeHandleFailures } from "../handle.js";

export const handleCommand: CommandDefinition = {
  name: "handle",
  description:
    "Run handler procedures for one or more triaged category buckets.",
  args: [
    {
      name: "category",
      description: "Only handle this category. Defaults to all non-empty buckets.",
      required: false,
      type: "string",
    },
  ],
  execute: async (ctx, args) => {
    const category = typeof args["category"] === "string" ? args["category"] : undefined;
    const params = category
      ? { ctx, category }
      : { ctx };
    const results = await runHandle(params);
    if (results.length === 0) {
      ctx.writeLine("Handle: no buckets to process.");
      return { success: true, data: results };
    }
    for (const result of results) {
      for (const line of formatHandlingLines(result)) ctx.writeLine(line);
    }
    // The pass reports its worst bucket. A failed handler is a failure of the
    // command even though other buckets were fine; an unjudged one is not a
    // failure, and the CLI turns it into its own exit code from `data`.
    return handleVerdict(results) === "failed"
      ? { success: false, error: describeHandleFailures(results), data: results }
      : { success: true, data: results };
  },
};

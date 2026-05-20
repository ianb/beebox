/**
 * `cb handle` — run one pass of the handle stage.
 *
 * Reads `inbox/triaged/<category>/` buckets and invokes the
 * corresponding handler procedure for each non-empty one. See
 * `src/core/handle.ts`.
 */

import { registerCommand } from "../command-runner.js";
import { runHandle } from "../handle.js";

registerCommand({
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
      const itemCount = result.items.length;
      const procDetail = result.procedurePath ? ` [${result.procedurePath}]` : "";
      ctx.writeLine(`  ${result.outcome}\t${result.category} (${itemCount} item${itemCount === 1 ? "" : "s"})${procDetail}`);
      if (result.error) ctx.writeLine(`    └─ ${result.error}`);
    }
    return { success: true, data: results };
  },
});

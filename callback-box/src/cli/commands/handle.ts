/**
 * cb handle — Run handler procedures for triaged category buckets.
 *
 * Thin wrapper around the core handle command. See
 * `docs/triage.md` §Handle (stage 3).
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";

export const handleCommand = new Command("handle")
  .description("Run handler procedures for triaged category buckets.")
  .argument("[category]", "Only handle this category (defaults to all non-empty buckets)")
  .action(async (category: string | undefined) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);
      const args: Record<string, unknown> = {};
      if (category) args["category"] = category;
      const result = await runCommand({ name: "handle", args, ctx });
      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

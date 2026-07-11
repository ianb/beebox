/**
 * cb triage — Run one pass of the triage stage.
 *
 * Thin wrapper around the core triage command. See
 * `docs/triage.md` for the surrounding pipeline.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";

export const triageCommand = new Command("triage")
  .description("Run one triage pass: classify intake-complete items and route them.")
  .option("--dry-run", "Print agent decisions without moving files")
  .action(async (options) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);
      const result = await runCommand({
        name: "triage",
        args: { dryRun: options.dryRun === true },
        ctx,
      });
      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

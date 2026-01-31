/**
 * cb wakeup - Wake up and process pending items
 *
 * Thin wrapper around the core wakeup command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const wakeupCommand = new Command("wakeup")
  .description("Wake up and process pending items")
  .option("--dry-run", "Show what would happen without doing it")
  .option("--force", "Force wakeup even if another process is running")
  .action(async (options: { dryRun?: boolean; force?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand(
        "wakeup",
        {
          dryRun: options.dryRun,
          force: options.force,
        },
        ctx
      );

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

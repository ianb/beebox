/**
 * cb move - Move/rename a card and update all references
 *
 * Thin wrapper around the core move command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const moveCommand = new Command("move")
  .description("Move/rename a card and update all references")
  .argument("<from>", "Path to the card to move")
  .argument("<to>", "Destination path (file or directory)")
  .option("--commit", "Commit the change")
  .option("--dry-run", "Show what would happen without doing it")
  .action(async (from: string, to: string, options: { commit?: boolean; dryRun?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand(
        "move",
        {
          from,
          to,
          commit: options.commit,
          dryRun: options.dryRun,
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

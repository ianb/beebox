/**
 * cb trash - Move a card to the trash
 *
 * Thin wrapper around the core trash command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const trashCommand = new Command("trash")
  .description("Move a card to the trash")
  .argument("<path>", "Path to the card to trash")
  .option("--reason <reason>", "Reason for trashing")
  .option("--commit", "Commit the change")
  .option("--dry-run", "Show what would happen without doing it")
  .action(async (cardPath: string, options: { reason?: string; commit?: boolean; dryRun?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand(
        "trash",
        {
          path: cardPath,
          reason: options.reason,
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

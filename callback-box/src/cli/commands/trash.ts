/**
 * cb rm - Move a card to the trash
 *
 * Thin wrapper around the core trash command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";

export const trashCommand = new Command("rm")
  .description("Move one or more cards to the trash")
  .argument("<paths...>", "Paths to the cards to trash")
  .option("--reason <reason>", "Reason for trashing")
  .option("--commit", "Commit the change")
  .option("--dry-run", "Show what would happen without doing it")
  .action(async (cardPaths: string[], options: { reason?: string; commit?: boolean; dryRun?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "trash",
        args: {
          paths: cardPaths,
          reason: options.reason,
          commit: options.commit,
          dryRun: options.dryRun,
        },
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

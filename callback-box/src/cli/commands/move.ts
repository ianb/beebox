/**
 * cb mv - Move/rename a card and update all references
 *
 * Thin wrapper around the core move command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { invariant } from "../../lib/invariant.js";

export const moveCommand = new Command("mv")
  .description("Move/rename one or more cards and update all references")
  .argument("<paths...>", "Source path(s) followed by destination (like mv)")
  .option("--commit", "Commit the change")
  .option("--dry-run", "Show what would happen without doing it")
  .action(async (paths: string[], options: { commit?: boolean; dryRun?: boolean }) => {
    if (paths.length < 2) {
      console.error("Error: Need at least a source and destination path");
      process.exit(1);
    }

    const to = paths[paths.length - 1];
    invariant(to !== undefined, "paths must have at least 2 entries (checked above)");
    const from = paths.slice(0, -1);

    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "move",
        args: {
          from: from.length === 1 ? from[0] : from,
          to,
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
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

/**
 * cb fetch-news - Fetch full article content for a news item
 *
 * Thin wrapper around the core fetch-news command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const fetchNewsCommand = new Command("fetch-news")
  .description("Fetch full article content for a news item")
  .argument("<path>", "Path to the news-item card")
  .option("--commit", "Commit the change")
  .option("--dry-run", "Show what would happen without doing it")
  .action(async (cardPath: string, options: { commit?: boolean; dryRun?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand(
        "fetch-news",
        {
          path: cardPath,
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

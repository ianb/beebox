/**
 * cb fetch-all-news - Fetch article content for all unfetched news items
 *
 * Thin wrapper around the core fetch-all-news command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const fetchAllNewsCommand = new Command("fetch-all-news")
  .description("Fetch article content for all unfetched news items")
  .option("--dir <dir>", "Directory to scan for news items", "box/inbox/news")
  .option("--no-commit", "Skip committing after fetch")
  .option("--concurrency <n>", "Number of parallel fetches", "5")
  .action(async (options: {
    dir?: string;
    commit?: boolean;
    concurrency?: string;
  }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand(
        "fetch-all-news",
        {
          dir: options.dir,
          commit: options.commit !== false,
          concurrency: options.concurrency ? parseInt(options.concurrency, 10) : 5,
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

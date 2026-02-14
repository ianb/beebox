/**
 * cb process-news - Run the news processing agent
 *
 * Thin wrapper around the core process-news command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const processNewsCommand = new Command("process-news")
  .description("Run the news processing agent (triage, fetch, analyze, brief)")
  .option("--batch-size <n>", "Maximum items to process per phase", "10")
  .option("--triage-only", "Only run triage phase")
  .option("--fetch-only", "Only run fetch phase")
  .option("--analyze-only", "Only run analyze phase")
  .option("--brief-only", "Only run brief creation phase")
  .option("--dry-run", "Show what would happen without doing it")
  .option("--force", "Force even if another process is running")
  .action(async (options: {
    batchSize?: string;
    triageOnly?: boolean;
    fetchOnly?: boolean;
    analyzeOnly?: boolean;
    briefOnly?: boolean;
    dryRun?: boolean;
    force?: boolean;
  }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "process-news",
        args: {
          batchSize: options.batchSize ? parseInt(options.batchSize, 10) : 10,
          triageOnly: options.triageOnly,
          fetchOnly: options.fetchOnly,
          analyzeOnly: options.analyzeOnly,
          briefOnly: options.briefOnly,
          dryRun: options.dryRun,
          force: options.force,
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

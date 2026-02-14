/**
 * cb triage-feedback - Triage feedback cards and integrate into briefs
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

// Import to register the command
import "../../core/commands/triage-feedback.js";

export const triageFeedbackCommand = new Command("triage-feedback")
  .description("Triage feedback cards and integrate into briefs")
  .option("--dry-run", "Show what would happen without doing it")
  .option("-f, --force", "Force even if another process is running")
  .action(async (options: { dryRun?: boolean; force?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "triage-feedback",
        args: {
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

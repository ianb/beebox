/**
 * cb reactor - Process pending jobs.
 *
 * Finds job cards in box/jobs/ and spawns an agent to process them.
 * One-shot mode for now (Phase 4 adds sync integration and polling).
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runReactor } from "../../core/reactor.js";

export const reactorCommand = new Command("reactor")
  .description("Process pending jobs")
  .option("--dry-run", "Show what would happen without doing it")
  .action(async (options: { dryRun?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();

      const result = await runReactor({
        boxRoot,
        dryRun: options.dryRun,
        onLog: (text) => process.stdout.write(text),
      });

      if (!result.success) {
        console.error("Reactor finished with errors");
        process.exit(1);
      }

      if (result.jobsRemaining > 0) {
        console.log(`Warning: ${result.jobsRemaining} job(s) still remaining`);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

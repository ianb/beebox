/**
 * cb reactor - Orchestrate sync and job processing.
 *
 * Default: process existing jobs in box/jobs/ (one-shot).
 * With --sync: run sync first, then process jobs.
 * With --poll: repeat on an interval.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runReactor } from "../../core/reactor.js";

export const reactorCommand = new Command("reactor")
  .description("Process pending jobs")
  .option("--dry-run", "Show what would happen without doing it")
  .option("--sync", "Run sync before processing jobs")
  .option("--max-cycles <n>", "Maximum sync→process cycles (default 3)", "3")
  .option("--poll <seconds>", "Re-run every N seconds (0 = one-shot)", "0")
  .action(async (options: { dryRun?: boolean; sync?: boolean; maxCycles: string; poll: string }) => {
    try {
      const boxRoot = await requireBoxRoot();

      const result = await runReactor({
        boxRoot,
        dryRun: options.dryRun,
        sync: options.sync,
        maxCycles: parseInt(options.maxCycles, 10),
        pollInterval: parseInt(options.poll, 10),
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

/**
 * cb upload — Thin CLI wrapper around the core upload command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const uploadCommand = new Command("upload")
  .description("Upload a batch of files to the box (dedup by content hash)")
  .argument("<files...>", "Files to upload (absolute or relative to cwd)")
  .requiredOption("--as <kind>", "Destination kind (currently: scan)")
  .option("--force", "Re-import files already in the ledger")
  .option("--context <text>", "Per-batch context passed to the destination handler")
  .option("--limit <n>", "Process at most N files (sorted; useful for smoke tests)")
  .action(async (files: string[], options: { as: string; force?: boolean; context?: string; limit?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const args: Record<string, unknown> = {
        files,
        kind: options.as,
      };
      if (options.force) args["force"] = true;
      if (options.context) args["context"] = options.context;
      if (options.limit) args["limit"] = Number(options.limit);

      const result = await runCommand({ name: "upload", args, ctx });

      if (!result.success) {
        if (result.error) console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

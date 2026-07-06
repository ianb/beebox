/**
 * cb scan-import — Import a JPEG batch as photo image cards, or file a PDF
 * as a document. Thin wrapper around the core scan-import command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const scanImportCommand = new Command("scan-import")
  .description("Import a JPEG batch as photo image cards, or a PDF as a document")
  .argument("<inputs...>", "PDF (one) or image files (many) — absolute or relative to box root")
  .option("--context <text>", "Extra context appended to CLAUDE_SCANS.md for this run")
  .action(async (inputs: string[], options: { context?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const args: Record<string, unknown> = { inputs };
      if (options.context) args["context"] = options.context;

      const result = await runCommand({ name: "scan-import", args, ctx });

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

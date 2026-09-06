/**
 * bbx scan-import — Import a JPEG batch as photo image cards, or file a PDF
 * as a document. Thin wrapper around the core scan-import command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";

export const scanImportCommand = new Command("scan-import")
  .description("Import a JPEG batch as photo image cards, or a PDF as a document")
  .argument("<inputs...>", "PDF (one) or image files (many) — absolute or relative to box root")
  .option("--context <text>", "Extra context appended to the scan-guide context for this run")
  .option("--source <text>", "Provenance recorded on the produced cards (e.g. scan-upload/<token-name>)")
  .option(
    "--mode <mode>",
    "document (default for a PDF) or photos — use photos for a scanned photo album",
  )
  .action(async (inputs: string[], options: { context?: string; source?: string; mode?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const args: Record<string, unknown> = { inputs };
      if (options.context) args["context"] = options.context;
      if (options.source) args["source"] = options.source;
      if (options.mode) args["mode"] = options.mode;

      const result = await runCommand({ name: "scan-import", args, ctx });

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

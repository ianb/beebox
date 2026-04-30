/**
 * cb scan-import — Import a scanned PDF, image batch, or document PDF.
 *
 * Thin wrapper around the core scan-import command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const scanImportCommand = new Command("scan-import")
  .description("Import a scanned PDF, image batch, or document PDF (auto-detects PDF mode by embedded text)")
  .argument("<inputs...>", "PDF (one) or image files (many) — absolute or relative to box root")
  .option("--archive-dpi <n>", "DPI for archival JPEG render (PDF inputs only)", "600")
  .option("--api-scale-to <n>", "Longest-side pixel size for the API copy (PDF inputs only)", "2000")
  .option("--context <text>", "Extra context appended to CLAUDE_SCANS.md for this run")
  .option("--treat-as <mode>", "Force PDF mode: 'scan' or 'document' (default: auto-detect)")
  .action(async (inputs: string[], options: { archiveDpi: string; apiScaleTo: string; context?: string; treatAs?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      if (options.treatAs && options.treatAs !== "scan" && options.treatAs !== "document") {
        console.error(`Error: --treat-as must be 'scan' or 'document', got '${options.treatAs}'`);
        process.exit(1);
      }

      const args: Record<string, unknown> = {
        inputs,
        archiveDpi: Number(options.archiveDpi),
        apiScaleTo: Number(options.apiScaleTo),
      };
      if (options.context) args["context"] = options.context;
      if (options.treatAs) args["treatAs"] = options.treatAs;

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

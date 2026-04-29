/**
 * cb scan-import — Import a scanned PDF as image cards.
 *
 * Thin wrapper around the core scan-import command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const scanImportCommand = new Command("scan-import")
  .description("Import a scanned PDF of photographs as image cards (Gemini Flash pairs photos with their backs)")
  .argument("<pdf>", "PDF file to import (absolute or relative to box root)")
  .option("--archive-dpi <n>", "DPI for archival JPEG render of each page", "600")
  .option("--api-scale-to <n>", "Longest-side pixel size for the API copy sent to Gemini", "2000")
  .option("--context <text>", "Extra context appended to CLAUDE_SCANS.md for this run")
  .action(async (pdf: string, options: { archiveDpi: string; apiScaleTo: string; context?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "scan-import",
        args: {
          pdfPath: pdf,
          archiveDpi: Number(options.archiveDpi),
          apiScaleTo: Number(options.apiScaleTo),
          ...(options.context ? { context: options.context } : {}),
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

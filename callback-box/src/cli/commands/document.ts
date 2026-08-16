/**
 * cb document — operations on `document.card`s. Today one subcommand:
 * `reanalyze`, a thin wrapper around the core `document-reanalyze` command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";

const reanalyzeCommand = new Command("reanalyze")
  .description("Re-run extraction over a document card's original file")
  .argument("<card>", "Path to the .document.card (box-relative or absolute)")
  .option("--force-ocr", "Re-OCR every page, discarding the embedded text layer")
  .option("--languages <codes>", "Comma-separated OCR language codes (with --force-ocr)")
  .action(async (card: string, options: { forceOcr?: boolean; languages?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const args: Record<string, unknown> = { card };
      if (options.forceOcr) args["force-ocr"] = true;
      if (options.languages) args["languages"] = options.languages;

      const result = await runCommand({ name: "document-reanalyze", args, ctx });
      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

export const documentCommand = new Command("document")
  .description("Work with document cards (extracted documents)")
  .addCommand(reanalyzeCommand);

/**
 * cb pdf — operations on `pdf.card`s. Today one subcommand:
 * `reanalyze`, a thin wrapper around the core `pdf-reanalyze` command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";

const reanalyzeCommand = new Command("reanalyze")
  .description("Re-run extraction over a pdf card's original file")
  .argument("<card>", "Path to the .pdf.card (box-relative or absolute)")
  .option("--force-ocr", "Re-OCR every page, discarding the embedded text layer")
  .option("--languages <codes>", "Comma-separated OCR language codes (with --force-ocr)")
  .action(async (card: string, options: { forceOcr?: boolean; languages?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const args: Record<string, unknown> = { card };
      if (options.forceOcr) args["force-ocr"] = true;
      if (options.languages) args["languages"] = options.languages;

      const result = await runCommand({ name: "pdf-reanalyze", args, ctx });
      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

export const pdfCommand = new Command("pdf")
  .description("Work with pdf cards (extracted PDFs)")
  .addCommand(reanalyzeCommand);

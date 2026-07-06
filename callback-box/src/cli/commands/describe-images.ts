/**
 * cb describe-images — Analyze images using Gemini Flash.
 *
 * Thin wrapper around the core describe-images command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const describeImagesCommand = new Command("describe-images")
  .description("Analyze images using Gemini Flash (OCR, description, titles)")
  .argument("<paths...>", "Image files (.jpg/.png) or image cards (.image.card)")
  .option("--no-rename", "Skip renaming files to descriptive names")
  .action(async (paths: string[], options: { rename: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "describe-images",
        args: { paths, noRename: !options.rename },
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

/**
 * cb ls - List cards with optional frontmatter-field template extraction.
 *
 * Thin wrapper around the core ls command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const lsCommand = new Command("ls")
  .description("List cards with optional frontmatter-field template extraction")
  .argument("<paths...>", "Glob patterns or directories to list")
  .option(
    "-f, --format <template>",
    "Template with {field} placeholders (dotted frontmatter paths), e.g. '{title} by {author}'"
  )
  .action(async (paths: string[], options: { format?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "ls",
        args: {
          paths,
          format: options.format,
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

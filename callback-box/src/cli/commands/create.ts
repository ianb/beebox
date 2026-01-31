/**
 * cb create - Create a new card from template
 *
 * Thin wrapper around the core create command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import {
  runCommand,
  createCliContext,
  getTemplateNames,
} from "../../core/commands/index.js";

interface CreateOptions {
  template?: string;
  content?: string;
  prompt?: string;
  memo?: string;
  options?: string[];
  commit?: boolean;
  attachment?: string;
}

export const createCommand = new Command("create")
  .description("Create a new card from template")
  .argument("<path>", "Path for new card (relative to box root or absolute)")
  .option(
    "-t, --template <name>",
    "Override template (usually inferred from card type in filename)"
  )
  .option("-c, --content <text>", "Content for memo cards")
  .option("-p, --prompt <text>", "Prompt for question cards")
  .option("-m, --memo <text>", "Memo/context for question cards")
  .option(
    "-o, --options <items...>",
    'Options for select questions (e.g., -o "Yes" "No" "Maybe")'
  )
  .option("--commit", "Commit the new card")
  .option("-a, --attachment <path>", "Path to an attachment file")
  .action(async (targetPath: string, options: CreateOptions) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand(
        "create",
        {
          path: targetPath,
          template: options.template,
          content: options.content,
          prompt: options.prompt,
          memo: options.memo,
          options: options.options,
          commit: options.commit,
          attachment: options.attachment,
        },
        ctx
      );

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

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
} from "../../core/commands/index.js";
import {
  getAllTemplates,
  describeTemplateArgs,
} from "../../schemas/index.js";

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
  .argument("[path]", "Path for new card (relative to box root or absolute)")
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
  .option("--list-templates", "List all available templates")
  .option("--describe-template <name>", "Show details about a specific template")
  .action(async (targetPath: string | undefined, options: CreateOptions & { listTemplates?: boolean; describeTemplate?: string }) => {
    // Handle --list-templates
    if (options.listTemplates) {
      console.log("Available templates:\n");
      for (const template of getAllTemplates()) {
        console.log(`  ${template.name}`);
        console.log(`    ${template.description}`);
        console.log(`    Card types: ${template.cardTypes.join(", ")}`);
        console.log();
      }
      return;
    }

    // Handle --describe-template
    if (options.describeTemplate) {
      console.log(describeTemplateArgs(options.describeTemplate));
      return;
    }

    // Require path for actual card creation
    if (!targetPath) {
      console.error("Error: path argument is required for card creation");
      console.error("Use --list-templates to see available templates");
      console.error("Use --describe-template <name> to see template arguments");
      process.exit(1);
    }

    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "create",
        args: {
          path: targetPath,
          template: options.template,
          content: options.content,
          prompt: options.prompt,
          memo: options.memo,
          options: options.options,
          commit: options.commit,
          attachment: options.attachment,
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

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
  commit?: boolean;
  attachment?: string;
  listTemplates?: boolean;
  describeTemplate?: string;
}

export const createCommand = new Command("create")
  .description("Create a new card from template")
  .argument("[path]", "Path for new card (relative to box root or absolute)")
  .argument("[args...]", "Template arguments as key=value pairs")
  .option(
    "-t, --template <name>",
    "Override template (usually inferred from card type in filename)"
  )
  .option("--commit", "Commit the new card")
  .option("-a, --attachment <path>", "Path to an attachment file")
  .option("--list-templates", "List all available templates")
  .option("--describe-template <name>", "Show details about a specific template")
  .action(async (targetPath: string | undefined, ...rest: unknown[]) => {
    // Commander passes variadic args as second param, options as third
    const kvArgs = (rest[0] ?? []) as string[];
    const options = (rest[1] ?? {}) as CreateOptions;

    // Handle --list-templates
    if (options.listTemplates) {
      console.log("Available templates:\n");
      for (const template of getAllTemplates()) {
        const defaultNote = template.defaultForTypes?.length
          ? ` (default for: ${template.defaultForTypes.join(", ")})`
          : "";
        console.log(`  ${template.name}${defaultNote}`);
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

    // Parse key=value positional args
    const parsedArgs: Record<string, string> = {};
    for (const arg of kvArgs) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex === -1) {
        console.error(`Error: invalid argument '${arg}'. Use key=value format.`);
        process.exit(1);
      }
      parsedArgs[arg.slice(0, eqIndex)] = arg.slice(eqIndex + 1);
    }

    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "create",
        args: {
          path: targetPath,
          template: options.template,
          args: Object.keys(parsedArgs).length > 0 ? parsedArgs : undefined,
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

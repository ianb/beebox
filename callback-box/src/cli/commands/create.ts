/**
 * cb create - Create a new card from template
 *
 * Thin wrapper around the core create command.
 */

import { Command } from "commander";
import { requireBoxRoot, findBoxRoot } from "../../lib/paths.js";
import {
  runCommand,
  createCliContext,
} from "../../core/commands/index.js";
import {
  getAllTemplates,
  describeTemplateArgs,
} from "../../schemas/index.js";
import { loadBoxSchemas } from "../../schemas/registry.js";

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

    // Box-local templates register as a side effect of loading the box's
    // schemas. --list-templates / --describe-template run before the box is
    // otherwise resolved, so load it best-effort here; otherwise they'd show
    // only built-in templates and miss the box's own.
    const templateBoxRoot = await findBoxRoot(process.cwd());
    if (templateBoxRoot) await loadBoxSchemas(templateBoxRoot);

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

    // Parse key=value positional args.
    // Values starting with [ are parsed as JSON arrays.
    // Repeated keys are collected into arrays automatically.
    const parsedArgs: Record<string, unknown> = {};
    for (const arg of kvArgs) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex === -1) {
        console.error(`Error: invalid argument '${arg}'. Use key=value format.`);
        process.exit(1);
      }
      const key = arg.slice(0, eqIndex);
      const raw = arg.slice(eqIndex + 1);

      // Try JSON array parsing for values like '["a","b"]'
      let value: unknown = raw;
      if (raw.startsWith("[")) {
        try {
          value = JSON.parse(raw);
        } catch (_e) {
          // Not valid JSON: the value just isn't a JSON array, keep the raw string as-is.
          // The parse error carries no actionable info for a key=value CLI argument.
        }
      }

      // Repeated keys become arrays
      if (key in parsedArgs) {
        const existing = parsedArgs[key];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          parsedArgs[key] = [existing, value];
        }
      } else {
        parsedArgs[key] = value;
      }
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

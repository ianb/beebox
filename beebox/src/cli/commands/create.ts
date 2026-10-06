/**
 * bbx create - Create a new card from template
 *
 * Thin wrapper around the core create command.
 */

import { Command } from "commander";
import { requireBoxRoot, findBoxRoot } from "../../lib/paths/core.js";
import {
  runCommand,
  createCliContext,
} from "../../core/command-runner.js";
import { getAllTemplates } from "../../templates-registry.js";
import { describeTemplateArgs } from "../../templates-describe.js";
import { loadBoxSchemas } from "../../schemas.js";
import { errorMessage } from "../../shared/error-guards.js";

interface CreateOptions {
  template?: string;
  commit?: boolean;
  attachment?: string;
  listTemplates?: boolean;
  describeTemplate?: string;
}

export const createCommand = new Command("create")
  .description("Create a new card from template")
  .configureOutput({
    outputError: (message, write) => {
      write(message);
      if (message.startsWith("error: unknown option ")) {
        write("Template arguments use positional key=value pairs. Use --describe-template <name> to see a template's keys.\n");
      }
    },
  })
  .argument("[path]", "Path for new card (relative to box root or absolute)")
  .argument("[args...]", "Template key=value arguments (see --describe-template <name>)")
  .option(
    "-t, --template <name>",
    "Override template (usually inferred from card type in filename)"
  )
  .option("--commit", "Commit the new card")
  .option("-a, --attachment <path>", "Path to an attachment file")
  .option("--list-templates", "List all available templates")
  .option("--describe-template <name>", "Show details about a specific template")
  // Commander passes (targetPath, variadic kv args, options); a typed rest tuple
  // keeps this to one parameter (max-params) while avoiding per-arg casts.
  .action(async (...actionArgs: [
    targetPath: string | undefined,
    kvArgs: string[],
    options: CreateOptions,
    ...unknown[],
  ]) => {
    const [targetPath, kvArgs, options] = actionArgs;

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
    // Values starting with [ or { are parsed as JSON arrays or objects.
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

      // Try JSON parsing for array and object values.
      let value: unknown = raw;
      if (raw.startsWith("[") || raw.startsWith("{")) {
        try {
          value = JSON.parse(raw);
        } catch (_e) {
          // Not valid JSON: keep the raw string as-is.
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
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

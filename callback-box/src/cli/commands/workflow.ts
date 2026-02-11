/**
 * cb workflow — CLI command group for workflow operations.
 *
 * Subcommands:
 *   cb workflow run <name>      Start a new workflow run
 *   cb workflow list            List available workflow definitions
 *   cb workflow status [dir]    Show status of a workflow run
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const workflowCommand = new Command("workflow")
  .description("Manage and run declarative workflows");

workflowCommand
  .command("run")
  .description("Start a new workflow run")
  .argument("<name-or-path>", "Workflow name (e.g., process-news) or path to .workflow.card")
  .option("--dry-run", "Preview without executing")
  .option("--force", "Force even if another process is running")
  .option("--step <id>", "Run only this step, skip all others")
  .action(async (name: string, options: { dryRun?: boolean; force?: boolean; step?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand(
        "workflow-run",
        {
          name,
          dryRun: options.dryRun,
          force: options.force,
          step: options.step,
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

workflowCommand
  .command("list")
  .description("List available workflow definitions")
  .action(async () => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand("workflow-list", {}, ctx);

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

workflowCommand
  .command("status")
  .description("Show status of a workflow run")
  .argument("[run-dir]", "Run directory (defaults to latest)")
  .action(async (runDir?: string) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand(
        "workflow-status",
        { runDir },
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

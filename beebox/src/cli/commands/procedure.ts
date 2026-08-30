/**
 * bbx procedure — CLI command group for procedure operations.
 *
 * Subcommands:
 *   bbx procedure run <name>      Start a new procedure run
 *   bbx procedure resume [dir]    Resume a failed run from its first incomplete step
 *   bbx procedure list            List available procedure definitions
 *   bbx procedure status [dir]    Show status of a procedure run
 *   bbx procedure gc              Delete expired run directories
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { procedureOutcome } from "../../core/commands/procedure.js";
import type { CommandResult } from "../../core/command-runner.js";
import { errorMessage } from "../../lib/error-guards.js";
import {
  INCONCLUSIVE_EXIT_CODE,
  formatInconclusiveLine,
} from "../../shared/inconclusive.js";

export const procedureCommand = new Command("procedure")
  .description("Manage and run declarative procedures");

/** Flush the diagnostic into scheduler pipes before terminating the CLI. */
async function writeStderr(line: string): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stderr.write(`${line}\n`, () => resolve());
  });
}

async function exitWithProcedureError(message: string | undefined): Promise<never> {
  await writeStderr(`Error: ${message ?? "Unknown procedure error"}`);
  process.exit(1);
}

/**
 * Terminal handling for a run whose work succeeded. An unjudged run gets its
 * own exit code — not 0, because a reader who gated on success would be told
 * the review passed when nothing checked it; not 1, because the work did not
 * fail and nothing here should be redone. `INCONCLUSIVE_EXIT_CODE` plus one
 * stderr line the scheduler recognizes (`shared/inconclusive.ts`).
 *
 * Shared by `run` and `resume`: a resume that finds a standing non-verdict
 * reports it exactly as the original run did.
 */
async function finishRun(result: CommandResult): Promise<void> {
  const outcome = procedureOutcome(result);
  if (outcome === null || outcome.status !== "inconclusive") return;
  for (const item of outcome.inconclusive) {
    await writeStderr(
      formatInconclusiveLine({
        procedure: outcome.procedure,
        stepId: item.stepId,
        detail: item.detail,
      })
    );
  }
  process.exit(INCONCLUSIVE_EXIT_CODE);
}

procedureCommand
  .command("run")
  .description("Start a new procedure run")
  .argument("<name-or-path>", "Procedure name (e.g., process-pages) or path to .procedure.card")
  .option("--dry-run", "Preview without executing")
  .option("--force", "Force even if another process is running")
  .option("--step <id>", "Run only this step, skip all others")
  .option("--directive <text>", "Directive string passed to procedure agents")
  .action(async (name: string, options: { dryRun?: boolean; force?: boolean; step?: string; directive?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "procedure-run",
        args: {
          name,
          dryRun: options.dryRun,
          force: options.force,
          step: options.step,
          directive: options.directive,
        },
        ctx,
      });

      if (!result.success) {
        await exitWithProcedureError(result.error);
      }
      await finishRun(result);
    } catch (error) {
      await exitWithProcedureError(errorMessage(error));
    }
  });

procedureCommand
  .command("resume")
  .description("Resume a failed procedure run from its first incomplete step")
  .argument("[run-dir]", "Run directory to resume (defaults to the latest run)")
  .option("--directive <text>", "Directive string passed to procedure agents")
  .action(async (runDir: string | undefined, options: { directive?: string }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "procedure-resume",
        args: {
          runDir,
          directive: options.directive,
        },
        ctx,
      });

      if (!result.success) {
        await exitWithProcedureError(result.error);
      }
      await finishRun(result);
    } catch (error) {
      await exitWithProcedureError(errorMessage(error));
    }
  });

procedureCommand
  .command("list")
  .description("List available procedure definitions")
  .action(async () => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "procedure-list",
        args: {},
        ctx,
      });

      if (!result.success) {
        await exitWithProcedureError(result.error);
      }
    } catch (error) {
      await exitWithProcedureError(errorMessage(error));
    }
  });

procedureCommand
  .command("gc")
  .description("Delete expired procedure run directories")
  .action(async () => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "procedure-gc",
        args: {},
        ctx,
      });

      if (!result.success) {
        await exitWithProcedureError(result.error);
      }
    } catch (error) {
      await exitWithProcedureError(errorMessage(error));
    }
  });

procedureCommand
  .command("status")
  .description("Show status of a procedure run")
  .argument("[run-dir]", "Run directory (defaults to latest)")
  .action(async (runDir?: string) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "procedure-status",
        args: { runDir },
        ctx,
      });

      if (!result.success) {
        await exitWithProcedureError(result.error);
      }
    } catch (error) {
      await exitWithProcedureError(errorMessage(error));
    }
  });

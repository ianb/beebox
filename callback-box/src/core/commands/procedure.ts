/**
 * Procedure commands — command runner integration.
 *
 * Registers procedure-related commands with the command runner framework.
 */

import { registerCommand, type CommandResult } from "../command-runner.js";
import { startProcedure, resumeProcedure } from "../procedure/engine.js";
import { listProcedures, procedureStatus } from "../procedure/engine-query.js";
import { gcProcedureRuns } from "../procedure/gc.js";
import type { ProcedureOptions, ProcedureError } from "../procedure/engine.js";
import type { Result } from "../../lib/result.js";

/**
 * Adapt the engine's typed {@link Result} into the command-runner's
 * {@link CommandResult} boundary shape: a value becomes `data`, the tagged
 * error's `message` becomes the free-text `error` the CLI/web surface prints.
 */
function toCommandResult<T>(result: Result<T, ProcedureError>): CommandResult {
  if (!result.ok) {
    return { success: false, error: result.error.message };
  }
  return result.value === undefined ? { success: true } : { success: true, data: result.value };
}

registerCommand({
  name: "procedure-run",
  description: "Run a procedure by name or path",
  args: [
    {
      name: "name",
      type: "string",
      required: true,
      description: "Procedure name (e.g., process-pages) or path to .procedure.card",
    },
    {
      name: "dryRun",
      type: "boolean",
      required: false,
      default: false,
      description: "Preview without executing",
    },
    {
      name: "force",
      type: "boolean",
      required: false,
      default: false,
      description: "Force even if another process is running",
    },
    {
      name: "step",
      type: "string",
      required: false,
      description: "Run only this step, skip all others",
    },
    {
      name: "directive",
      type: "string",
      required: false,
      description: "Directive string passed to procedure agents",
    },
  ],
  execute: async (ctx, args) => {
    const name = args["name"] as string;
    const options: ProcedureOptions = {};
    if (args["dryRun"]) {
      options.dryRun = true;
    }
    if (args["force"]) {
      options.force = true;
    }
    if (args["step"]) {
      options.step = args["step"] as string;
    }
    if (args["directive"]) {
      options.directive = args["directive"] as string;
    }

    return toCommandResult(await startProcedure({ ctx, procedureNameOrPath: name, options }));
  },
});

registerCommand({
  name: "procedure-resume",
  description: "Resume a failed procedure run from its first incomplete step",
  args: [
    {
      name: "runDir",
      type: "string",
      required: false,
      description: "Run directory to resume (defaults to the latest run)",
    },
    {
      name: "directive",
      type: "string",
      required: false,
      description: "Directive string passed to procedure agents (defaults to the run's original)",
    },
  ],
  execute: async (ctx, args) => {
    const options: ProcedureOptions = {};
    if (args["directive"]) {
      options.directive = args["directive"] as string;
    }
    const runDir = args["runDir"] as string | undefined;
    return toCommandResult(await resumeProcedure({ ctx, options, ...(runDir && { runDir }) }));
  },
});

registerCommand({
  name: "procedure-list",
  description: "List available procedure definitions",
  args: [],
  execute: async (ctx) => {
    return toCommandResult(await listProcedures(ctx));
  },
});

registerCommand({
  name: "procedure-gc",
  description: "Delete expired procedure run directories",
  args: [],
  execute: async (ctx) => {
    return toCommandResult(await gcProcedureRuns(ctx));
  },
});

registerCommand({
  name: "procedure-status",
  description: "Show status of a procedure run",
  args: [
    {
      name: "runDir",
      type: "string",
      required: false,
      description: "Run directory (defaults to latest)",
    },
  ],
  execute: async (ctx, args) => {
    const runDir = args["runDir"] as string | undefined;
    return toCommandResult(await procedureStatus(ctx, runDir));
  },
});

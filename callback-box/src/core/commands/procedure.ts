/**
 * Procedure commands — command runner integration.
 *
 * Registers procedure-related commands with the command runner framework.
 */

import { registerCommand } from "../command-runner.js";
import {
  startProcedure,
  listProcedures,
  procedureStatus,
} from "../procedure/engine.js";
import type { ProcedureOptions } from "../procedure/engine.js";

registerCommand({
  name: "procedure-run",
  description: "Run a procedure by name or path",
  args: [
    {
      name: "name",
      type: "string",
      required: true,
      description: "Procedure name (e.g., process-news) or path to .procedure.card",
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

    return startProcedure({ ctx, procedureNameOrPath: name, options });
  },
});

registerCommand({
  name: "procedure-list",
  description: "List available procedure definitions",
  args: [],
  execute: async (ctx) => {
    return listProcedures(ctx);
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
    return procedureStatus(ctx, runDir);
  },
});

/**
 * Workflow commands — command runner integration.
 *
 * Registers workflow-related commands with the command runner framework.
 */

import { registerCommand } from "../command-runner.js";
import {
  startWorkflow,
  listWorkflows,
  workflowStatus,
} from "../workflow/engine.js";

registerCommand({
  name: "workflow-run",
  description: "Run a workflow by name",
  args: [
    {
      name: "name",
      type: "string",
      required: true,
      description: "Workflow name (e.g., process-news)",
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
  ],
  execute: async (ctx, args) => {
    const name = args["name"] as string;
    const options: import("../workflow/engine.js").WorkflowOptions = {};
    if (args["dryRun"]) {
      options.dryRun = true;
    }
    if (args["force"]) {
      options.force = true;
    }

    return startWorkflow(ctx, name, options);
  },
});

registerCommand({
  name: "workflow-list",
  description: "List available workflow definitions",
  args: [],
  execute: async (ctx) => {
    return listWorkflows(ctx);
  },
});

registerCommand({
  name: "workflow-status",
  description: "Show status of a workflow run",
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
    return workflowStatus(ctx, runDir);
  },
});

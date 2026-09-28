/**
 * `bbx triage` — run one pass of the triage stage.
 *
 * Reads `inbox/staged/`, compiles the triage-instructions doc, invokes
 * the triage subagent, and applies its decisions. See `src/core/triage.ts`.
 */

import type { CommandDefinition } from "../command-types.js";
import { runJevTriage } from "../triage/auto/core.js";
import { runTriage } from "../triage/run/core.js";

export const triageCommand: CommandDefinition = {
  name: "triage",
  description:
    "Run one triage pass: classify intake-complete items into categories and route them.",
  args: [
    { name: "engine", description: "agent (default) or jev", type: "string", required: false, default: "agent" },
    {
      name: "dryRun",
      description: "Print agent decisions without moving files.",
      required: false,
      default: false,
      type: "boolean",
    },
  ],
  execute: async (ctx, args) => {
    const dryRun = args["dryRun"] === true;
    if (args["engine"] !== undefined && args["engine"] !== "agent" && args["engine"] !== "jev") {
      return { success: false, error: "Triage engine must be agent or jev" };
    }
    if (args["engine"] === "jev") {
      const result = await runJevTriage({ boxRoot: ctx.boxRoot, dryRun });
      ctx.writeLine(`Triage: ${result.decisions.length} decision(s), ${result.deferred.length} deferred.`);
      for (const receipt of result.decisions) ctx.writeLine(`${receipt.id} ${receipt.judgment.outcome} ${dryRun ? "preview" : receipt.application.state}`);
      if (result.failed.length > 0) return { success: false, error: `${result.failed.length} triage item(s) failed`, data: result };
      return { success: true, data: result };
    }
    const result = await runTriage({ boxRoot: ctx.boxRoot, dryRun });

    if (result.empty) {
      ctx.writeLine("Triage: nothing in inbox/staged/.");
      return { success: true, data: result };
    }

    ctx.writeLine(`Triage: ${result.decisions.length} item(s), ${result.categories.length} categor(ies).`);
    for (const decision of result.decisions) {
      const cat = decision.category ?? "(none)";
      ctx.writeLine(`  ${decision.confidence}\t${cat}\t${decision.file}`);
      if (decision.reason) ctx.writeLine(`    └─ ${decision.reason}`);
    }

    if (dryRun) {
      ctx.writeLine("Dry run — no files moved.");
      return { success: true, data: result };
    }

    ctx.writeLine("");
    for (const app of result.applications) {
      const detail = app.questionPath ? ` (question: ${app.questionPath})` : "";
      ctx.writeLine(`  ${app.outcome}\t${app.file} → ${app.destination}${detail}`);
    }
    return { success: true, data: result };
  },
};

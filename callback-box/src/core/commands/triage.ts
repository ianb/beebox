/**
 * `cb triage` — run one pass of the triage stage.
 *
 * Reads `inbox/staged/`, compiles the triage-instructions doc, invokes
 * the triage subagent, and applies its decisions. See `src/core/triage.ts`.
 */

import { registerCommand } from "../command-runner.js";
import { runTriage } from "../triage.js";

registerCommand({
  name: "triage",
  description:
    "Run one triage pass: classify intake-complete items into categories and route them.",
  args: [
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
});

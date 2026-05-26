/**
 * `cb intake` — run one pass of the intake stage.
 *
 * The work itself lives in `src/core/intake.ts`; this module wraps it
 * in the command-runner contract so the CLI and the wakeup cycle can
 * both invoke it through the same surface.
 */

import { registerCommand } from "../command-runner.js";
import { runIntake } from "../intake.js";

registerCommand({
  name: "intake",
  description:
    "Run one intake pass: route fresh inbox items, normalize filenames, advance intake-complete items to staged.",
  args: [],
  execute: async (ctx) => {
    const result = await runIntake({ boxRoot: ctx.boxRoot });

    if (result.routed.length === 0 && result.applied.length === 0 && result.staged.length === 0) {
      ctx.writeLine("Intake: nothing to do.");
      return { success: true, data: result };
    }

    if (result.routed.length > 0) {
      ctx.writeLine(`Routed ${result.routed.length} item(s) into intake:`);
      for (const file of result.routed) ctx.writeLine(`  ${file}`);
    }
    for (const event of result.applied) {
      const detail = event.newName
        ? ` → ${event.newName}`
        : event.note
          ? ` (${event.note})`
          : "";
      ctx.writeLine(`  [${event.step}] ${event.file}${detail}`);
    }
    if (result.staged.length > 0) {
      ctx.writeLine(`Advanced ${result.staged.length} item(s) to staged:`);
      for (const file of result.staged) ctx.writeLine(`  ${file}`);
    }
    return { success: true, data: result };
  },
});

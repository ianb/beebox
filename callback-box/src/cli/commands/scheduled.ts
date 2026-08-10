/**
 * cb scheduled - Show all scheduled scripts and their state.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { getBoxTime } from "../../lib/time.js";
import {
  parseScheduledScript,
  ScheduledScriptSchema,
} from "../../schemas/scheduled-script.js";
import { cardFields, parseCardText } from "../../core/card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { loadScriptState } from "../../core/schedule/state.js";
import { describeCadence } from "../../core/schedule/describe.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";

export const scheduledCommand = new Command("scheduled")
  .description("Show all scheduled scripts and their state")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const schedulesDir = path.join(boxRoot, "config/schedules");
    const now = getBoxTime(boxRoot);

    let files: string[];
    try {
      files = (await fs.readdir(schedulesDir)).filter((f) =>
        f.endsWith(".scheduled-script.card")
      );
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.warn(`Could not read schedules directory at ${schedulesDir}:`, e);
      }
      console.log("No schedules directory found.");
      return;
    }

    if (files.length === 0) {
      console.log("No scheduled scripts found.");
      return;
    }

    console.log("Scheduled Scripts:");
    console.log("");

    const rows: Array<{ line: string } | { name: string; cadence: string; rest: string }> = [];

    for (const file of files) {
      const scriptName = file.replace(".scheduled-script.card", "");
      const cardPath = path.join(schedulesDir, file);

      let parsed;
      try {
        const content = await fs.readFile(cardPath, "utf-8");
        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
        parsed = parseScheduledScript(cardFields(card, ScheduledScriptSchema));
      } catch (err) {
        rows.push({ line: `  ${scriptName.padEnd(22)} [parse error: ${errorMessage(err)}]` });
        continue;
      }

      const state = await loadScriptState(boxRoot, scriptName);

      const scheduleDesc = describeCadence(parsed);

      // Build last-run description. Fall back to recentRuns for durationMs when
      // the state file predates lastDurationMs being recorded directly.
      let lastDesc: string;
      if (state.lastRun) {
        const elapsed = now.getTime() - new Date(state.lastRun).getTime();
        lastDesc = `last: ${formatDuration(elapsed)} ago`;
        let durationMs = state.lastDurationMs;
        if (durationMs == null && state.recentRuns && state.recentRuns.length > 0) {
          const match = state.recentRuns.find((r) => r.ts === state.lastRun);
          if (match) durationMs = match.durationMs;
        }
        const dur = durationMs != null
          ? `, ${(durationMs / 1000).toFixed(1)}s`
          : "";
        if (state.lastResult === "failure") {
          lastDesc += ` (\u2717 error${dur})`;
        } else if (state.lastResult === "success") {
          lastDesc += ` (ran${dur})`;
        }
      } else {
        lastDesc = "never run";
      }

      // Wakeup, once, and not-before are folded into the cadence sentence;
      // only disabled remains a flag.
      const flagStr = parsed.enabled ? "" : "  [disabled]";

      rows.push({ name: scriptName, cadence: scheduleDesc, rest: `${lastDesc}${flagStr}` });
    }

    // Pad the cadence column to the widest sentence so the state column aligns.
    const cadenceWidth = Math.max(...rows.map((r) => ("cadence" in r ? r.cadence.length : 0)));
    for (const row of rows) {
      if ("line" in row) {
        console.log(row.line);
      } else {
        console.log(`  ${row.name.padEnd(22)} ${row.cadence.padEnd(cadenceWidth)}  ${row.rest}`);
      }
    }
  });

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

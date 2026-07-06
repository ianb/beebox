/**
 * cb scheduled - Show all scheduled scripts and their state.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { getBoxTime } from "../lib/time.js";
import {
  parseScheduledScript,
  ScheduledScriptSchema,
} from "../../schemas/scheduled-script.js";
import { cardFields, parseCardText } from "../../core/card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { loadScriptState } from "../../core/schedule-state.js";

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
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
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

    for (const file of files) {
      const scriptName = file.replace(".scheduled-script.card", "");
      const cardPath = path.join(schedulesDir, file);

      let parsed;
      try {
        const content = await fs.readFile(cardPath, "utf-8");
        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
        parsed = parseScheduledScript(cardFields(card, ScheduledScriptSchema));
      } catch (err) {
        console.log(`  ${scriptName.padEnd(22)} [parse error: ${(err as Error).message}]`);
        continue;
      }

      const state = await loadScriptState(boxRoot, scriptName);

      // Build schedule description
      let scheduleDesc: string;
      if (parsed.cron) {
        scheduleDesc = `cron ${parsed.cron}`;
      } else if (parsed.at) {
        scheduleDesc = `at ${parsed.at}`;
      } else if (parsed.rrule) {
        scheduleDesc = `rrule ${parsed.rrule.substring(0, 30)}`;
      } else {
        scheduleDesc = "on-wakeup only";
      }

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

      // Build flags
      const flags: string[] = [];
      if (parsed.onWakeup && (parsed.cron || parsed.at || parsed.rrule)) {
        flags.push("+wakeup");
      }
      if (parsed.once) flags.push("once");
      if (!parsed.enabled) flags.push("disabled");
      if (parsed.notBefore) flags.push(`≥${parsed.notBefore}`);

      const flagStr = flags.length > 0 ? `  [${flags.join(", ")}]` : "";

      console.log(
        `  ${scriptName.padEnd(22)} ${scheduleDesc.padEnd(24)} ${lastDesc}${flagStr}`
      );
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

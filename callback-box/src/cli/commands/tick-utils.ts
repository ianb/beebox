/**
 * Shared utilities for scheduled script execution.
 * Used by both `cb tick` and `cb wakeup`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { parseXml } from "cardworks";
import {
  parseScheduledScript,
  isDueForWakeup,
  type ScheduledScript,
} from "../../schemas/scheduled-script.js";
import {
  loadScriptState,
  saveScriptState,
} from "../../core/schedule-state.js";

const SCRIPT_TIMEOUT = 10 * 60 * 1000; // 10 minutes

/**
 * Run all on-wakeup scheduled scripts that are due.
 * Returns the number of scripts that ran.
 */
export async function runOnWakeupScripts(boxRoot: string, now: Date): Promise<number> {
  const schedulesDir = path.join(boxRoot, "config/schedules");

  let files: string[];
  try {
    files = (await fs.readdir(schedulesDir)).filter((f) =>
      f.endsWith(".scheduled-script.card")
    );
  } catch {
    return 0;
  }

  let ranCount = 0;

  for (const file of files) {
    const scriptName = file.replace(".scheduled-script.card", "");
    const cardPath = path.join(schedulesDir, file);

    let parsed;
    try {
      const content = await fs.readFile(cardPath, "utf-8");
      const root = await parseXml(content, file);
      parsed = parseScheduledScript(root as ScheduledScript);
    } catch (err) {
      console.error(`  Error parsing ${file}: ${(err as Error).message}`);
      continue;
    }

    const state = await loadScriptState(boxRoot, scriptName);
    if (!isDueForWakeup(parsed, { lastRun: state.lastRun, now })) {
      continue;
    }

    console.log(`  Running ${scriptName}...`);
    try {
      execSync(parsed.runs, {
        cwd: boxRoot,
        stdio: "inherit",
        timeout: SCRIPT_TIMEOUT,
        env: { ...process.env, CB_TRIGGERED_BY: "wakeup" },
      });

      state.lastRun = now.toISOString();
      state.lastResult = "success";
      state.lastError = null;
      state.runCount++;
      await saveScriptState({ boxRoot, scriptName, state });
      ranCount++;
    } catch (err) {
      state.lastRun = now.toISOString();
      state.lastResult = "failure";
      state.lastError = (err as Error).message;
      state.runCount++;
      await saveScriptState({ boxRoot, scriptName, state });
      console.error(`  Failed: ${(err as Error).message}`);
    }
  }

  return ranCount;
}

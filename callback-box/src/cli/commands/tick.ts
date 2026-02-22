/**
 * cb tick - Evaluate and run due scheduled scripts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { getBoxTime } from "../lib/time.js";
import { parseXml } from "cardworks";
import {
  parseScheduledScript,
  isDue,
  type ScheduledScript,
} from "../../schemas/scheduled-script.js";
import {
  loadScriptState,
  saveScriptState,
} from "../../core/schedule-state.js";

const SCRIPT_TIMEOUT = 10 * 60 * 1000; // 10 minutes

interface TickOptions {
  dryRun?: boolean;
  script?: string;
}

export const tickCommand = new Command("tick")
  .description("Evaluate and run due scheduled scripts")
  .option("--dry-run", "Show what would run without executing")
  .option("--script <name>", "Only evaluate a specific script (by filename stem)")
  .action(async (options: TickOptions) => {
    const boxRoot = await requireBoxRoot();
    const schedulesDir = path.join(boxRoot, "config/schedules");
    const now = getBoxTime(boxRoot);

    let files: string[];
    try {
      files = (await fs.readdir(schedulesDir)).filter((f) =>
        f.endsWith(".scheduled-script.card")
      );
    } catch {
      console.log("No schedules directory found.");
      return;
    }

    if (options.script) {
      files = files.filter(
        (f) => f.replace(".scheduled-script.card", "") === options.script
      );
      if (files.length === 0) {
        console.error(`Script not found: ${options.script}`);
        process.exit(1);
      }
    }

    let ranCount = 0;
    let skipCount = 0;
    let errorCount = 0;

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
        errorCount++;
        continue;
      }

      const state = await loadScriptState(boxRoot, scriptName);
      const due = isDue(parsed, { lastRun: state.lastRun, now });

      if (!due) {
        skipCount++;
        continue;
      }

      if (options.dryRun) {
        console.log(`Would run: ${scriptName} → ${parsed.runs}`);
        ranCount++;
        continue;
      }

      console.log(`Running ${scriptName}...`);
      try {
        execSync(parsed.runs, {
          cwd: boxRoot,
          stdio: "inherit",
          timeout: SCRIPT_TIMEOUT,
          env: { ...process.env, CB_TRIGGERED_BY: "schedule" },
        });

        state.lastRun = now.toISOString();
        state.lastResult = "success";
        state.lastError = null;
        state.runCount++;
        await saveScriptState({ boxRoot, scriptName, state });
        ranCount++;

        // Handle once: delete the card after success
        if (parsed.once) {
          await fs.unlink(cardPath);
          console.log(`  Deleted one-shot script: ${file}`);
        }
      } catch (err) {
        state.lastRun = now.toISOString();
        state.lastResult = "failure";
        state.lastError = (err as Error).message;
        state.runCount++;
        await saveScriptState({ boxRoot, scriptName, state });
        console.error(`  Failed: ${(err as Error).message}`);
        errorCount++;
      }
    }

    if (options.dryRun) {
      console.log(`\n${ranCount} script(s) would run, ${skipCount} not due.`);
    } else {
      console.log(
        `\nTick complete: ${ranCount} ran, ${skipCount} skipped, ${errorCount} errors.`
      );
    }
  });
